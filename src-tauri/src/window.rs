//! Window behaviour: full window ⇄ mini-player switching (done in Rust so
//! the UI needs no broad window permissions), and "game-friendly" modes for
//! the pinned mini-player:
//!
//! - **No focus stealing:** while pinned, the mini-player is a
//!   non-activating window (`WS_EX_NOACTIVATE`). Its buttons still work,
//!   but clicking it doesn't take focus away from a game.
//! - **Click-through lock:** Ctrl+Alt+L makes the mini-player ignore the
//!   mouse completely (clicks go to whatever is underneath). Press it
//!   again to unlock.

use crate::errors::AppResult;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, WebviewWindow};

const NORMAL_MIN: (f64, f64) = (640.0, 460.0);
const MINI_SIZE: (f64, f64) = (460.0, 124.0);

/// Size to restore when leaving the mini-player.
static RESTORE_SIZE: Mutex<Option<(f64, f64)>> = Mutex::new(None);
static IN_MINI: AtomicBool = AtomicBool::new(false);
static LOCKED: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub async fn set_window_mode(window: WebviewWindow, mini: bool, pinned: bool) -> AppResult<()> {
    let scale = window.scale_factor()?;
    let current = window.inner_size()?.to_logical::<f64>(scale);
    let from = (current.width, current.height);

    // Work out the target size (the lock is released before any await).
    let target = {
        let mut restore = RESTORE_SIZE.lock().unwrap_or_else(|e| e.into_inner());
        if mini {
            if restore.is_none() {
                if window.is_maximized()? {
                    window.unmaximize()?;
                }
                *restore = Some(from);
            }
            Some(MINI_SIZE)
        } else {
            restore.take()
        }
    };

    if let Some(to) = target {
        if mini {
            window.set_min_size(Some(LogicalSize::new(MINI_SIZE.0, MINI_SIZE.1)))?;
            animate_size(&window, from, to).await?;
            window.set_resizable(false)?;
        } else {
            window.set_resizable(true)?;
            animate_size(&window, from, to).await?;
            window.set_min_size(Some(LogicalSize::new(NORMAL_MIN.0, NORMAL_MIN.1)))?;
        }
    }

    IN_MINI.store(mini, Ordering::SeqCst);
    if !mini {
        set_locked(&window, false);
    }
    // "Always on top" and no-focus-stealing only apply to the pinned mini-player.
    let game_mode = mini && pinned;
    window.set_always_on_top(game_mode)?;
    set_no_activate(&window, game_mode);
    Ok(())
}

/// Glide the window from one size to another (~200 ms, ease-out).
async fn animate_size(window: &WebviewWindow, from: (f64, f64), to: (f64, f64)) -> AppResult<()> {
    const STEPS: u32 = 12;
    for step in 1..=STEPS {
        let t = step as f64 / STEPS as f64;
        let e = 1.0 - (1.0 - t).powi(3);
        let w = from.0 + (to.0 - from.0) * e;
        let h = from.1 + (to.1 - from.1) * e;
        window.set_size(LogicalSize::new(w, h))?;
        if step < STEPS {
            tokio::time::sleep(std::time::Duration::from_millis(16)).await;
        }
    }
    Ok(())
}

/// Toggle click-through (called by the Ctrl+Alt+L hotkey). Only in mini mode.
pub fn toggle_click_through(app: &AppHandle) {
    if !IN_MINI.load(Ordering::SeqCst) {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let locked = !LOCKED.load(Ordering::SeqCst);
        set_locked(&window, locked);
    }
}

fn set_locked(window: &WebviewWindow, locked: bool) {
    if LOCKED.swap(locked, Ordering::SeqCst) == locked {
        return;
    }
    let _ = window.set_ignore_cursor_events(locked);
    let _ = window.emit("click-through", locked);
}

#[cfg(windows)]
fn set_no_activate(window: &WebviewWindow, on: bool) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let hwnd = hwnd.0 as windows_sys::Win32::Foundation::HWND;
    // SAFETY: `hwnd` is this app's own live top-level window; we only flip
    // one extended-style bit with the documented Get/SetWindowLongPtrW calls.
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let flag = WS_EX_NOACTIVATE as isize;
        let new_style = if on { style | flag } else { style & !flag };
        if new_style != style {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style);
        }
    }
}

#[cfg(not(windows))]
fn set_no_activate(_window: &WebviewWindow, _on: bool) {}
