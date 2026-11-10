//! Sound2K — application entry point.

mod auth;
mod cache;
mod colour;
mod commands;
mod discord;
mod errors;
mod history;
mod library;
mod media;
mod paths;
mod player;
mod session;
mod settings;
mod soundcloud;
mod updates;
mod window;

use tauri::{WebviewUrl, WebviewWindowBuilder};

pub fn run() {
    tauri::Builder::default()
        // Used only from Rust (open_on_soundcloud); the UI gets no opener permission.
        .plugin(tauri_plugin_opener::init())
        // Self-update: Rust-only (the UI has no updater permissions).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(soundcloud::SoundCloud::new())
        .manage(player::Player::spawn())
        .setup(|app| {
            // Older versions stored data in %LOCALAPPDATA%\SoundCloudMini.
            paths::migrate_legacy_data_dir();

            // The window is created here (not in tauri.conf.json) so the
            // WebView2 profile lives in our own app folder:
            //   %LOCALAPPDATA%\Sound2K\webview
            let webview_dir = paths::webview_data_dir(app.handle())?;

            let main = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Sound2K")
                .inner_size(1000.0, 780.0)
                .min_inner_size(640.0, 460.0)
                // Custom glass title bar (drawn by the UI); keep the
                // native shadow and resize borders.
                .decorations(false)
                .shadow(true)
                .data_directory(webview_dir)
                .additional_browser_args(paths::BROWSER_ARGS)
                .build()?;

            media::init(app.handle(), &main);
            register_hotkeys(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::get_account,
            commands::start_login,
            commands::logout,
            commands::get_liked_tracks,
            commands::get_playlists,
            commands::get_playlist_tracks,
            commands::load_settings,
            commands::save_settings,
            commands::player_load,
            commands::player_pause,
            commands::player_resume,
            commands::player_seek,
            commands::player_set_volume,
            commands::player_stop,
            commands::player_status,
            commands::load_history,
            commands::save_history,
            commands::media_update,
            commands::player_preload,
            commands::player_set_dsp,
            commands::player_spectrum,
            commands::like_track,
            commands::get_related_tracks,
            commands::open_on_soundcloud,
            commands::load_session,
            commands::save_session,
            commands::storage_info,
            commands::clear_cache,
            commands::artwork_colour,
            commands::create_playlist,
            commands::rename_playlist,
            commands::edit_playlist_track,
            commands::delete_playlist,
            commands::move_playlist_track,
            commands::download_track,
            commands::discord_presence,
            commands::discord_available,
            commands::discord_status_text,
            commands::search_tracks,
            commands::search_artists,
            commands::search_playlists,
            commands::get_artist,
            commands::get_artist_tracks,
            commands::get_artist_playlists,
            commands::get_feed,
            commands::follow_artist,
            commands::check_for_update,
            commands::open_update_page,
            commands::install_update,
            window::set_window_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sound2K");
}

/// Ctrl+Alt+L toggles click-through on the mini-player, even while a game
/// has focus. Handled entirely in Rust; the UI gets no shortcut permissions.
fn register_hotkeys(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri_plugin_global_shortcut::{
        Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
    };

    let lock_key = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyL);
    let handler_key = lock_key.clone();
    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if event.state() == ShortcutState::Pressed && shortcut == &handler_key {
                    window::toggle_click_through(app);
                }
            })
            .build(),
    )?;
    // If another program already owns Ctrl+Alt+L, the app works without it.
    let _ = app.global_shortcut().register(lock_key);
    Ok(())
}
