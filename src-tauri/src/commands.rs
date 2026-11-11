//! Commands the frontend may call. Each one is listed in build.rs (which
//! generates its permission), granted to the main window only in
//! capabilities/default.json, and registered in lib.rs.
//!
//! When signed out, library commands return the built-in sample library.

use crate::auth::{login, token_store};
use crate::cache::{self, CacheFile};
use crate::errors::{AppError, AppResult};
use crate::history;
use crate::library::mock;
use crate::library::models::{Account, Artist, FeedItem, Paged, PlaylistSummary, Track};
use crate::local_store;
use crate::player::buffer::SharedBuffer;
use crate::player::decode::StreamDecoder;
use crate::player::dsp::DspSettings;
use crate::player::{stream, BoxedSource, Player, PlayerStatus, Preloaded};
use crate::session::{self, Session};
use crate::settings::{self, Settings};
use crate::soundcloud::{SoundCloud, StreamKind};
use rodio::Source;
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

/// Bytes to buffer before starting playback (~12 s of 128 kbps MP3).
const START_BUFFER_BYTES: usize = 192 * 1024;

#[derive(Serialize)]
pub struct AppInfo {
    name: String,
    version: String,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    let info = app.package_info();
    AppInfo {
        name: info.name.clone(),
        version: info.version.to_string(),
    }
}

/// The signed-in account, or null when signed out.
#[tauri::command]
pub async fn get_account(app: AppHandle, sc: State<'_, SoundCloud>) -> AppResult<Option<Account>> {
    let Some(token) = token_store::load()? else {
        sc.set_token(None);
        return Ok(None);
    };
    sc.set_token(Some(token));
    if let Some(account) = cache::read::<Account>(&app, CacheFile::Account) {
        return Ok(Some(account));
    }
    let account = sc.me().await?;
    cache::write(&app, CacheFile::Account, &account)?;
    Ok(Some(account))
}

/// Opens the in-app SoundCloud sign-in window and waits for it to finish.
#[tauri::command]
pub async fn start_login(app: AppHandle, sc: State<'_, SoundCloud>) -> AppResult<Account> {
    let token = login::sign_in_and_capture_token(&app).await?;
    let previous = sc.has_token();
    sc.set_token(Some(token.clone()));
    let account = match sc.me().await {
        Ok(account) => account,
        Err(e) => {
            if !previous {
                sc.set_token(None);
            }
            return Err(e);
        }
    };
    token_store::save(&token)?;
    // New session: drop anything cached for a previous account.
    cache::clear_all(&app);
    cache::write(&app, CacheFile::Account, &account)?;
    Ok(account)
}

/// Renew an expired SoundCloud session without asking you to sign in again
/// (soundcloud.com renews it in a hidden window). Returns false if it can't.
#[tauri::command]
pub async fn refresh_session(app: AppHandle, sc: State<'_, SoundCloud>) -> AppResult<bool> {
    let Some(old) = token_store::load()? else {
        return Ok(false);
    };
    let Some(token) = login::refresh_session(&app, &old).await? else {
        return Ok(false);
    };
    sc.set_token(Some(token.clone()));
    match sc.me().await {
        Ok(account) => {
            token_store::save(&token)?;
            cache::write(&app, CacheFile::Account, &account)?;
            Ok(true)
        }
        Err(_) => {
            sc.set_token(Some(old));
            Ok(false)
        }
    }
}

/// Forget the session: token, cached library, and the app's web cookies.
#[tauri::command]
pub async fn logout(
    app: AppHandle,
    sc: State<'_, SoundCloud>,
    player: State<'_, Player>,
) -> AppResult<()> {
    player.stop();
    sc.set_token(None);
    token_store::clear()?;
    cache::clear_all(&app);
    history::clear(&app);
    session::clear(&app);
    if let Some(main) = app.get_webview_window("main") {
        // Removes the SoundCloud cookies left by the sign-in window
        // (both windows share the app's own WebView2 profile).
        let _ = main.clear_all_browsing_data();
    }
    Ok(())
}

/// How much disk space the app uses, in bytes. Audio is never written to
/// disk (it is streamed into memory), so this is artwork/web cache, the
/// cached library lists, and small settings files.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    total: u64,
    web_cache: u64,
    library_cache: u64,
    other: u64,
    folder: String,
}

#[tauri::command]
pub fn storage_info(app: AppHandle) -> AppResult<StorageInfo> {
    let root = crate::paths::app_data_dir(&app)?;
    let total = crate::paths::dir_size(&root);
    let web_cache = crate::paths::dir_size(&crate::paths::webview_data_dir(&app)?);
    let library_cache = crate::paths::dir_size(&crate::paths::cache_dir(&app)?);
    Ok(StorageInfo {
        total,
        web_cache,
        library_cache,
        other: total.saturating_sub(web_cache + library_cache),
        folder: root.display().to_string(),
    })
}

/// Clear the artwork/web cache and the cached library lists. Keeps you
/// signed in (the token is in Credential Manager), and keeps settings,
/// history and the last session.
#[tauri::command]
pub fn clear_cache(app: AppHandle) -> AppResult<()> {
    cache::clear_all(&app);
    if let Some(main) = app.get_webview_window("main") {
        main.clear_all_browsing_data()?;
    }
    Ok(())
}

// --- Browsing SoundCloud: search, artists, home feed -----------------------

fn query(q: &str) -> AppResult<&str> {
    let q = q.trim();
    if q.is_empty() || q.chars().count() > 200 {
        return Err(AppError::Api("Type something to search for.".into()));
    }
    Ok(q)
}

#[tauri::command]
pub async fn search_tracks(
    sc: State<'_, SoundCloud>,
    q: String,
    next: Option<String>,
) -> AppResult<Paged<Track>> {
    sc.search_tracks(query(&q)?, next).await
}

#[tauri::command]
pub async fn search_artists(
    sc: State<'_, SoundCloud>,
    q: String,
    next: Option<String>,
) -> AppResult<Paged<Artist>> {
    sc.search_artists(query(&q)?, next).await
}

#[tauri::command]
pub async fn search_playlists(
    sc: State<'_, SoundCloud>,
    q: String,
    next: Option<String>,
) -> AppResult<Paged<PlaylistSummary>> {
    sc.search_playlists(query(&q)?, next).await
}

/// An artist by id, or by their soundcloud.com profile address.
#[tauri::command]
pub async fn get_artist(
    app: AppHandle,
    sc: State<'_, SoundCloud>,
    id: Option<u64>,
    profile_url: Option<String>,
) -> AppResult<Artist> {
    let id = match (id, profile_url) {
        (Some(id), _) => id,
        (None, Some(url)) => sc.resolve_artist(&url).await?,
        (None, None) => return Err(AppError::NotFound("artist".into())),
    };
    let mut artist = sc.artist(id).await?;
    let account = local_account(&app, &sc).await?;
    if local_store::load(&app, account).is_following(artist.id) {
        artist.following = Some(true);
    }
    Ok(artist)
}

/// `section`: "popular", "tracks" or "reposts".
#[tauri::command]
pub async fn get_artist_tracks(
    sc: State<'_, SoundCloud>,
    id: u64,
    section: String,
    next: Option<String>,
) -> AppResult<Paged<Track>> {
    sc.artist_tracks(id, &section, next).await
}

#[tauri::command]
pub async fn get_artist_playlists(
    sc: State<'_, SoundCloud>,
    id: u64,
    kind: Option<String>,
) -> AppResult<Vec<PlaylistSummary>> {
    sc.artist_playlists(id, kind.as_deref().unwrap_or("playlists"))
        .await
}

#[tauri::command]
pub async fn get_feed(
    sc: State<'_, SoundCloud>,
    next: Option<String>,
) -> AppResult<Paged<FeedItem>> {
    if !sc.has_token() {
        return Err(AppError::Auth("Sign in to see your feed.".into()));
    }
    sc.feed(next).await
}

/// Artists you follow (for Home).
#[tauri::command]
pub async fn get_followings(app: AppHandle, sc: State<'_, SoundCloud>) -> AppResult<Vec<Artist>> {
    let account = local_account(&app, &sc).await?;
    let mut list = local_store::load(&app, account).follows;
    if sc.has_token() {
        // SoundCloud follows too; if that fails, still show the local ones.
        if let Ok(remote) = sc.followings(50).await {
            for a in remote {
                if !list.iter().any(|x| x.id == a.id) {
                    list.push(a);
                }
            }
        }
    }
    Ok(list)
}

#[tauri::command]
pub async fn follow_artist(
    app: AppHandle,
    sc: State<'_, SoundCloud>,
    artist: Artist,
    follow: bool,
) -> AppResult<()> {
    // Saved in Sound2K: SoundCloud refuses follows sent by apps.
    let account = local_account(&app, &sc).await?;
    let mut data = local_store::load(&app, account);
    if !follow && !data.is_following(artist.id) {
        return Err(AppError::Api(
            "You follow them on SoundCloud itself; unfollow them on soundcloud.com.".into(),
        ));
    }
    data.set_follow(artist, follow);
    local_store::save(&app, account, &data)
}

// --- Playlist editing ------------------------------------------------------

/// The account whose Sound2K library (likes, follows, playlists) is used:
/// the signed-in user, or 0 for the sample library.
async fn local_account(app: &AppHandle, sc: &SoundCloud) -> AppResult<u64> {
    if sc.has_token() {
        account_id(app, sc).await
    } else {
        Ok(0)
    }
}

/// Owner name shown on your Sound2K playlists.
fn local_owner(app: &AppHandle) -> String {
    cache::read::<Account>(app, CacheFile::Account)
        .map(|a| a.username)
        .unwrap_or_else(|| "You".into())
}

fn local_playlist_id(id: &str) -> AppResult<&str> {
    if id.starts_with(local_store::PLAYLIST_PREFIX) {
        Ok(id)
    } else {
        Err(AppError::Api(
            "SoundCloud playlists can't be edited from apps. Copy it to Sound2K to edit it.".into(),
        ))
    }
}

/// Create a Sound2K playlist (stored on this PC), optionally with tracks.
#[tauri::command]
pub async fn create_playlist(
    app: AppHandle,
    sc: State<'_, SoundCloud>,
    title: String,
    tracks: Vec<Track>,
) -> AppResult<PlaylistSummary> {
    let account = local_account(&app, &sc).await?;
    let mut data = local_store::load(&app, account);
    let summary = data
        .create_playlist(&title, tracks)?
        .summary(&local_owner(&app), account);
    local_store::save(&app, account, &data)?;
    Ok(summary)
}

#[tauri::command]
pub async fn rename_playlist(
    app: AppHandle,
    sc: State<'_, SoundCloud>,
    playlist_id: String,
    title: String,
) -> AppResult<PlaylistSummary> {
    let id = local_playlist_id(&playlist_id)?;
    let account = local_account(&app, &sc).await?;
    let mut data = local_store::load(&app, account);
    let playlist = data.playlist_mut(id)?;
    playlist.rename(&title)?;
    let summary = playlist.summary(&local_owner(&app), account);
    local_store::save(&app, account, &data)?;
    Ok(summary)
}

/// `action`: "add", "remove", "up" or "down".
#[tauri::command]
pub async fn edit_playlist_track(
    app: AppHandle,
    sc: State<'_, SoundCloud>,
    playlist_id: String,
    track: Track,
    action: String,
) -> AppResult<PlaylistSummary> {
    let id = local_playlist_id(&playlist_id)?;
    let account = local_account(&app, &sc).await?;
    let mut data = local_store::load(&app, account);
    let playlist = data.playlist_mut(id)?;
    match action.as_str() {
        "add" => playlist.add(track)?,
        "remove" => playlist.remove(&track.id),
        "up" => playlist.nudge(&track.id, -1),
        "down" => playlist.nudge(&track.id, 1),
        _ => return Err(AppError::Api("Unknown playlist action.".into())),
    }
    let summary = playlist.summary(&local_owner(&app), account);
    local_store::save(&app, account, &data)?;
    Ok(summary)
}

/// Drag-and-drop reorder: move `track_id` to just before `before_id`
/// (or to the end when `before_id` is null).
#[tauri::command]
pub async fn move_playlist_track(
    app: AppHandle,
    sc: State<'_, SoundCloud>,
    playlist_id: String,
    track_id: String,
    before_id: Option<String>,
) -> AppResult<PlaylistSummary> {
    let id = local_playlist_id(&playlist_id)?;
    let account = local_account(&app, &sc).await?;
    let mut data = local_store::load(&app, account);
    let playlist = data.playlist_mut(id)?;
    playlist.move_before(&track_id, before_id.as_deref());
    let summary = playlist.summary(&local_owner(&app), account);
    local_store::save(&app, account, &data)?;
    Ok(summary)
}

#[tauri::command]
pub async fn delete_playlist(
    app: AppHandle,
    sc: State<'_, SoundCloud>,
    playlist_id: String,
) -> AppResult<()> {
    let id = local_playlist_id(&playlist_id)?;
    let account = local_account(&app, &sc).await?;
    let mut data = local_store::load(&app, account);
    data.delete_playlist(id);
    local_store::save(&app, account, &data)
}

/// Theme colour of a track's artwork (see colour.rs). Only fetches from
/// SoundCloud's image CDN; the image is never saved.
#[tauri::command]
pub async fn artwork_colour(sc: State<'_, SoundCloud>, url: String) -> AppResult<Option<[u8; 3]>> {
    let url: url::Url = url.parse()?;
    let host = url.host_str().unwrap_or_default();
    if url.scheme() != "https" || !(host == "sndcdn.com" || host.ends_with(".sndcdn.com")) {
        return Err(AppError::Api(
            "Artwork must come from SoundCloud's image server.".into(),
        ));
    }
    let response = sc.http().get(url).send().await?.error_for_status()?;
    if response.content_length().is_some_and(|n| n > 1_000_000) {
        return Ok(None);
    }
    let bytes = response.bytes().await?;
    Ok(crate::colour::from_jpeg(&bytes))
}

async fn account_id(app: &AppHandle, sc: &SoundCloud) -> AppResult<u64> {
    if let Some(account) = cache::read::<Account>(app, CacheFile::Account) {
        return Ok(account.id);
    }
    let account = sc.me().await?;
    cache::write(app, CacheFile::Account, &account)?;
    Ok(account.id)
}

/// Liked tracks, newest first. `refresh: false` returns the local cache
/// when there is one (instant start); `refresh: true` re-downloads.
#[tauri::command]
pub async fn get_liked_tracks(
    app: AppHandle,
    sc: State<'_, SoundCloud>,
    refresh: bool,
) -> AppResult<Vec<Track>> {
    if !sc.has_token() {
        return Ok(mock::library().liked.clone());
    }
    if !refresh {
        if let Some(cached) = cache::read::<Vec<Track>>(&app, CacheFile::Likes) {
            return Ok(cached);
        }
    }
    let user_id = account_id(&app, &sc).await?;
    let tracks = sc.liked_tracks(user_id).await?;
    cache::write(&app, CacheFile::Likes, &tracks)?;
    Ok(tracks)
}

/// Songs liked in Sound2K (kept on this PC, separate from SoundCloud likes).
#[tauri::command]
pub async fn get_local_likes(app: AppHandle, sc: State<'_, SoundCloud>) -> AppResult<Vec<Track>> {
    let account = local_account(&app, &sc).await?;
    Ok(local_store::load(&app, account).likes)
}

#[tauri::command]
pub async fn get_playlists(
    app: AppHandle,
    sc: State<'_, SoundCloud>,
    refresh: bool,
) -> AppResult<Vec<PlaylistSummary>> {
    // Your Sound2K playlists first, then SoundCloud's.
    let account = local_account(&app, &sc).await?;
    let owner = local_owner(&app);
    let mut list: Vec<PlaylistSummary> = local_store::load(&app, account)
        .playlists
        .iter()
        .map(|p| p.summary(&owner, account))
        .collect();
    if !sc.has_token() {
        list.extend(mock::library().playlist_summaries());
        return Ok(list);
    }
    let remote = match cache::read::<Vec<PlaylistSummary>>(&app, CacheFile::Playlists) {
        Some(cached) if !refresh => cached,
        _ => {
            let fresh = sc.playlists(account).await?;
            cache::write(&app, CacheFile::Playlists, &fresh)?;
            fresh
        }
    };
    list.extend(remote);
    Ok(list)
}

/// Tracks of one playlist, in playlist order.
#[tauri::command]
pub async fn get_playlist_tracks(
    app: AppHandle,
    sc: State<'_, SoundCloud>,
    id: String,
) -> AppResult<Vec<Track>> {
    if id.starts_with(local_store::PLAYLIST_PREFIX) {
        let account = local_account(&app, &sc).await?;
        return local_store::load(&app, account)
            .playlists
            .into_iter()
            .find(|p| p.id == id)
            .map(|p| p.tracks)
            .ok_or_else(|| AppError::NotFound("playlist".into()));
    }
    if id.starts_with("mock:") {
        return mock::library()
            .playlist_tracks(&id)
            .ok_or_else(|| AppError::NotFound("playlist".into()));
    }
    let numeric = id
        .strip_prefix("sc-playlist:")
        .and_then(|n| n.parse::<u64>().ok())
        .ok_or_else(|| AppError::NotFound("playlist".into()))?;
    sc.playlist_tracks(numeric).await
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Settings {
    settings::load(&app)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> AppResult<()> {
    settings::save(&app, settings)
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

/// Load and start a track. Resolves once audio has started (or fails with
/// a readable reason, e.g. a Go+-only track). A newer load cancels this one.
#[tauri::command]
pub async fn player_load(
    sc: State<'_, SoundCloud>,
    player: State<'_, Player>,
    track_id: String,
    duration_ms: u64,
    fade_ms: u64,
) -> AppResult<()> {
    let fade = Duration::from_millis(fade_ms.min(12_000));
    let generation = player.begin_load(&track_id, fade);
    match load_source(&sc, &player, generation, &track_id, duration_ms).await {
        Ok(Some(source)) => {
            player.play(generation, source, fade);
            Ok(())
        }
        // Superseded by a newer load: nothing to report.
        Ok(None) => Ok(()),
        Err(e) => {
            player.fail(generation, e.to_string());
            if player.is_current(generation) {
                Err(e)
            } else {
                Ok(())
            }
        }
    }
}

fn numeric_track_id(track_id: &str) -> AppResult<u64> {
    track_id
        .strip_prefix("sc:")
        .and_then(|n| n.parse::<u64>().ok())
        .ok_or_else(|| AppError::NotFound("track".into()))
}

/// Resolve a track's stream and start downloading it in the background.
async fn start_download(
    sc: &SoundCloud,
    track_id: &str,
) -> AppResult<(StreamKind, Arc<SharedBuffer>)> {
    let (kind, url) = sc.resolve_stream(numeric_track_id(track_id)?).await?;
    let buffer = SharedBuffer::new();
    tauri::async_runtime::spawn(stream::download(sc.http(), kind, url, Arc::clone(&buffer)));
    Ok((kind, buffer))
}

async fn load_source(
    sc: &SoundCloud,
    player: &Player,
    generation: u64,
    track_id: &str,
    duration_ms: u64,
) -> AppResult<Option<BoxedSource>> {
    if track_id.starts_with("mock:") {
        // Sample library: silence for the track's length (nothing to stream).
        let silence = rodio::source::Zero::<i16>::new(2, 44_100)
            .take_duration(Duration::from_millis(duration_ms.max(1_000)));
        return Ok(Some(Box::new(silence)));
    }
    // Use the preloaded stream if this is the track we downloaded ahead.
    let (kind, buffer) = match player.take_preloaded(track_id) {
        Some(p) => (p.kind, p.buffer),
        None => {
            let (kind, buffer) = start_download(sc, track_id).await?;
            if !player.is_current(generation) {
                buffer.cancel();
                return Ok(None);
            }
            (kind, buffer)
        }
    };
    player.attach_buffer(generation, Arc::clone(&buffer));

    // MP3 can start after a short buffer. Fragmented-MP4 (AAC) streams must
    // be complete first: symphonia's MP4 reader needs the total length.
    let waiter = Arc::clone(&buffer);
    let ready = tauri::async_runtime::spawn_blocking(move || match kind {
        StreamKind::HlsAac => waiter.wait_until_complete(),
        StreamKind::ProgressiveMp3 | StreamKind::HlsMp3 => waiter.wait_for(START_BUFFER_BYTES),
    })
    .await?;
    if !player.is_current(generation) {
        return Ok(None);
    }
    if !ready {
        return Err(AppError::Network(
            "the audio stream couldn't be downloaded".into(),
        ));
    }

    let reader = buffer.reader();
    let extension = match kind {
        StreamKind::HlsAac => "mp4",
        StreamKind::ProgressiveMp3 | StreamKind::HlsMp3 => "mp3",
    };
    let opened =
        tauri::async_runtime::spawn_blocking(move || StreamDecoder::open(reader, extension))
            .await?;
    let decoder = opened.map_err(|e| {
        AppError::Api(format!(
            "This track couldn't be decoded: {e} [format: {kind:?}, starts with: {}].",
            buffer.head_hex(12)
        ))
    })?;
    if !player.is_current(generation) {
        return Ok(None);
    }
    Ok(Some(Box::new(decoder)))
}

#[tauri::command]
pub fn player_pause(player: State<'_, Player>) {
    player.pause();
}

#[tauri::command]
pub fn player_resume(player: State<'_, Player>) {
    player.resume();
}

#[tauri::command]
pub fn player_seek(player: State<'_, Player>, position_ms: u64) {
    player.seek(Duration::from_millis(position_ms));
}

#[tauri::command]
pub fn player_set_volume(player: State<'_, Player>, volume: f32) {
    player.set_volume(volume);
}

#[tauri::command]
pub fn player_stop(player: State<'_, Player>) {
    player.stop();
}

#[tauri::command]
pub fn player_status(player: State<'_, Player>) -> PlayerStatus {
    player.status()
}

// ---------------------------------------------------------------------------
// Recently played
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn load_history(app: AppHandle) -> Vec<Track> {
    history::load(&app)
}

#[tauri::command]
pub fn save_history(app: AppHandle, tracks: Vec<Track>) -> AppResult<()> {
    history::save(&app, tracks)
}

// ---------------------------------------------------------------------------
// Windows media controls
// ---------------------------------------------------------------------------

/// Update the Windows "now playing" card (volume flyout / lock screen).
#[tauri::command]
pub fn media_update(
    app: AppHandle,
    title: String,
    artist: String,
    artwork_url: Option<String>,
    duration_ms: u64,
    state: String,
) {
    crate::media::update(
        &app,
        crate::media::NowPlaying {
            title,
            artist,
            artwork_url,
            duration_ms,
            state,
        },
    );
}

/// Start downloading the upcoming track so it can start instantly.
#[tauri::command]
pub async fn player_preload(
    sc: State<'_, SoundCloud>,
    player: State<'_, Player>,
    track_id: String,
) -> AppResult<()> {
    if track_id.starts_with("mock:") || player.is_preloaded(&track_id) {
        return Ok(());
    }
    let (kind, buffer) = start_download(&sc, &track_id).await?;
    player.set_preloaded(Preloaded {
        track_id,
        kind,
        buffer,
    });
    Ok(())
}

#[tauri::command]
pub fn player_set_dsp(
    player: State<'_, Player>,
    eq_enabled: bool,
    eq_gains: Vec<f32>,
    normalize: bool,
) {
    let mut gains = [0.0f32; 10];
    for (slot, g) in gains.iter_mut().zip(eq_gains) {
        *slot = if g.is_finite() {
            g.clamp(-12.0, 12.0)
        } else {
            0.0
        };
    }
    player.dsp.set(DspSettings {
        eq_enabled,
        eq_gains: gains,
        normalize,
    });
}

/// Visualizer bar heights (0..1).
#[tauri::command]
pub fn player_spectrum(player: State<'_, Player>, bars: usize) -> Vec<f32> {
    player.dsp.spectrum(bars)
}

// ---------------------------------------------------------------------------
// Likes, autoplay, links, session
// ---------------------------------------------------------------------------

/// Like or unlike a track on SoundCloud, then update the cached likes.
#[tauri::command]
pub async fn like_track(
    app: AppHandle,
    sc: State<'_, SoundCloud>,
    track: Track,
    like: bool,
) -> AppResult<()> {
    // Saved in Sound2K only: SoundCloud refuses likes sent by apps.
    let account = local_account(&app, &sc).await?;
    let mut data = local_store::load(&app, account);
    data.set_like(track, like);
    local_store::save(&app, account, &data)
}

/// Similar tracks for autoplay (empty for the sample library).
#[tauri::command]
pub async fn get_related_tracks(
    sc: State<'_, SoundCloud>,
    track_id: String,
) -> AppResult<Vec<Track>> {
    if !sc.has_token() || !track_id.starts_with("sc:") {
        return Ok(Vec::new());
    }
    sc.related_tracks(numeric_track_id(&track_id)?).await
}

/// Open a soundcloud.com page in the default browser. Only https links to
/// soundcloud.com are accepted.
#[tauri::command]
pub fn open_on_soundcloud(app: AppHandle, url: String) -> AppResult<()> {
    let parsed = url::Url::parse(&url)?;
    let host_ok = matches!(
        parsed.host_str(),
        Some("soundcloud.com" | "www.soundcloud.com" | "m.soundcloud.com")
    );
    if parsed.scheme() != "https" || !host_ok {
        return Err(AppError::Api(
            "Only soundcloud.com links can be opened.".into(),
        ));
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|e| AppError::Api(format!("Couldn't open the browser ({e}).")))
}

/// Download a track the artist has made downloadable, using SoundCloud's
/// own download link. The file is handed to your default browser, which
/// saves it like any other download; this app never writes it anywhere.
/// Falls back to the track's SoundCloud page (which has the download button).
#[tauri::command]
pub async fn download_track(
    app: AppHandle,
    sc: State<'_, SoundCloud>,
    track_id: String,
    permalink_url: Option<String>,
) -> AppResult<()> {
    if !sc.has_token() {
        return Err(AppError::Auth("Sign in to download tracks.".into()));
    }
    let link = sc
        .download_url(numeric_track_id(&track_id)?)
        .await
        .ok()
        .flatten();
    if let Some(link) = link {
        let parsed = url::Url::parse(&link)?;
        let host = parsed.host_str().unwrap_or_default();
        let trusted = ["sndcdn.com", "soundcloud.com", "soundcloud.cloud"]
            .iter()
            .any(|d| host == *d || host.ends_with(&format!(".{d}")));
        if parsed.scheme() == "https" && trusted {
            return app
                .opener()
                .open_url(parsed.as_str(), None::<&str>)
                .map_err(|e| AppError::Api(format!("Couldn't open the browser ({e}).")));
        }
    }
    match permalink_url {
        Some(url) => open_on_soundcloud(app, url),
        None => Err(AppError::Api(
            "SoundCloud didn't offer a download for this track.".into(),
        )),
    }
}

/// Is a newer Sound2K published on GitHub? (Only checks; installs nothing.)
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> AppResult<crate::updates::UpdateInfo> {
    crate::updates::check(&app).await
}

/// Download, verify and install the latest version, then restart.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> AppResult<()> {
    crate::updates::install(&app).await
}

/// Open a Sound2K release page in the default browser.
#[tauri::command]
pub fn open_update_page(app: AppHandle, url: String) -> AppResult<()> {
    if !crate::updates::is_release_page(&url) {
        return Err(AppError::Api("Not a Sound2K release page.".into()));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| AppError::Api(format!("Couldn't open the browser ({e}).")))
}

/// Show (or clear, with `null`) the Discord "Listening to" status.
#[tauri::command]
pub fn discord_presence(presence: Option<crate::discord::Presence>) {
    crate::discord::set(presence);
}

/// What the Discord connection is doing (shown in Settings).
#[tauri::command]
pub fn discord_status_text() -> String {
    crate::discord::status()
}

/// Whether a Discord application id is set (the feature is available).
#[tauri::command]
pub fn discord_available() -> bool {
    !crate::discord::DISCORD_APP_ID.is_empty()
}

#[tauri::command]
pub fn load_session(app: AppHandle) -> Session {
    session::load(&app)
}

#[tauri::command]
pub fn save_session(app: AppHandle, session: Session) -> AppResult<()> {
    session::save(&app, session)
}
