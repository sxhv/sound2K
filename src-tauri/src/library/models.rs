//! Data shapes shared with the UI (and the cache files).
//! Field names are camelCase on the wire.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub duration_ms: u64,
    pub artwork_url: Option<String>,
    pub permalink_url: Option<String>,
    /// When the track was liked, if the source provides it. Never invented.
    pub liked_at_ms: Option<i64>,
    /// False for blocked, preview-only (Go+) or otherwise unstreamable tracks.
    pub playable: bool,
    /// The artist allows downloads (SoundCloud's own download button).
    #[serde(default)]
    pub downloadable: bool,
    /// SoundCloud user id of the uploader (for artist pages).
    #[serde(default)]
    pub artist_id: Option<u64>,
    /// Play count shown on SoundCloud (`None` = unknown / hidden by the artist).
    #[serde(default)]
    pub plays: Option<u64>,
    /// Why it can't be played here, when `playable` is false.
    #[serde(default)]
    pub unavailable: Option<String>,
}

/// A SoundCloud user, as shown on an artist page or in search.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artist {
    pub id: u64,
    pub username: String,
    pub avatar_url: Option<String>,
    pub banner_url: Option<String>,
    pub permalink_url: Option<String>,
    pub city: Option<String>,
    pub followers: u64,
    pub track_count: u64,
    /// Whether you follow them (`None` = unknown / signed out).
    pub following: Option<bool>,
}

/// One page of results; pass `next` back to get the following page.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Paged<T> {
    pub items: Vec<T>,
    pub next: Option<String>,
}

/// A track in the home feed, with who reposted it (if it's a repost).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedItem {
    pub track: Track,
    pub reposted_by: Option<String>,
    pub at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSummary {
    pub id: String,
    pub title: String,
    pub owner: String,
    pub track_count: u32,
    pub artwork_url: Option<String>,
    /// SoundCloud user id of the owner (0 = unknown). Only your own
    /// playlists can be edited.
    #[serde(default)]
    pub owner_id: u64,
    /// "public" or "private".
    #[serde(default)]
    pub sharing: Option<String>,
    /// Release type set by the artist: "album", "ep", "single",
    /// "compilation" (`None` for ordinary playlists).
    #[serde(default)]
    pub set_type: Option<String>,
}

/// The signed-in SoundCloud user (public profile fields only).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: u64,
    pub username: String,
    pub avatar_url: Option<String>,
    pub permalink_url: Option<String>,
}
