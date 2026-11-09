//! "Pick up where you left off": the queue, current track and position,
//! stored at `%LOCALAPPDATA%\Sound2K\session.json`.

use crate::errors::AppResult;
use crate::library::models::Track;
use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::AppHandle;

const FILE_NAME: &str = "session.json";
const MAX_TRACKS: usize = 5_000;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Session {
    pub current: Option<Track>,
    pub position_ms: u64,
    pub queue: Vec<Track>,
    pub context: Vec<Track>,
}

pub fn load(app: &AppHandle) -> Session {
    paths::app_data_dir(app)
        .ok()
        .and_then(|dir| fs::read_to_string(dir.join(FILE_NAME)).ok())
        .and_then(|text| serde_json::from_str::<Session>(&text).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, mut session: Session) -> AppResult<()> {
    session.queue.truncate(MAX_TRACKS);
    session.context.truncate(MAX_TRACKS);
    let dir = paths::app_data_dir(app)?;
    fs::create_dir_all(&dir)?;
    let tmp = dir.join("session.json.tmp");
    fs::write(&tmp, serde_json::to_vec(&session)?)?;
    fs::rename(&tmp, dir.join(FILE_NAME))?;
    Ok(())
}

pub fn clear(app: &AppHandle) {
    if let Ok(dir) = paths::app_data_dir(app) {
        let _ = fs::remove_file(dir.join(FILE_NAME));
    }
}
