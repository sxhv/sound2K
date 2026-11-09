//! In-app SoundCloud sign-in.
//!
//! Opens soundcloud.com/signin in a separate window. You type your
//! credentials into SoundCloud's own page; this app never sees them. Once
//! SoundCloud sets its `oauth_token` session cookie in that window, the app
//! reads it (from this window's own cookie store only), closes the window
//! and returns the token.
//!
//! The window shows a remote website, so it is given no command
//! permissions (see capabilities/default.json) and may only navigate to
//! https:// pages on SoundCloud and the sign-in providers SoundCloud offers
//! (Google, Apple, Facebook). The current site is always shown in the
//! window title, so you can see where you are typing.

use crate::errors::{AppError, AppResult};
use crate::paths;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

pub const LOGIN_LABEL: &str = "login";
const SIGNIN_URL: &str = "https://soundcloud.com/signin";
const COOKIE_URL: &str = "https://soundcloud.com/";
const COOKIE_NAME: &str = "oauth_token";
const POLL_EVERY: Duration = Duration::from_millis(800);
const GIVE_UP_AFTER: Duration = Duration::from_secs(15 * 60);
const TITLE: &str = "Sign in to SoundCloud";

/// Hosts the sign-in window may load (exact match, or any subdomain for
/// entries starting with '.').
const ALLOWED_HOSTS: &[&str] = &[
    "soundcloud.com",
    ".soundcloud.com",
    "accounts.google.com",
    "appleid.apple.com",
    "idmsa.apple.com",
    "facebook.com",
    "www.facebook.com",
    "m.facebook.com",
];

fn host_allowed(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    ALLOWED_HOSTS
        .iter()
        .any(|allowed| match allowed.strip_prefix('.') {
            Some(base) => host.ends_with(allowed) && host.len() > base.len() + 1,
            None => host == *allowed,
        })
}

fn navigation_allowed(url: &Url) -> bool {
    match url.scheme() {
        // about:blank / about:srcdoc are used internally by pages.
        "about" => true,
        "https" => url.host_str().is_some_and(host_allowed),
        _ => false,
    }
}

pub async fn sign_in_and_capture_token(app: &AppHandle) -> AppResult<String> {
    if let Some(existing) = app.get_webview_window(LOGIN_LABEL) {
        let _ = existing.set_focus();
        return Err(AppError::Api("The sign-in window is already open.".into()));
    }

    let window = WebviewWindowBuilder::new(
        app,
        LOGIN_LABEL,
        WebviewUrl::External("about:blank".parse()?),
    )
    .title(TITLE)
    .inner_size(480.0, 760.0)
    .data_directory(paths::webview_data_dir(app)?)
    // Must match the main window: both share one WebView2 profile.
    .additional_browser_args(paths::BROWSER_ARGS)
    .on_navigation(navigation_allowed)
    .on_page_load(|window, payload| {
        if let Some(host) = payload.url().host_str() {
            let _ = window.set_title(&format!("{TITLE} — {host}"));
        }
    })
    .build()?;

    // Always start from a clean session so an old login is never reused.
    window.clear_all_browsing_data()?;
    window.navigate(SIGNIN_URL.parse()?)?;

    let cookie_url: Url = COOKIE_URL.parse()?;
    let started = Instant::now();
    loop {
        tokio::time::sleep(POLL_EVERY).await;

        let Some(window) = app.get_webview_window(LOGIN_LABEL) else {
            return Err(AppError::Cancelled);
        };
        if started.elapsed() > GIVE_UP_AFTER {
            let _ = window.close();
            return Err(AppError::Api("Sign-in timed out. Please try again.".into()));
        }
        // Reading cookies can fail briefly while a page is loading; retry.
        let Ok(cookies) = window.cookies_for_url(cookie_url.clone()) else {
            continue;
        };
        if let Some(cookie) = cookies
            .iter()
            .find(|c| c.name() == COOKIE_NAME && !c.value().is_empty())
        {
            let token = cookie.value().to_string();
            let _ = window.close();
            return Ok(token);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(u: &str) -> bool {
        navigation_allowed(&u.parse().unwrap())
    }

    #[test]
    fn allowlist() {
        assert!(ok("https://soundcloud.com/signin"));
        assert!(ok("https://secure.soundcloud.com/x"));
        assert!(ok("https://accounts.google.com/o/oauth2"));
        assert!(ok("https://appleid.apple.com/auth"));
        assert!(ok("https://www.facebook.com/dialog"));
        assert!(ok("about:blank"));
        assert!(!ok("http://soundcloud.com/"));
        assert!(!ok("https://evilsoundcloud.com/"));
        assert!(!ok("https://soundcloud.com.evil.net/"));
        assert!(!ok("https://example.com/"));
        assert!(!ok("file:///C:/"));
        assert!(!ok("javascript:alert(1)"));
    }
}
