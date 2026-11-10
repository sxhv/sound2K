//! Raw api-v2 response shapes (only the fields we use) and conversion into
//! the app's own models. Every field is optional/defaulted so an unexpected
//! or partial response degrades gracefully instead of failing.

use super::time::parse_iso_ms;
use crate::library::models::{Account, Artist, FeedItem, PlaylistSummary, Track};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Page<T> {
    #[serde(default = "Vec::new")]
    pub collection: Vec<T>,
    #[serde(default)]
    pub next_href: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApiUser {
    pub id: u64,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub permalink_url: Option<String>,
}

impl From<ApiUser> for Account {
    fn from(u: ApiUser) -> Self {
        Account {
            id: u.id,
            username: u.username.unwrap_or_else(|| "SoundCloud user".into()),
            avatar_url: u.avatar_url,
            permalink_url: u.permalink_url,
        }
    }
}

#[derive(Debug, Default, Clone, Deserialize)]
pub struct ApiMedia {
    #[serde(default)]
    pub transcodings: Vec<ApiTranscoding>,
}

#[derive(Debug, Default, Clone, Deserialize)]
pub struct ApiFormat {
    /// "progressive", "hls", "ctr-encrypted-hls", "cbc-encrypted-hls", …
    #[serde(default)]
    pub protocol: Option<String>,
    /// e.g. "audio/mpeg", "audio/mp4; codecs=\"mp4a.40.2\""
    #[serde(default)]
    pub mime_type: Option<String>,
}

/// One available stream format for a track.
#[derive(Debug, Default, Clone, Deserialize)]
pub struct ApiTranscoding {
    #[serde(default)]
    pub url: Option<String>,
    /// true = 30-second preview only (Go+ tracks).
    #[serde(default)]
    pub snipped: Option<bool>,
    #[serde(default)]
    pub format: ApiFormat,
}

/// How the audio engine will fetch a track.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamKind {
    /// One MP3 file.
    ProgressiveMp3,
    /// An HLS playlist of plain (unencrypted) MP3 segments.
    HlsMp3,
    /// An HLS playlist of plain (unencrypted) AAC in MP4 segments.
    HlsAac,
}

/// Preference order: single file (seeks fastest), then HLS MP3, then HLS AAC.
const PREFERENCE: [StreamKind; 3] = [
    StreamKind::ProgressiveMp3,
    StreamKind::HlsMp3,
    StreamKind::HlsAac,
];

impl ApiTranscoding {
    /// Only unencrypted MP3/AAC streams are used. Encrypted (DRM) streams
    /// are never touched, and 30-second previews are skipped.
    pub fn supported_kind(&self) -> Option<StreamKind> {
        if self.snipped == Some(true) || self.url.is_none() {
            return None;
        }
        let mime = self.format.mime_type.as_deref().unwrap_or_default();
        // Exact protocol names only: "ctr-encrypted-hls" etc. never match.
        match self.format.protocol.as_deref() {
            Some("progressive") if mime.starts_with("audio/mpeg") => {
                Some(StreamKind::ProgressiveMp3)
            }
            Some("hls") if mime.starts_with("audio/mpeg") => Some(StreamKind::HlsMp3),
            Some("hls") if mime.starts_with("audio/mp4") => Some(StreamKind::HlsAac),
            _ => None,
        }
    }

    /// e.g. "hls audio/mpeg" (for error messages).
    pub fn describe(&self) -> String {
        let protocol = self.format.protocol.as_deref().unwrap_or("?");
        let mime = self.format.mime_type.as_deref().unwrap_or("?");
        let mime = mime.split(';').next().unwrap_or(mime);
        let preview = if self.snipped == Some(true) {
            " (preview)"
        } else {
            ""
        };
        format!("{protocol} {mime}{preview}")
    }
}

/// All usable streams, best first.
pub fn rank_transcodings(list: &[ApiTranscoding]) -> Vec<(&ApiTranscoding, StreamKind)> {
    PREFERENCE
        .iter()
        .flat_map(|&want| {
            list.iter()
                .filter(move |t| t.supported_kind() == Some(want))
                .map(move |t| (t, want))
        })
        .collect()
}

/// Best supported stream, if any.
pub fn pick_transcoding(list: &[ApiTranscoding]) -> Option<(&ApiTranscoding, StreamKind)> {
    rank_transcodings(list).into_iter().next()
}

/// Response of a transcoding URL: the real (signed, short-lived) stream URL.
#[derive(Debug, Deserialize)]
pub struct ApiStreamUrl {
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApiTrack {
    pub id: u64,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub user: Option<ApiUser>,
    #[serde(default)]
    pub duration: Option<u64>,
    #[serde(default)]
    pub full_duration: Option<u64>,
    #[serde(default)]
    pub artwork_url: Option<String>,
    #[serde(default)]
    pub permalink_url: Option<String>,
    #[serde(default)]
    pub streamable: Option<bool>,
    /// "ALLOW", "MONETIZE", "SNIP" (Go+ preview only), "BLOCK", …
    #[serde(default)]
    pub policy: Option<String>,
    #[serde(default)]
    pub media: Option<ApiMedia>,
    /// Short-lived token SoundCloud requires when requesting a stream.
    #[serde(default)]
    pub track_authorization: Option<String>,
    /// Set by the artist: the original file may be downloaded.
    #[serde(default)]
    pub downloadable: Option<bool>,
}

impl ApiTrack {
    /// Playlists return only the first few tracks in full; the rest are
    /// stubs with just an id.
    pub fn is_stub(&self) -> bool {
        self.title.is_none()
    }

    pub fn into_track(self, liked_at_ms: Option<i64>) -> Track {
        let policy_ok = !matches!(self.policy.as_deref(), Some("BLOCK") | Some("SNIP"));
        let has_streams = self
            .media
            .as_ref()
            .is_some_and(|m| pick_transcoding(&m.transcodings).is_some());
        let playable = self.streamable != Some(false) && policy_ok && has_streams;
        let artist_id = self.user.as_ref().map(|u| u.id);
        let (artist, avatar) = match self.user {
            Some(u) => (u.username.unwrap_or_default(), u.avatar_url),
            None => (String::new(), None),
        };
        Track {
            id: format!("sc:{}", self.id),
            title: self.title.unwrap_or_else(|| "Untitled".into()),
            artist,
            duration_ms: self.full_duration.or(self.duration).unwrap_or(0),
            // Fall back to the uploader's avatar, like soundcloud.com does.
            artwork_url: self.artwork_url.or(avatar),
            permalink_url: self.permalink_url,
            liked_at_ms,
            playable,
            downloadable: self.downloadable == Some(true),
            artist_id,
        }
    }
}

/// Full user profile (artist pages, search results).
#[derive(Debug, Clone, Deserialize)]
pub struct ApiUserFull {
    pub id: u64,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub permalink_url: Option<String>,
    #[serde(default)]
    pub city: Option<String>,
    #[serde(default)]
    pub followers_count: Option<u64>,
    #[serde(default)]
    pub track_count: Option<u64>,
    #[serde(default)]
    pub visuals: Option<ApiVisuals>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApiVisuals {
    #[serde(default)]
    pub visuals: Vec<ApiVisual>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApiVisual {
    #[serde(default)]
    pub visual_url: Option<String>,
}

impl ApiUserFull {
    pub fn into_artist(self, following: Option<bool>) -> Artist {
        Artist {
            id: self.id,
            username: self.username.unwrap_or_default(),
            // Ask for a bigger avatar than the default 100 px.
            avatar_url: self.avatar_url.map(|u| u.replace("-large.", "-t500x500.")),
            banner_url: self
                .visuals
                .and_then(|v| v.visuals.into_iter().find_map(|x| x.visual_url)),
            permalink_url: self.permalink_url,
            city: self.city.filter(|c| !c.is_empty()),
            followers: self.followers_count.unwrap_or(0),
            track_count: self.track_count.unwrap_or(0),
            following,
        }
    }
}

/// An item in the home feed or an artist's reposts.
#[derive(Debug, Deserialize)]
pub struct ApiStreamItem {
    #[serde(default, rename = "type")]
    pub kind: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub track: Option<ApiTrack>,
    /// Who posted / reposted it.
    #[serde(default)]
    pub user: Option<ApiUser>,
}

impl ApiStreamItem {
    /// Track items only (playlists in the feed are skipped for now).
    pub fn into_feed_item(self) -> Option<FeedItem> {
        let track = self.track.filter(|t| !t.is_stub())?;
        let is_repost = self.kind.as_deref().is_some_and(|k| k.contains("repost"));
        Some(FeedItem {
            reposted_by: if is_repost {
                self.user.and_then(|u| u.username)
            } else {
                None
            },
            at_ms: self.created_at.as_deref().and_then(parse_iso_ms),
            track: track.into_track(None),
        })
    }
}

#[derive(Debug, Deserialize)]
pub struct ApiLike {
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub track: Option<ApiTrack>,
}

impl ApiLike {
    pub fn into_track(self) -> Option<Track> {
        let liked_at = self.created_at.as_deref().and_then(parse_iso_ms);
        self.track.map(|t| t.into_track(liked_at))
    }
}

#[derive(Debug, Deserialize)]
pub struct ApiPlaylist {
    pub id: u64,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub user: Option<ApiUser>,
    #[serde(default)]
    pub track_count: Option<u32>,
    #[serde(default)]
    pub artwork_url: Option<String>,
    #[serde(default)]
    pub tracks: Vec<ApiTrack>,
    #[serde(default)]
    pub sharing: Option<String>,
}

impl ApiPlaylist {
    pub fn summary(&self) -> PlaylistSummary {
        let first_track_art = self.tracks.iter().find_map(|t| t.artwork_url.clone());
        PlaylistSummary {
            id: format!("sc-playlist:{}", self.id),
            title: self
                .title
                .clone()
                .unwrap_or_else(|| "Untitled playlist".into()),
            owner: self
                .user
                .as_ref()
                .and_then(|u| u.username.clone())
                .unwrap_or_default(),
            track_count: self.track_count.unwrap_or(self.tracks.len() as u32),
            artwork_url: self.artwork_url.clone().or(first_track_art),
            owner_id: self.user.as_ref().map(|u| u.id).unwrap_or(0),
            sharing: self.sharing.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ApiPlaylistLike {
    #[serde(default)]
    pub playlist: Option<ApiPlaylist>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(protocol: &str, mime: &str, snipped: bool) -> ApiTranscoding {
        ApiTranscoding {
            url: Some(format!("https://api-v2.soundcloud.com/media/{protocol}")),
            snipped: Some(snipped),
            format: ApiFormat {
                protocol: Some(protocol.into()),
                mime_type: Some(mime.into()),
            },
        }
    }

    #[test]
    fn prefers_progressive_mp3() {
        let list = [
            t("hls", "audio/mpeg", false),
            t("progressive", "audio/mpeg", false),
        ];
        assert_eq!(
            pick_transcoding(&list).map(|p| p.1),
            Some(StreamKind::ProgressiveMp3)
        );
    }

    #[test]
    fn never_picks_encrypted_opus_or_previews() {
        let list = [
            t(
                "ctr-encrypted-hls",
                "audio/mp4; codecs=\"mp4a.40.2\"",
                false,
            ),
            t("cbc-encrypted-hls", "audio/mpeg", false),
            t("hls", "audio/ogg; codecs=\"opus\"", false),
            t("progressive", "audio/mpeg", true),
        ];
        assert!(pick_transcoding(&list).is_none());
        let list2 = [list[0].clone(), t("hls", "audio/mpeg", false)];
        assert_eq!(
            pick_transcoding(&list2).map(|p| p.1),
            Some(StreamKind::HlsMp3)
        );
    }

    #[test]
    fn ranks_all_usable_streams_for_fallback() {
        let list = [
            t("hls", "audio/mp4; codecs=\"mp4a.40.2\"", false),
            t(
                "ctr-encrypted-hls",
                "audio/mp4; codecs=\"mp4a.40.2\"",
                false,
            ),
            t("hls", "audio/mpeg", false),
            t("progressive", "audio/mpeg", false),
        ];
        let kinds: Vec<_> = rank_transcodings(&list).into_iter().map(|p| p.1).collect();
        assert_eq!(
            kinds,
            vec![
                StreamKind::ProgressiveMp3,
                StreamKind::HlsMp3,
                StreamKind::HlsAac
            ]
        );
        assert_eq!(list[1].describe(), "ctr-encrypted-hls audio/mp4");
    }

    #[test]
    fn tolerates_unexpected_json() {
        let track: ApiTrack = serde_json::from_str(
            r#"{"id": 5, "media": {"transcodings": [{"weird": true}, {"url": "x", "format": {}}]}}"#,
        )
        .unwrap();
        assert!(!track.into_track(None).playable);
    }
}
