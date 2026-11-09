//! The one place that decides where the app may store data on disk.
//!
//! Every file the app writes lives under a single folder:
//!   Windows: %LOCALAPPDATA%\Sound2K
//! Nothing here reads, lists, or deletes anything outside that folder
//! (apart from renaming the app's own pre-rename folder, see below).

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const APP_DIR_NAME: &str = "Sound2K";
/// Folder used before the rename to Sound2K.
const LEGACY_DIR_NAME: &str = "SoundCloudMini";

/// WebView2 options shared by every window. All windows use one profile,
/// so the options must be identical. These are Tauri's defaults plus a
/// 50 MB cap on the browser disk cache (artwork images).
pub const BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disk-cache-size=52428800";

/// Root of the app's private data folder.
pub fn app_data_dir(app: &AppHandle) -> tauri::Result<PathBuf> {
    #[cfg(windows)]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            return Ok(PathBuf::from(local).join(APP_DIR_NAME));
        }
    }
    // Fallback (non-Windows dev machines, or LOCALAPPDATA missing):
    // Tauri's per-app local data directory.
    app.path().app_local_data_dir()
}

/// Rename `%LOCALAPPDATA%\SoundCloudMini` to `%LOCALAPPDATA%\Sound2K` once,
/// so settings, history and cache survive the rename. Does nothing if the
/// new folder already exists or the old one doesn't. Runs before any
/// window (and so before WebView2) opens the folder.
pub fn migrate_legacy_data_dir() {
    #[cfg(windows)]
    {
        let Some(local) = std::env::var_os("LOCALAPPDATA") else {
            return;
        };
        let local = PathBuf::from(local);
        let (old, new) = (local.join(LEGACY_DIR_NAME), local.join(APP_DIR_NAME));
        if old.is_dir() && !new.exists() {
            // If the rename fails, the app simply starts fresh in the new folder.
            let _ = std::fs::rename(&old, &new);
        }
    }
}

/// WebView2 profile folder (cookies/storage of the app's own windows only).
pub fn webview_data_dir(app: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(app_data_dir(app)?.join("webview"))
}

/// Cached library data (likes, playlists, account summary).
pub fn cache_dir(app: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(app_data_dir(app)?.join("cache"))
}

/// Total size in bytes of the files under `dir` (0 if missing).
/// Symlinks are not followed, so this never leaves the folder.
pub fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => dir_size(&e.path()),
            Ok(t) if t.is_file() => e.metadata().map(|m| m.len()).unwrap_or(0),
            _ => 0,
        })
        .sum()
}
