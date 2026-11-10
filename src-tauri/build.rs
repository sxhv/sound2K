// Declaring the app's commands here makes Tauri generate a permission for
// each one. A window can then only call the commands its capability file
// grants: the main window gets them all; the SoundCloud sign-in window
// (which shows a remote website) gets none.
const COMMANDS: &[&str] = &[
    "app_info",
    "get_account",
    "start_login",
    "logout",
    "get_liked_tracks",
    "get_playlists",
    "get_playlist_tracks",
    "load_settings",
    "save_settings",
    "player_load",
    "player_pause",
    "player_resume",
    "player_seek",
    "player_set_volume",
    "player_stop",
    "player_status",
    "load_history",
    "save_history",
    "media_update",
    "set_window_mode",
    "player_preload",
    "player_set_dsp",
    "player_spectrum",
    "like_track",
    "get_related_tracks",
    "open_on_soundcloud",
    "load_session",
    "save_session",
    "storage_info",
    "clear_cache",
    "artwork_colour",
    "create_playlist",
    "rename_playlist",
    "edit_playlist_track",
    "delete_playlist",
    "move_playlist_track",
    "download_track",
    "discord_presence",
    "discord_available",
    "discord_status_text",
    "search_tracks",
    "search_artists",
    "search_playlists",
    "get_artist",
    "get_artist_tracks",
    "get_artist_playlists",
    "get_feed",
    "follow_artist",
    "get_followings",
    "repost_track",
    "get_reposted_ids",
    "check_for_update",
    "open_update_page",
    "install_update",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
