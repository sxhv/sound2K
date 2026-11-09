//! Windows media integration (System Media Transport Controls): the
//! keyboard's play/pause/next/previous keys and the "now playing" card in
//! the volume flyout / lock screen.
//!
//! The controls must live on the main (UI) thread, so they are kept in a
//! thread-local there and updated via `run_on_main_thread`. Button presses
//! are forwarded to the UI as a `media-control` event.

use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, PlatformConfig};
use std::cell::RefCell;
use std::time::Duration;
use tauri::{AppHandle, Emitter, WebviewWindow};

thread_local! {
    static CONTROLS: RefCell<Option<MediaControls>> = const { RefCell::new(None) };
}

/// Call once from `setup` (main thread) after the main window exists.
/// If media controls are unavailable, the app simply works without them.
pub fn init(app: &AppHandle, window: &WebviewWindow) {
    #[cfg(windows)]
    let hwnd = window.hwnd().ok().map(|h| h.0 as *mut std::ffi::c_void);
    #[cfg(not(windows))]
    let hwnd = {
        let _ = window;
        None
    };

    let config = PlatformConfig {
        display_name: "Sound2K",
        dbus_name: "sound2k",
        hwnd,
    };
    let Ok(mut controls) = MediaControls::new(config) else {
        return;
    };
    let emitter = app.clone();
    let attached = controls.attach(move |event| {
        let action = match event {
            MediaControlEvent::Play => "play",
            MediaControlEvent::Pause | MediaControlEvent::Stop => "pause",
            MediaControlEvent::Toggle => "toggle",
            MediaControlEvent::Next => "next",
            MediaControlEvent::Previous => "previous",
            _ => return,
        };
        let _ = emitter.emit("media-control", action);
    });
    if attached.is_ok() {
        CONTROLS.with(|cell| *cell.borrow_mut() = Some(controls));
    }
}

pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub artwork_url: Option<String>,
    pub duration_ms: u64,
    /// "playing", "paused" or "stopped"
    pub state: String,
}

pub fn update(app: &AppHandle, now: NowPlaying) {
    let _ = app.run_on_main_thread(move || {
        CONTROLS.with(|cell| {
            let mut slot = cell.borrow_mut();
            let Some(controls) = slot.as_mut() else {
                return;
            };
            if now.state == "stopped" {
                let _ = controls.set_playback(MediaPlayback::Stopped);
                return;
            }
            let _ = controls.set_metadata(MediaMetadata {
                title: Some(&now.title),
                artist: Some(&now.artist),
                album: None,
                cover_url: now.artwork_url.as_deref(),
                duration: Some(Duration::from_millis(now.duration_ms)),
            });
            let playback = if now.state == "playing" {
                MediaPlayback::Playing { progress: None }
            } else {
                MediaPlayback::Paused { progress: None }
            };
            let _ = controls.set_playback(playback);
        });
    });
}
