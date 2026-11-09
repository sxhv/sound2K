//! Downloads a track's audio into a [`SharedBuffer`] as it plays.
//!
//! Only HTTPS hosts belonging to SoundCloud's media CDN are contacted, and
//! the session token is never sent to them (stream URLs are pre-signed).

use super::buffer::SharedBuffer;
use crate::errors::{AppError, AppResult};
use crate::soundcloud::StreamKind;
use futures_util::stream::{self, StreamExt};
use std::sync::Arc;
use url::Url;

const MEDIA_HOST_SUFFIXES: &[&str] = &[".sndcdn.com", ".soundcloud.cloud"];
/// HLS segments downloaded at the same time.
const PARALLEL_SEGMENTS: usize = 6;
/// Sanity cap on HLS playlists (a 5-hour mix is ~1,800 ten-second segments).
const MAX_SEGMENTS: usize = 5_000;

fn check_media_host(url: &Url) -> AppResult<()> {
    let host_ok = url
        .host_str()
        .is_some_and(|h| MEDIA_HOST_SUFFIXES.iter().any(|s| h.ends_with(s)));
    if url.scheme() == "https" && host_ok {
        Ok(())
    } else {
        Err(AppError::Api(
            "Refused to stream from an unexpected server.".into(),
        ))
    }
}

/// Segment URLs listed in an HLS media playlist, resolved against its URL.
/// For fragmented-MP4 (AAC) streams, the `#EXT-X-MAP` initialization
/// segment comes first, so the downloaded bytes form one valid MP4 stream.
pub fn parse_hls_segments(playlist_url: &Url, text: &str) -> AppResult<Vec<Url>> {
    let mut out = Vec::new();
    let mut init: Option<Url> = None;
    for line in text.lines().map(str::trim) {
        if line.starts_with("#EXT-X-KEY") && !line.contains("METHOD=NONE") {
            return Err(AppError::Api(
                "This stream is encrypted; it can't be played.".into(),
            ));
        }
        if let Some(attrs) = line.strip_prefix("#EXT-X-MAP:") {
            if init.is_none() {
                let uri = attrs
                    .split("URI=\"")
                    .nth(1)
                    .and_then(|rest| rest.split('"').next())
                    .ok_or_else(|| AppError::Api("Unreadable stream playlist.".into()))?;
                init = Some(playlist_url.join(uri)?);
            }
            continue;
        }
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        out.push(playlist_url.join(line)?);
        if out.len() > MAX_SEGMENTS {
            return Err(AppError::Api("This stream is unexpectedly long.".into()));
        }
    }
    if out.is_empty() {
        return Err(AppError::Api("The stream playlist was empty.".into()));
    }
    if let Some(init) = init {
        out.insert(0, init);
    }
    Ok(out)
}

async fn fetch_into(http: &reqwest::Client, url: &Url, buffer: &SharedBuffer) -> AppResult<()> {
    check_media_host(url)?;
    let mut resp = http.get(url.clone()).send().await?.error_for_status()?;
    while let Some(chunk) = resp.chunk().await? {
        if buffer.is_cancelled() {
            return Ok(());
        }
        if !buffer.push(&chunk) {
            return Err(AppError::Api("This track is too long to stream.".into()));
        }
    }
    Ok(())
}

async fn fetch_bytes(http: &reqwest::Client, url: &Url) -> AppResult<bytes::Bytes> {
    check_media_host(url)?;
    Ok(http
        .get(url.clone())
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?)
}

async fn run(
    http: reqwest::Client,
    kind: StreamKind,
    url: Url,
    buffer: &SharedBuffer,
) -> AppResult<()> {
    match kind {
        StreamKind::ProgressiveMp3 => fetch_into(&http, &url, buffer).await,
        StreamKind::HlsMp3 | StreamKind::HlsAac => {
            check_media_host(&url)?;
            let text = http
                .get(url.clone())
                .send()
                .await?
                .error_for_status()?
                .text()
                .await?;
            // Fetch several segments at once, but append them in order.
            let segments = parse_hls_segments(&url, &text)?;
            let mut downloads = stream::iter(segments.into_iter().map(|segment| {
                let http = http.clone();
                async move { fetch_bytes(&http, &segment).await }
            }))
            .buffered(PARALLEL_SEGMENTS);
            while let Some(result) = downloads.next().await {
                if buffer.is_cancelled() {
                    break;
                }
                if !buffer.push(&result?) {
                    return Err(AppError::Api("This track is too long to stream.".into()));
                }
            }
            Ok(())
        }
    }
}

/// Download in the background until done, failed, or cancelled.
pub async fn download(
    http: reqwest::Client,
    kind: StreamKind,
    url: Url,
    buffer: Arc<SharedBuffer>,
) {
    match run(http, kind, url, &buffer).await {
        Ok(()) => buffer.finish(),
        Err(_) => buffer.fail(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_relative_and_absolute_segments() {
        let base: Url = "https://cf-hls-media.sndcdn.com/playlist/abc/playlist.m3u8?x=1"
            .parse()
            .unwrap();
        let text = "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nseg0.mp3\n#EXTINF:10,\nhttps://cf-hls-media.sndcdn.com/media/1/seg1.mp3?sig=y\n#EXT-X-ENDLIST\n";
        let segs = parse_hls_segments(&base, text).unwrap();
        assert_eq!(segs.len(), 2);
        assert_eq!(
            segs[0].as_str(),
            "https://cf-hls-media.sndcdn.com/playlist/abc/seg0.mp3"
        );
        assert!(segs[1].as_str().ends_with("seg1.mp3?sig=y"));
    }

    #[test]
    fn puts_fmp4_init_segment_first() {
        let base: Url =
            "https://playback.media-streaming.soundcloud.cloud/t/aac_160k/u/playlist.m3u8"
                .parse()
                .unwrap();
        let text = "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:6,\nsegment-0.m4s\n#EXTINF:6,\nsegment-1.m4s\n";
        let segs = parse_hls_segments(&base, text).unwrap();
        assert_eq!(segs.len(), 3);
        assert!(segs[0].as_str().ends_with("/u/init.mp4"));
        assert!(segs[2].as_str().ends_with("/u/segment-1.m4s"));
    }

    #[test]
    fn rejects_encrypted_and_empty_playlists() {
        let base: Url = "https://cf-hls-media.sndcdn.com/p.m3u8".parse().unwrap();
        assert!(parse_hls_segments(
            &base,
            "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"k\"\nseg.mp3\n"
        )
        .is_err());
        assert!(parse_hls_segments(&base, "#EXTM3U\n#EXT-X-ENDLIST\n").is_err());
    }

    #[test]
    fn only_soundcloud_media_hosts() {
        assert!(check_media_host(&"https://cf-media.sndcdn.com/a.mp3".parse().unwrap()).is_ok());
        assert!(check_media_host(
            &"https://playback.media-streaming.soundcloud.cloud/x"
                .parse()
                .unwrap()
        )
        .is_ok());
        assert!(check_media_host(&"http://cf-media.sndcdn.com/a.mp3".parse().unwrap()).is_err());
        assert!(check_media_host(&"https://evil.example.com/sndcdn.com".parse().unwrap()).is_err());
        assert!(check_media_host(&"https://sndcdn.com.evil.io/a".parse().unwrap()).is_err());
    }
}
