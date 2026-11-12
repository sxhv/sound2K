//! Your Sound2K library, stored on this PC only: likes, follows and playlists
//! made in the app. SoundCloud doesn't accept these changes from apps (403),
//! so they live here instead, separate from your SoundCloud account.
//!
//! One file per account: `%LOCALAPPDATA%\Sound2K\local-<account id>.json`
//! (0 = the sample library). Kept outside the cache folder, so "Clear cache"
//! and signing out don't delete it.

use crate::errors::{AppError, AppResult};
use crate::library::models::{Artist, PlaylistSummary, Track};
use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::AppHandle;

pub const PLAYLIST_PREFIX: &str = "local-playlist:";
const MAX_PLAYLIST_TRACKS: usize = 5000;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LocalData {
    /// Liked in Sound2K, newest first.
    pub likes: Vec<Track>,
    /// Artists followed in Sound2K, newest first.
    pub follows: Vec<Artist>,
    pub playlists: Vec<LocalPlaylist>,
    /// Next playlist number (ids stay unique after deletes).
    pub next_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPlaylist {
    pub id: String,
    pub title: String,
    pub tracks: Vec<Track>,
}

impl LocalPlaylist {
    pub fn summary(&self, owner: &str, owner_id: u64) -> PlaylistSummary {
        PlaylistSummary {
            id: self.id.clone(),
            title: self.title.clone(),
            owner: owner.to_string(),
            track_count: self.tracks.len() as u32,
            artwork_url: self.tracks.iter().find_map(|t| t.artwork_url.clone()),
            owner_id,
            sharing: Some("local".into()),
            set_type: None,
        }
    }
}

fn file_name(account: u64) -> String {
    format!("local-{account}.json")
}

/// Earlier builds kept only likes, in `local-likes-<id>.json`.
#[derive(Default, Deserialize)]
#[serde(default)]
struct LegacyLikes {
    added: Vec<Track>,
}

pub fn load(app: &AppHandle, account: u64) -> LocalData {
    let Ok(dir) = paths::app_data_dir(app) else {
        return LocalData::default();
    };
    if let Some(data) = fs::read_to_string(dir.join(file_name(account)))
        .ok()
        .and_then(|text| serde_json::from_str::<LocalData>(&text).ok())
    {
        return data;
    }
    // Carry over likes saved by the previous version.
    let legacy = fs::read_to_string(dir.join(format!("local-likes-{account}.json")))
        .ok()
        .and_then(|text| serde_json::from_str::<LegacyLikes>(&text).ok())
        .unwrap_or_default();
    LocalData {
        likes: legacy.added,
        ..LocalData::default()
    }
}

pub fn save(app: &AppHandle, account: u64, data: &LocalData) -> AppResult<()> {
    let dir = paths::app_data_dir(app)?;
    fs::create_dir_all(&dir)?;
    let name = file_name(account);
    let tmp = dir.join(format!("{name}.tmp"));
    fs::write(&tmp, serde_json::to_vec(data)?)?;
    fs::rename(&tmp, dir.join(name))?;
    Ok(())
}

pub fn now_ms() -> Option<i64> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .ok()
}

impl LocalData {
    // --- Likes ---------------------------------------------------------------

    pub fn set_like(&mut self, track: Track, like: bool) {
        self.likes.retain(|t| t.id != track.id);
        if like {
            self.likes.insert(
                0,
                Track {
                    liked_at_ms: now_ms(),
                    ..track
                },
            );
        }
    }

    // --- Follows -------------------------------------------------------------

    pub fn is_following(&self, id: u64) -> bool {
        self.follows.iter().any(|a| a.id == id)
    }

    pub fn set_follow(&mut self, artist: Artist, follow: bool) {
        self.follows.retain(|a| a.id != artist.id);
        if follow {
            self.follows.insert(
                0,
                Artist {
                    following: Some(true),
                    ..artist
                },
            );
        }
    }

    // --- Playlists -----------------------------------------------------------

    pub fn playlist_mut(&mut self, id: &str) -> AppResult<&mut LocalPlaylist> {
        self.playlists
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| AppError::NotFound("playlist".into()))
    }

    pub fn create_playlist(
        &mut self,
        title: &str,
        tracks: Vec<Track>,
    ) -> AppResult<&LocalPlaylist> {
        let title = clean_title(title)?;
        self.next_id = self.next_id.max(self.playlists.len() as u64) + 1;
        let mut seen = std::collections::HashSet::new();
        let tracks: Vec<Track> = tracks
            .into_iter()
            .filter(|t| seen.insert(t.id.clone()))
            .take(MAX_PLAYLIST_TRACKS)
            .collect();
        self.playlists.insert(
            0,
            LocalPlaylist {
                id: format!("{PLAYLIST_PREFIX}{}", self.next_id),
                title,
                tracks,
            },
        );
        Ok(&self.playlists[0])
    }

    pub fn delete_playlist(&mut self, id: &str) {
        self.playlists.retain(|p| p.id != id);
    }
}

impl LocalPlaylist {
    pub fn rename(&mut self, title: &str) -> AppResult<()> {
        self.title = clean_title(title)?;
        Ok(())
    }

    pub fn add(&mut self, track: Track) -> AppResult<()> {
        if self.tracks.iter().any(|t| t.id == track.id) {
            return Ok(());
        }
        if self.tracks.len() >= MAX_PLAYLIST_TRACKS {
            return Err(AppError::Api(
                "This playlist is full (5,000 tracks).".into(),
            ));
        }
        self.tracks.push(track);
        Ok(())
    }

    pub fn remove(&mut self, track_id: &str) {
        self.tracks.retain(|t| t.id != track_id);
    }

    /// Move `track_id` up (-1) or down (+1).
    pub fn nudge(&mut self, track_id: &str, delta: i64) {
        if let Some(i) = self.tracks.iter().position(|t| t.id == track_id) {
            let j = i as i64 + delta;
            if j >= 0 && (j as usize) < self.tracks.len() {
                self.tracks.swap(i, j as usize);
            }
        }
    }

    /// Move `track_id` to just before `before_id` (`None` = to the end).
    pub fn move_before(&mut self, track_id: &str, before_id: Option<&str>) {
        let Some(i) = self.tracks.iter().position(|t| t.id == track_id) else {
            return;
        };
        let track = self.tracks.remove(i);
        let at = before_id
            .and_then(|b| self.tracks.iter().position(|t| t.id == b))
            .unwrap_or(self.tracks.len());
        self.tracks.insert(at, track);
    }
}

fn clean_title(title: &str) -> AppResult<String> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 100 {
        return Err(AppError::Api(
            "Playlist names must be 1–100 characters.".into(),
        ));
    }
    Ok(title.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(id: &str) -> Track {
        Track {
            id: id.into(),
            title: id.into(),
            artist: String::new(),
            duration_ms: 0,
            artwork_url: None,
            permalink_url: None,
            liked_at_ms: None,
            playable: true,
            downloadable: false,
            artist_id: None,
            plays: None,
            unavailable: None,
            protected: false,
        }
    }

    #[test]
    fn likes_toggle() {
        let mut d = LocalData::default();
        d.set_like(track("sc:1"), true);
        d.set_like(track("sc:2"), true);
        d.set_like(track("sc:1"), false);
        assert_eq!(d.likes.len(), 1);
        assert_eq!(d.likes[0].id, "sc:2");
    }

    #[test]
    fn playlist_edit() {
        let mut d = LocalData::default();
        let id = d
            .create_playlist(" Mix ", vec![track("a"), track("b"), track("a")])
            .unwrap()
            .id
            .clone();
        let p = d.playlist_mut(&id).unwrap();
        assert_eq!(p.title, "Mix");
        assert_eq!(p.tracks.len(), 2);
        p.add(track("c")).unwrap();
        p.move_before("c", Some("a"));
        p.nudge("b", -1);
        let ids: Vec<&str> = p.tracks.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, ["c", "b", "a"]);
        assert!(d.create_playlist("   ", vec![]).is_err());
    }
}
