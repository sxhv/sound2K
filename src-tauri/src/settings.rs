//! User preferences, stored as JSON at
//! `%LOCALAPPDATA%\Sound2K\settings.json`.
//!
//! A missing or unreadable file falls back to defaults. The file is
//! written atomically (temp file + rename) inside the app folder only.

use crate::errors::AppResult;
use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::AppHandle;

const FILE_NAME: &str = "settings.json";
const TEMP_NAME: &str = "settings.json.tmp";
const MAX_ARTIST_LEN: usize = 200;
const DEFAULT_VOLUME: f32 = 0.8;
const MAX_CROSSFADE_SECS: f32 = 12.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Theme {
    #[default]
    OrangeGlass,
    DarkOrange,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SortKey {
    #[default]
    RecentlyLiked,
    OldestLiked,
    TitleAsc,
    TitleDesc,
    ArtistAsc,
    ArtistDesc,
    Shortest,
    Longest,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FilterPrefs {
    pub playable_only: bool,
    pub under3: bool,
    pub over5: bool,
    pub recent: bool,
    pub artist: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: Theme,
    pub sort: SortKey,
    pub filters: FilterPrefs,
    pub volume: f32,
    /// Seconds of overlap between tracks (0 = off, max 12).
    pub crossfade_secs: f32,
    /// Even out loudness between tracks.
    pub normalize: bool,
    pub eq_enabled: bool,
    pub eq_preset: String,
    /// Gain per band in dB (-12..12): 31 Hz … 16 kHz.
    pub eq_gains: [f32; 10],
    pub visualizer: bool,
    /// Keep playing similar tracks when the queue ends.
    pub autoplay: bool,
    /// Tint the window and mini-player with the current track's artwork.
    pub art_backgrounds: bool,
    /// Show the animated cat.
    pub mascot: bool,
    /// Show "Listening to …" on Discord (off by default: it's public).
    pub discord_status: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::default(),
            sort: SortKey::default(),
            filters: FilterPrefs::default(),
            volume: DEFAULT_VOLUME,
            crossfade_secs: 0.0,
            normalize: false,
            eq_enabled: false,
            eq_preset: "flat".into(),
            eq_gains: [0.0; 10],
            visualizer: true,
            autoplay: true,
            art_backgrounds: true,
            mascot: true,
            discord_status: false,
        }
    }
}

impl Settings {
    /// Clamp values coming from disk or from the UI into safe ranges.
    fn sanitized(mut self) -> Self {
        self.volume = if self.volume.is_finite() {
            self.volume.clamp(0.0, 1.0)
        } else {
            DEFAULT_VOLUME
        };
        let bad_artist = matches!(
            &self.filters.artist,
            Some(a) if a.trim().is_empty() || a.len() > MAX_ARTIST_LEN
        );
        if bad_artist {
            self.filters.artist = None;
        }
        self.crossfade_secs = if self.crossfade_secs.is_finite() {
            self.crossfade_secs.clamp(0.0, MAX_CROSSFADE_SECS)
        } else {
            0.0
        };
        for g in &mut self.eq_gains {
            *g = if g.is_finite() {
                g.clamp(-12.0, 12.0)
            } else {
                0.0
            };
        }
        if self.eq_preset.len() > 32 {
            self.eq_preset = "custom".into();
        }
        self
    }
}

/// Parse settings text; anything unreadable becomes the defaults.
fn parse(text: &str) -> Settings {
    match serde_json::from_str::<Settings>(text) {
        Ok(s) => s.sanitized(),
        Err(_) => {
            eprintln!("[settings] settings.json is not valid; using defaults");
            Settings::default()
        }
    }
}

pub fn load(app: &AppHandle) -> Settings {
    let Ok(dir) = paths::app_data_dir(app) else {
        return Settings::default();
    };
    match fs::read_to_string(dir.join(FILE_NAME)) {
        Ok(text) => parse(&text),
        Err(_) => Settings::default(),
    }
}

pub fn save(app: &AppHandle, settings: Settings) -> AppResult<()> {
    let dir = paths::app_data_dir(app)?;
    fs::create_dir_all(&dir)?;
    let json = serde_json::to_string_pretty(&settings.sanitized())?;
    let tmp = dir.join(TEMP_NAME);
    fs::write(&tmp, json)?;
    fs::rename(&tmp, dir.join(FILE_NAME))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_file_keeps_defaults_for_missing_fields() {
        let s = parse(r#"{ "theme": "dark-orange" }"#);
        assert_eq!(s.theme, Theme::DarkOrange);
        assert_eq!(s.sort, SortKey::RecentlyLiked);
        assert_eq!(s.volume, DEFAULT_VOLUME);
    }

    #[test]
    fn corrupt_file_falls_back_to_defaults() {
        assert_eq!(parse("{ not json"), Settings::default());
        assert_eq!(parse(r#"{ "theme": "neon" }"#), Settings::default());
    }

    #[test]
    fn values_are_clamped() {
        let s = parse(
            r#"{ "volume": 7.5, "filters": { "artist": "   " }, "crossfadeSecs": 99, "eqGains": [40,0,0,0,0,0,0,0,0,-40] }"#,
        );
        assert_eq!(s.volume, 1.0);
        assert_eq!(s.filters.artist, None);
        assert_eq!(s.crossfade_secs, 12.0);
        assert_eq!(s.eq_gains[0], 12.0);
        assert_eq!(s.eq_gains[9], -12.0);
    }

    #[test]
    fn old_settings_files_get_new_defaults() {
        let s = parse(r#"{ "theme": "orange-glass", "volume": 0.5 }"#);
        assert!(s.autoplay && s.visualizer && !s.normalize && !s.eq_enabled);
        assert_eq!(s.eq_preset, "flat");
    }

    #[test]
    fn round_trip_uses_ui_field_names() {
        let mut s = Settings::default();
        s.sort = SortKey::TitleAsc;
        s.filters.playable_only = true;
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains(r#""sort":"title-asc""#));
        assert!(json.contains(r#""playableOnly":true"#));
        assert_eq!(parse(&json), s);
    }
}
