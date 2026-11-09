//! Small JSON cache files under `%LOCALAPPDATA%\Sound2K\cache`.
//!
//! Only the fixed names below can be read or written; a missing or
//! corrupted file is treated as "no cache" and simply rebuilt.

use crate::errors::AppResult;
use crate::paths;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs;
use tauri::AppHandle;

#[derive(Clone, Copy)]
pub enum CacheFile {
    Account,
    Likes,
    Playlists,
}

impl CacheFile {
    const ALL: [CacheFile; 3] = [CacheFile::Account, CacheFile::Likes, CacheFile::Playlists];

    fn name(self) -> &'static str {
        match self {
            CacheFile::Account => "account.json",
            CacheFile::Likes => "likes.json",
            CacheFile::Playlists => "playlists.json",
        }
    }
}

pub fn read<T: DeserializeOwned>(app: &AppHandle, file: CacheFile) -> Option<T> {
    let path = paths::cache_dir(app).ok()?.join(file.name());
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn write<T: Serialize>(app: &AppHandle, file: CacheFile, value: &T) -> AppResult<()> {
    let dir = paths::cache_dir(app)?;
    fs::create_dir_all(&dir)?;
    let tmp = dir.join(format!("{}.tmp", file.name()));
    fs::write(&tmp, serde_json::to_vec(value)?)?;
    fs::rename(&tmp, dir.join(file.name()))?;
    Ok(())
}

/// Delete the app's own cache files (used on sign-out / account switch).
pub fn clear_all(app: &AppHandle) {
    let Ok(dir) = paths::cache_dir(app) else {
        return;
    };
    for file in CacheFile::ALL {
        let _ = fs::remove_file(dir.join(file.name()));
    }
}
