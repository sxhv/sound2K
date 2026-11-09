//! Self-update from GitHub Releases.
//!
//! The app asks for `latest.json` on the newest *published* release of the
//! repository. Every update is signed with the Sound2K private key (kept by
//! the developer, never in the repo); the updater refuses anything whose
//! signature doesn't match the public key in `tauri.conf.json`. So even a
//! tampered download can't be installed.

use crate::errors::{AppError, AppResult};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

/// Where releases are published.
pub const REPO: &str = "sxhv/sound2K";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub available: bool,
    /// The release page on GitHub ("What's new").
    pub url: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

fn updater_error(e: tauri_plugin_updater::Error) -> AppError {
    AppError::Api(format!("Update failed: {e}"))
}

/// Only release pages of this repository are ever opened.
pub fn is_release_page(url: &str) -> bool {
    url.to_ascii_lowercase().starts_with(&format!(
        "https://github.com/{}/releases/",
        REPO.to_ascii_lowercase()
    ))
}

pub async fn check(app: &AppHandle) -> AppResult<UpdateInfo> {
    let current = app.package_info().version.to_string();
    let update = app
        .updater()
        .map_err(updater_error)?
        .check()
        .await
        .map_err(updater_error)?;
    Ok(match update {
        Some(u) => UpdateInfo {
            current,
            latest: u.version.clone(),
            available: true,
            url: Some(format!(
                "https://github.com/{REPO}/releases/tag/v{}",
                u.version
            )),
        },
        None => UpdateInfo {
            latest: current.clone(),
            current,
            available: false,
            url: None,
        },
    })
}

/// Download, verify and install the update, then restart. Emits
/// "update-progress" events while downloading. On Windows the installer
/// closes the app, updates it and opens it again.
pub async fn install(app: &AppHandle) -> AppResult<()> {
    let update = app
        .updater()
        .map_err(updater_error)?
        .check()
        .await
        .map_err(updater_error)?
        .ok_or_else(|| AppError::Api("You're already up to date.".into()))?;
    let mut downloaded = 0u64;
    let events = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = events.emit("update-progress", Progress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(updater_error)?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_our_release_pages() {
        assert!(is_release_page(
            "https://github.com/sxhv/sound2K/releases/tag/v0.2.0"
        ));
        assert!(!is_release_page(
            "https://github.com/evil/sound2K/releases/tag/v1"
        ));
        assert!(!is_release_page(
            "https://github.com.evil.net/sxhv/sound2K/releases/"
        ));
        assert!(!is_release_page(
            "http://github.com/sxhv/sound2K/releases/x"
        ));
    }
}
