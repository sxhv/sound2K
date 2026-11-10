//! Likes made in Sound2K, stored on this PC only (SoundCloud doesn't accept
//! likes from apps). One file per account:
//! `%LOCALAPPDATA%\Sound2K\local-likes-<account id>.json` (0 = sample library).
//!
//! Your Liked Songs = SoundCloud likes + songs liked here − songs unliked here.
//! Kept outside the cache folder, so "Clear cache" and signing out keep them.

use crate::errors::AppResult;
use crate::library::models::Track;
use crate::paths;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use tauri::AppHandle;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LocalLikes {
    /// Liked in Sound2K, newest first.
    pub added: Vec<Track>,
    /// Ids of SoundCloud likes you unliked in Sound2K (hidden here).
    pub removed: Vec<String>,
}

fn file_name(account: u64) -> String {
    format!("local-likes-{account}.json")
}

pub fn load(app: &AppHandle, account: u64) -> LocalLikes {
    let Ok(dir) = paths::app_data_dir(app) else {
        return LocalLikes::default();
    };
    fs::read_to_string(dir.join(file_name(account)))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, account: u64, likes: &LocalLikes) -> AppResult<()> {
    let dir = paths::app_data_dir(app)?;
    fs::create_dir_all(&dir)?;
    let name = file_name(account);
    let tmp = dir.join(format!("{name}.tmp"));
    fs::write(&tmp, serde_json::to_vec(likes)?)?;
    fs::rename(&tmp, dir.join(name))?;
    Ok(())
}

/// Like or unlike `track` locally.
pub fn set(local: &mut LocalLikes, track: Track, like: bool, now_ms: Option<i64>) {
    local.added.retain(|t| t.id != track.id);
    if like {
        local.removed.retain(|id| *id != track.id);
        local.added.insert(
            0,
            Track {
                liked_at_ms: now_ms,
                ..track
            },
        );
    } else if !local.removed.contains(&track.id) {
        local.removed.push(track.id);
    }
}

/// SoundCloud likes with local likes added and local unlikes removed,
/// newest like first.
pub fn apply(soundcloud: Vec<Track>, local: &LocalLikes) -> Vec<Track> {
    let removed: HashSet<&str> = local.removed.iter().map(String::as_str).collect();
    let added: HashSet<&str> = local.added.iter().map(|t| t.id.as_str()).collect();
    let mut out: Vec<Track> = local
        .added
        .iter()
        .filter(|t| !removed.contains(t.id.as_str()))
        .cloned()
        .collect();
    out.extend(
        soundcloud
            .into_iter()
            .filter(|t| !removed.contains(t.id.as_str()) && !added.contains(t.id.as_str())),
    );
    // Stable: equal or unknown dates keep their order (unknown last).
    out.sort_by(|a, b| match (a.liked_at_ms, b.liked_at_ms) {
        (Some(x), Some(y)) => y.cmp(&x),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(id: &str, at: Option<i64>) -> Track {
        Track {
            id: id.into(),
            title: id.into(),
            artist: String::new(),
            duration_ms: 0,
            artwork_url: None,
            permalink_url: None,
            liked_at_ms: at,
            playable: true,
            downloadable: false,
            artist_id: None,
            plays: None,
        }
    }

    #[test]
    fn local_likes_merge_with_soundcloud_likes() {
        let sc = vec![track("sc:1", Some(30)), track("sc:2", Some(20))];
        let mut local = LocalLikes::default();
        set(&mut local, track("sc:9", None), true, Some(25));
        set(&mut local, track("sc:2", Some(20)), false, Some(26));
        let ids: Vec<String> = apply(sc, &local).into_iter().map(|t| t.id).collect();
        assert_eq!(ids, ["sc:1", "sc:9"]);
    }

    #[test]
    fn relike_after_unlike_shows_again() {
        let sc = vec![track("sc:1", Some(10))];
        let mut local = LocalLikes::default();
        set(&mut local, track("sc:1", Some(10)), false, Some(11));
        set(&mut local, track("sc:1", Some(10)), true, Some(12));
        let out = apply(sc, &local);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].liked_at_ms, Some(12));
    }
}
