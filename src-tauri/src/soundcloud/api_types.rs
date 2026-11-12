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
    #[serde(default)]
    pub playback_count: Option<u64>,
    /// Release info from labels / distributors (official artist name).
    #[serde(default)]
    pub publisher_metadata: Option<ApiPublisher>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ApiPublisher {
    #[serde(default)]
    pub artist: Option<String>,
}

impl ApiTrack {
    /// Why this track can't be played here (`None` = playable).
    pub fn unavailable_reason(&self) -> Option<String> {
        if self.policy.as_deref() == Some("BLOCK") {
            return Some("Not available in your country".into());
        }
        if self.streamable == Some(false) {
            return Some("The artist turned off streaming".into());
        }
        let list = self
            .media
            .as_ref()
            .map(|m| m.transcodings.as_slice())
            .unwrap_or(&[]);
        if pick_transcoding(list).is_some() && self.policy.as_deref() != Some("SNIP") {
            return None;
        }
        if self.policy.as_deref() == Some("SNIP")
            || (!list.is_empty() && list.iter().all(|t| t.snipped == Some(true)))
        {
            return Some("Go+ only (SoundCloud subscription)".into());
        }
        if list.is_empty() {
            return Some("SoundCloud offers no stream for this track".into());
        }
        let formats = list
            .iter()
            .map(|t| t.describe())
            .collect::<Vec<_>>()
            .join(", ");
        let encrypted_only = list.iter().all(|t| {
            t.snipped == Some(true)
                || t.format
                    .protocol
                    .as_deref()
                    .is_some_and(|p| p.contains("encrypted"))
        });
        if encrypted_only {
            return Some(format!("Protected (DRM) streams only. Offered: {formats}"));
        }
        Some(format!("Format not supported yet. Offered: {formats}"))
    }

    /// Playlists return only the first few tracks in full; the rest are
    /// stubs with just an id.
    pub fn is_stub(&self) -> bool {
        self.title.is_none()
    }

    pub fn into_track(self, liked_at_ms: Option<i64>) -> Track {
        let mut unavailable = self.unavailable_reason();
        // Protected (DRM-only) uploads are still playable: through an
        // unprotected stand-in or SoundCloud's own embedded player.
        let protected = unavailable
            .as_deref()
            .is_some_and(|r| r.starts_with("Protected"));
        if protected {
            unavailable = None;
        }
        let playable = unavailable.is_none();
        let artist_id = self.user.as_ref().map(|u| u.id);
        // Like soundcloud.com: the release's artist name when the label gave
        // one, otherwise the uploader's name.
        let official = self
            .publisher_metadata
            .as_ref()
            .and_then(|p| p.artist.as_deref())
            .map(str::trim)
            .filter(|a| !a.is_empty())
            .map(str::to_string);
        let (uploader, avatar) = match self.user {
            Some(u) => (u.username.unwrap_or_default(), u.avatar_url),
            None => (String::new(), None),
        };
        let artist = official.unwrap_or(uploader);
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
            plays: self.playback_count,
            unavailable,
            protected,
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
    #[serde(default)]
    pub set_type: Option<String>,
    #[serde(default)]
    pub is_album: Option<bool>,
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
            set_type: match self.set_type.as_deref() {
                Some(t) if !t.is_empty() => Some(t.to_string()),
                _ if self.is_album == Some(true) => Some("album".to_string()),
                _ => None,
            },
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

    #[test]
    fn explains_why_a_track_is_unavailable_and_uses_the_official_artist() {
        let parse = |json: &str| {
            serde_json::from_str::<ApiTrack>(json)
                .unwrap()
                .into_track(None)
        };
        let go = parse(
            r#"{"id": 1, "title": "a", "policy": "SNIP", "media": {"transcodings": [{"url": "x", "snipped": true, "format": {"protocol": "hls", "mime_type": "audio/mpeg"}}]}}"#,
        );
        assert!(go.unavailable.unwrap().starts_with("Go+"));
        let drm = parse(
            r#"{"id": 2, "title": "b", "policy": "MONETIZE", "media": {"transcodings": [{"url": "x", "format": {"protocol": "ctr-encrypted-hls", "mime_type": "audio/mp4"}}]}}"#,
        );
        assert!(drm.protected && drm.playable && drm.unavailable.is_none());
        let opus = parse(
            r#"{"id": 3, "title": "c", "media": {"transcodings": [{"url": "x", "format": {"protocol": "hls", "mime_type": "audio/ogg; codecs=\"opus\""}}]}}"#,
        );
        assert!(opus
            .unavailable
            .unwrap()
            .starts_with("Format not supported"));
        let ok = parse(
            r#"{"id": 4, "title": "d", "user": {"id": 9, "username": "uploader"}, "publisher_metadata": {"artist": "Real Artist"}, "media": {"transcodings": [{"url": "x", "format": {"protocol": "progressive", "mime_type": "audio/mpeg"}}]}}"#,
        );
        assert!(ok.playable && ok.unavailable.is_none());
        assert_eq!(ok.artist, "Real Artist");
    }
}
