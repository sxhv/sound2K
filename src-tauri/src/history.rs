//! Recently played tracks, stored at
//! `%LOCALAPPDATA%\Sound2K\history.json` (newest first, max 100).

use crate::errors::AppResult;
use crate::library::models::Track;
use crate::paths;
use std::fs;
use tauri::AppHandle;

const FILE_NAME: &str = "history.json";
const MAX_ENTRIES: usize = 100;

pub fn load(app: &AppHandle) -> Vec<Track> {
    let Ok(dir) = paths::app_data_dir(app) else {
        return Vec::new();
    };
    fs::read_to_string(dir.join(FILE_NAME))
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<Track>>(&text).ok())
        .map(|mut list| {
            list.truncate(MAX_ENTRIES);
            list
        })
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, mut tracks: Vec<Track>) -> AppResult<()> {
    tracks.truncate(MAX_ENTRIES);
    let dir = paths::app_data_dir(app)?;
    fs::create_dir_all(&dir)?;
    let tmp = dir.join("history.json.tmp");
    fs::write(&tmp, serde_json::to_vec(&tracks)?)?;
    fs::rename(&tmp, dir.join(FILE_NAME))?;
    Ok(())
}

pub fn clear(app: &AppHandle) {
    if let Ok(dir) = paths::app_data_dir(app) {
        let _ = fs::remove_file(dir.join(FILE_NAME));
    }
}
