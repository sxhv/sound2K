use super::api_types::{
    rank_transcodings, ApiLike, ApiPlaylist, ApiPlaylistLike, ApiStreamItem, ApiStreamUrl,
    ApiTrack, ApiUser, ApiUserFull, Page, StreamKind,
};
use crate::errors::{AppError, AppResult};
use crate::library::models::{Account, Artist, FeedItem, Paged, PlaylistSummary, Track};
use regex::Regex;
use reqwest::header::{HeaderValue, ACCEPT, AUTHORIZATION, ORIGIN, REFERER};
use reqwest::{Method, StatusCode};
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use url::Url;

const API_HOST: &str = "api-v2.soundcloud.com";
const API_BASE: &str = "https://api-v2.soundcloud.com";
const WEB_HOME: &str = "https://soundcloud.com/";
const SCRIPT_HOST_PREFIX: &str = "https://a-v2.sndcdn.com/assets/";
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const LIKES_PAGE_SIZE: u32 = 200;
const PLAYLIST_PAGE_SIZE: u32 = 50;
/// Safety cap: 100 pages × 200 = 20,000 likes.
const MAX_PAGES: usize = 100;
/// /tracks?ids= accepts up to 50 ids per request.
const IDS_PER_REQUEST: usize = 50;
const MAX_ATTEMPTS: u32 = 4;
/// Albums / playlists on an artist page: up to 10 × 50.
const ARTIST_SETS_MAX_PAGES: usize = 10;
/// Your reposts we check for the Repost button: up to 5 × 100.
const REPOSTS_MAX_PAGES: usize = 5;

/// Shared SoundCloud client (one per app, managed by Tauri).
pub struct SoundCloud {
    http: reqwest::Client,
    client_id: Mutex<Option<String>>,
    token: Mutex<Option<String>>,
}

impl SoundCloud {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(20))
            .https_only(true)
            .build()
            .expect("HTTP client configuration is valid");
        Self {
            http,
            client_id: Mutex::new(None),
            token: Mutex::new(None),
        }
    }

    pub fn set_token(&self, token: Option<String>) {
        if let Ok(mut slot) = self.token.lock() {
            *slot = token;
        }
    }

    pub fn has_token(&self) -> bool {
        self.token.lock().map(|t| t.is_some()).unwrap_or(false)
    }

    fn token(&self) -> Option<String> {
        self.token.lock().ok().and_then(|t| t.clone())
    }

    fn cached_client_id(&self) -> Option<String> {
        self.client_id.lock().ok().and_then(|c| c.clone())
    }

    fn set_client_id(&self, id: Option<String>) {
        if let Ok(mut slot) = self.client_id.lock() {
            *slot = id;
        }
    }

    /// SoundCloud's web app embeds a public client id in its JavaScript.
    /// Find it the same way the website's own player does.
    async fn client_id(&self) -> AppResult<String> {
        if let Some(id) = self.cached_client_id() {
            return Ok(id);
        }
        let html = self
            .http
            .get(WEB_HOME)
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        let script_re = Regex::new(r#"<script[^>]+src="([^"]+)""#).expect("valid regex");
        let id_re = Regex::new(r#"client_id\s*[:=]\s*"([A-Za-z0-9]{32})""#).expect("valid regex");

        let scripts: Vec<&str> = script_re
            .captures_iter(&html)
            .filter_map(|c| c.get(1).map(|m| m.as_str()))
            .filter(|src| src.starts_with(SCRIPT_HOST_PREFIX))
            .collect();
        // The id usually lives in one of the last bundles.
        for src in scripts.iter().rev() {
            let js = self
                .http
                .get(*src)
                .send()
                .await?
                .error_for_status()?
                .text()
                .await?;
            if let Some(found) = id_re.captures(&js).and_then(|c| c.get(1)) {
                let id = found.as_str().to_string();
                self.set_client_id(Some(id.clone()));
                return Ok(id);
            }
        }
        Err(AppError::Api(
            "Couldn't connect to SoundCloud: its website changed in a way this app doesn't understand yet.".into(),
        ))
    }

    /// GET a JSON resource from api-v2.
    async fn get_json<T: DeserializeOwned>(&self, address: &str) -> AppResult<T> {
        let resp = self.request(Method::GET, address).await?;
        Ok(resp.json::<T>().await?)
    }

    /// Send a request to api-v2 with the session token. Retries on rate
    /// limits, and once with a fresh client id on 401/403.
    async fn request(&self, method: Method, address: &str) -> AppResult<reqwest::Response> {
        self.send(method, address, None).await
    }

    async fn send(
        &self,
        method: Method,
        address: &str,
        body: Option<&serde_json::Value>,
    ) -> AppResult<reqwest::Response> {
        let mut refreshed_client_id = false;
        for attempt in 0..MAX_ATTEMPTS {
            let mut url = Url::parse(address)?;
            if url.scheme() != "https" || url.host_str() != Some(API_HOST) {
                return Err(AppError::Api(
                    "Refused to contact an unexpected server.".into(),
                ));
            }
            let client_id = self.client_id().await?;
            let kept: Vec<(String, String)> = url
                .query_pairs()
                .filter(|(k, _)| k != "client_id")
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect();
            url.query_pairs_mut()
                .clear()
                .extend_pairs(kept)
                .append_pair("client_id", &client_id);

            let mut req = self
                .http
                .request(method.clone(), url)
                .header(ACCEPT, HeaderValue::from_static("application/json"))
                // The same origin soundcloud.com's own requests carry.
                .header(ORIGIN, HeaderValue::from_static("https://soundcloud.com"))
                .header(REFERER, HeaderValue::from_static("https://soundcloud.com/"));
            if let Some(token) = self.token() {
                let mut value = HeaderValue::from_str(&format!("OAuth {token}")).map_err(|_| {
                    AppError::Auth("Stored session is invalid. Please sign in again.".into())
                })?;
                value.set_sensitive(true);
                req = req.header(AUTHORIZATION, value);
            }
            if let Some(body) = body {
                req = req.json(body);
            } else if method != Method::GET {
                // Likes, reposts and follows have no body; send an explicit
                // empty one (Content-Length: 0), like a browser does.
                req = req.body("");
            }

            let resp = req.send().await?;
            match resp.status() {
                s if s.is_success() => return Ok(resp),
                StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN if !refreshed_client_id => {
                    // Could be a rotated client id rather than a bad session.
                    refreshed_client_id = true;
                    self.set_client_id(None);
                }
                StatusCode::UNAUTHORIZED if method == Method::GET => {
                    return Err(AppError::Auth(
                        "Your SoundCloud session has expired. Please sign in again.".into(),
                    ))
                }
                // A rejected like / repost / follow doesn't necessarily mean
                // the session is gone, so don't report it as expired.
                StatusCode::UNAUTHORIZED => {
                    return Err(AppError::Api(
                        "SoundCloud didn't accept this from the app (401). Try signing out and in again.".into(),
                    ))
                }
                StatusCode::FORBIDDEN => {
                    // Tell bot-protection blocks apart from "not allowed".
                    let bot_header = resp.headers().contains_key("x-datadome")
                        || resp.headers().contains_key("x-dd-b");
                    let body = resp.text().await.unwrap_or_default();
                    let bot = bot_header
                        || body.contains("captcha-delivery")
                        || body.to_ascii_lowercase().contains("datadome");
                    return Err(AppError::Api(if bot {
                        "SoundCloud's bot protection blocked this (403, DataDome).".into()
                    } else {
                        "SoundCloud refused this request (403, not bot protection).".into()
                    }));
                }
                StatusCode::NOT_FOUND => return Err(AppError::NotFound("SoundCloud item".into())),
                StatusCode::TOO_MANY_REQUESTS
                | StatusCode::SERVICE_UNAVAILABLE
                | StatusCode::BAD_GATEWAY => {
                    // Back off: 2 s, 4 s, 8 s.
                    tokio::time::sleep(Duration::from_secs(2u64 << attempt)).await;
                }
                other => {
                    return Err(AppError::Api(format!(
                        "SoundCloud returned an error ({other})."
                    )))
                }
            }
        }
        Err(AppError::Api(
            "SoundCloud is busy (rate limited). Try again in a minute.".into(),
        ))
    }

    pub async fn me(&self) -> AppResult<Account> {
        let user: ApiUser = self.get_json(&format!("{API_BASE}/me")).await?;
        Ok(user.into())
    }

    /// All liked tracks, newest first (the order SoundCloud returns).
    pub async fn liked_tracks(&self, user_id: u64) -> AppResult<Vec<Track>> {
        let mut next = Some(format!(
            "{API_BASE}/users/{user_id}/track_likes?limit={LIKES_PAGE_SIZE}&linked_partitioning=1"
        ));
        let mut tracks = Vec::new();
        let mut pages = 0;
        while let Some(address) = next.take() {
            let page: Page<ApiLike> = self.get_json(&address).await?;
            // Deleted tracks come back without a `track`; skip them.
            tracks.extend(page.collection.into_iter().filter_map(ApiLike::into_track));
            pages += 1;
            if pages < MAX_PAGES {
                next = page.next_href;
            }
        }
        Ok(tracks)
    }

    /// The user's own playlists, then playlists they liked.
    pub async fn playlists(&self, user_id: u64) -> AppResult<Vec<PlaylistSummary>> {
        let own: Vec<ApiPlaylist> = self
            .collect_pages(format!(
                "{API_BASE}/users/{user_id}/playlists?limit={PLAYLIST_PAGE_SIZE}&linked_partitioning=1"
            ))
            .await?;
        let mut out: Vec<PlaylistSummary> = own.iter().map(ApiPlaylist::summary).collect();

        // Liked playlists are a bonus: if this endpoint fails, keep the rest.
        let liked: AppResult<Vec<ApiPlaylistLike>> = self
            .collect_pages(format!(
                "{API_BASE}/users/{user_id}/playlist_likes?limit={PLAYLIST_PAGE_SIZE}&linked_partitioning=1"
            ))
            .await;
        if let Ok(liked) = liked {
            for p in liked.into_iter().filter_map(|l| l.playlist) {
                let summary = p.summary();
                if !out.iter().any(|o| o.id == summary.id) {
                    out.push(summary);
                }
            }
        }
        Ok(out)
    }

    /// All tracks of one playlist, in playlist order.
    pub async fn playlist_tracks(&self, playlist_id: u64) -> AppResult<Vec<Track>> {
        let playlist: ApiPlaylist = self
            .get_json(&format!(
                "{API_BASE}/playlists/{playlist_id}?representation=full"
            ))
            .await?;
        let order: Vec<u64> = playlist.tracks.iter().map(|t| t.id).collect();
        let mut full: HashMap<u64, ApiTrack> = HashMap::new();
        let mut missing = Vec::new();
        for t in playlist.tracks {
            if t.is_stub() {
                missing.push(t.id);
            } else {
                full.insert(t.id, t);
            }
        }
        for chunk in missing.chunks(IDS_PER_REQUEST) {
            let ids = chunk
                .iter()
                .map(u64::to_string)
                .collect::<Vec<_>>()
                .join(",");
            let fetched: Vec<ApiTrack> = self
                .get_json(&format!("{API_BASE}/tracks?ids={ids}"))
                .await?;
            for t in fetched {
                full.insert(t.id, t);
            }
        }
        // Tracks that are private/deleted are not returned; skip them.
        Ok(order
            .into_iter()
            .filter_map(|id| full.remove(&id))
            .map(|t| t.into_track(None))
            .collect())
    }

    /// Like (`true`) or unlike (`false`) a track. This is the only request
    /// that changes anything on the account.
    pub async fn set_like(&self, user_id: u64, track_id: u64, like: bool) -> AppResult<()> {
        let method = if like { Method::PUT } else { Method::DELETE };
        let address = format!("{API_BASE}/users/{user_id}/track_likes/{track_id}");
        match self.request(method, &address).await {
            Ok(_) => Ok(()),
            // Unliking something that isn't liked is fine.
            Err(AppError::NotFound(_)) if !like => Ok(()),
            Err(e) => Err(e),
        }
    }

    /// Create a playlist on your account.
    pub async fn create_playlist(
        &self,
        title: &str,
        private: bool,
        track_ids: &[u64],
    ) -> AppResult<PlaylistSummary> {
        let body = serde_json::json!({ "playlist": {
            "title": title,
            "sharing": if private { "private" } else { "public" },
            "tracks": track_ids,
        }});
        let resp = self
            .send(Method::POST, &format!("{API_BASE}/playlists"), Some(&body))
            .await?;
        Ok(resp.json::<ApiPlaylist>().await?.summary())
    }

    /// Track ids of a playlist exactly as stored (including tracks that are
    /// private or deleted, so editing never drops them by accident).
    async fn playlist_track_ids(&self, playlist_id: u64) -> AppResult<Vec<u64>> {
        let playlist: ApiPlaylist = self
            .get_json(&format!("{API_BASE}/playlists/{playlist_id}"))
            .await?;
        Ok(playlist.tracks.iter().map(|t| t.id).collect())
    }

    /// Change a playlist's title and/or track list.
    async fn update_playlist(
        &self,
        playlist_id: u64,
        title: Option<&str>,
        track_ids: Option<&[u64]>,
    ) -> AppResult<PlaylistSummary> {
        let mut playlist = serde_json::Map::new();
        if let Some(title) = title {
            playlist.insert("title".into(), title.into());
        }
        if let Some(ids) = track_ids {
            playlist.insert("tracks".into(), serde_json::json!(ids));
        }
        let body = serde_json::json!({ "playlist": playlist });
        let resp = self
            .send(
                Method::PUT,
                &format!("{API_BASE}/playlists/{playlist_id}"),
                Some(&body),
            )
            .await?;
        // If the reply isn't the usual playlist object, read it back instead.
        match resp.json::<ApiPlaylist>().await {
            Ok(p) => Ok(p.summary()),
            Err(_) => Ok(self
                .get_json::<ApiPlaylist>(&format!("{API_BASE}/playlists/{playlist_id}"))
                .await?
                .summary()),
        }
    }

    pub async fn rename_playlist(
        &self,
        playlist_id: u64,
        title: &str,
    ) -> AppResult<PlaylistSummary> {
        self.update_playlist(playlist_id, Some(title), None).await
    }

    /// Add a track to the end (no-op if it's already there).
    pub async fn add_to_playlist(
        &self,
        playlist_id: u64,
        track_id: u64,
    ) -> AppResult<PlaylistSummary> {
        let mut ids = self.playlist_track_ids(playlist_id).await?;
        if !ids.contains(&track_id) {
            ids.push(track_id);
        }
        self.update_playlist(playlist_id, None, Some(&ids)).await
    }

    pub async fn remove_from_playlist(
        &self,
        playlist_id: u64,
        track_id: u64,
    ) -> AppResult<PlaylistSummary> {
        let mut ids = self.playlist_track_ids(playlist_id).await?;
        ids.retain(|id| *id != track_id);
        self.update_playlist(playlist_id, None, Some(&ids)).await
    }

    /// Move a track one place up (`-1`) or down (`1`).
    pub async fn move_in_playlist(
        &self,
        playlist_id: u64,
        track_id: u64,
        delta: i32,
    ) -> AppResult<PlaylistSummary> {
        let mut ids = self.playlist_track_ids(playlist_id).await?;
        if let Some(i) = ids.iter().position(|id| *id == track_id) {
            let j = i as i64 + delta as i64;
            if j >= 0 && (j as usize) < ids.len() {
                ids.swap(i, j as usize);
            }
        }
        self.update_playlist(playlist_id, None, Some(&ids)).await
    }

    /// Move a track to just before `before` (or to the end when `None`).
    /// Tracks hidden in the app (private/deleted) keep their places.
    pub async fn move_in_playlist_before(
        &self,
        playlist_id: u64,
        track_id: u64,
        before: Option<u64>,
    ) -> AppResult<PlaylistSummary> {
        let mut ids = self.playlist_track_ids(playlist_id).await?;
        let Some(from) = ids.iter().position(|id| *id == track_id) else {
            return Err(AppError::NotFound("track in playlist".into()));
        };
        ids.remove(from);
        let to = before
            .and_then(|b| ids.iter().position(|id| *id == b))
            .unwrap_or(ids.len());
        ids.insert(to, track_id);
        self.update_playlist(playlist_id, None, Some(&ids)).await
    }

    pub async fn delete_playlist(&self, playlist_id: u64) -> AppResult<()> {
        self.request(
            Method::DELETE,
            &format!("{API_BASE}/playlists/{playlist_id}"),
        )
        .await?;
        Ok(())
    }

    /// The official download link for a track whose artist allows
    /// downloads (`None` if SoundCloud doesn't offer one).
    pub async fn download_url(&self, track_id: u64) -> AppResult<Option<String>> {
        #[derive(serde::Deserialize)]
        struct Download {
            #[serde(rename = "redirectUri")]
            redirect_uri: Option<String>,
        }
        match self
            .get_json::<Download>(&format!("{API_BASE}/tracks/{track_id}/download"))
            .await
        {
            Ok(d) => Ok(d.redirect_uri),
            Err(AppError::NotFound(_)) => Ok(None),
            Err(e) => Err(e),
        }
    }

    // --- Browsing SoundCloud ---------------------------------------------

    /// First page at `first`, or the page at `next` (a `next_href` we got
    /// from SoundCloud earlier; `request` re-checks its host).
    async fn page<T: DeserializeOwned>(
        &self,
        first: String,
        next: Option<String>,
    ) -> AppResult<Page<T>> {
        self.get_json(&next.unwrap_or(first)).await
    }

    fn tracks_page(page: Page<ApiTrack>) -> Paged<Track> {
        Paged {
            items: page
                .collection
                .into_iter()
                .filter(|t| !t.is_stub())
                .map(|t| t.into_track(None))
                .collect(),
            next: page.next_href,
        }
    }

    pub async fn search_tracks(&self, q: &str, next: Option<String>) -> AppResult<Paged<Track>> {
        let first = format!(
            "{API_BASE}/search/tracks?q={}&limit=30&linked_partitioning=1",
            urlencode(q)
        );
        Ok(Self::tracks_page(self.page(first, next).await?))
    }

    pub async fn search_artists(&self, q: &str, next: Option<String>) -> AppResult<Paged<Artist>> {
        let first = format!(
            "{API_BASE}/search/users?q={}&limit=30&linked_partitioning=1",
            urlencode(q)
        );
        let page: Page<ApiUserFull> = self.page(first, next).await?;
        Ok(Paged {
            items: page
                .collection
                .into_iter()
                .map(|u| u.into_artist(None))
                .collect(),
            next: page.next_href,
        })
    }

    pub async fn search_playlists(
        &self,
        q: &str,
        next: Option<String>,
    ) -> AppResult<Paged<PlaylistSummary>> {
        let first = format!(
            "{API_BASE}/search/playlists?q={}&limit=30&linked_partitioning=1",
            urlencode(q)
        );
        let page: Page<ApiPlaylist> = self.page(first, next).await?;
        Ok(Paged {
            items: page.collection.iter().map(ApiPlaylist::summary).collect(),
            next: page.next_href,
        })
    }

    /// An artist's profile. `following` is filled in when signed in.
    pub async fn artist(&self, user_id: u64) -> AppResult<Artist> {
        let user: ApiUserFull = self
            .get_json(&format!("{API_BASE}/users/{user_id}"))
            .await?;
        let following = if self.token().is_some() {
            self.following_ids()
                .await
                .ok()
                .map(|ids| ids.contains(&user_id))
        } else {
            None
        };
        Ok(user.into_artist(following))
    }

    /// Find an artist from their soundcloud.com page address.
    pub async fn resolve_artist(&self, profile_url: &str) -> AppResult<u64> {
        let url = Url::parse(profile_url)?;
        if url.scheme() != "https"
            || !matches!(
                url.host_str(),
                Some("soundcloud.com" | "www.soundcloud.com" | "m.soundcloud.com")
            )
        {
            return Err(AppError::Api("Not a SoundCloud profile address.".into()));
        }
        #[derive(serde::Deserialize)]
        struct Resolved {
            id: u64,
            #[serde(default)]
            kind: Option<String>,
        }
        let found: Resolved = self
            .get_json(&format!(
                "{API_BASE}/resolve?url={}",
                urlencode(url.as_str())
            ))
            .await?;
        if found.kind.as_deref() != Some("user") {
            return Err(AppError::NotFound("artist".into()));
        }
        Ok(found.id)
    }

    /// `section`: "popular", "tracks" or "reposts".
    pub async fn artist_tracks(
        &self,
        user_id: u64,
        section: &str,
        next: Option<String>,
    ) -> AppResult<Paged<Track>> {
        match section {
            "popular" => {
                let first =
                    format!("{API_BASE}/users/{user_id}/toptracks?limit=20&linked_partitioning=1");
                Ok(Self::tracks_page(self.page(first, next).await?))
            }
            "tracks" => {
                let first =
                    format!("{API_BASE}/users/{user_id}/tracks?limit=50&linked_partitioning=1");
                Ok(Self::tracks_page(self.page(first, next).await?))
            }
            "reposts" => {
                let first = format!(
                    "{API_BASE}/stream/users/{user_id}/reposts?limit=50&linked_partitioning=1"
                );
                let page: Page<ApiStreamItem> = self.page(first, next).await?;
                Ok(Paged {
                    items: page
                        .collection
                        .into_iter()
                        .filter_map(|i| i.into_feed_item().map(|f| f.track))
                        .collect(),
                    next: page.next_href,
                })
            }
            _ => Err(AppError::Api("Unknown artist section.".into())),
        }
    }

    /// `kind`: "albums" (albums and compilations), "eps" (EPs and singles)
    /// or "playlists" (ordinary playlists).
    pub async fn artist_playlists(
        &self,
        user_id: u64,
        kind: &str,
    ) -> AppResult<Vec<PlaylistSummary>> {
        let path = match kind {
            "albums" | "eps" => "albums",
            "playlists" => "playlists_without_albums",
            _ => return Err(AppError::Api("Unknown artist section.".into())),
        };
        let first = format!("{API_BASE}/users/{user_id}/{path}?limit=50&linked_partitioning=1");
        let items: Vec<ApiPlaylist> = self.collect_pages_max(first, ARTIST_SETS_MAX_PAGES).await?;
        let wanted = |t: Option<&str>| match kind {
            "albums" => !matches!(t, Some("ep") | Some("single")),
            "eps" => matches!(t, Some("ep") | Some("single")),
            _ => true,
        };
        Ok(items
            .iter()
            .map(ApiPlaylist::summary)
            .filter(|p| wanted(p.set_type.as_deref()))
            .collect())
    }

    /// Repost (`true`) or remove your repost of (`false`) a track.
    pub async fn set_repost(&self, track_id: u64, repost: bool) -> AppResult<()> {
        let method = if repost { Method::PUT } else { Method::DELETE };
        let address = format!("{API_BASE}/me/track_reposts/{track_id}");
        match self.request(method, &address).await {
            Ok(_) => Ok(()),
            Err(AppError::NotFound(_)) if !repost => Ok(()),
            Err(e) => Err(e),
        }
    }

    /// Ids of tracks you've reposted (your most recent reposts).
    pub async fn reposted_ids(&self, user_id: u64) -> AppResult<Vec<String>> {
        let first =
            format!("{API_BASE}/stream/users/{user_id}/reposts?limit=100&linked_partitioning=1");
        let items: Vec<ApiStreamItem> = self.collect_pages_max(first, REPOSTS_MAX_PAGES).await?;
        Ok(items
            .into_iter()
            .filter_map(|i| i.into_feed_item().map(|f| f.track.id))
            .collect())
    }

    /// Your home feed: uploads and reposts from people you follow.
    pub async fn feed(&self, next: Option<String>) -> AppResult<Paged<FeedItem>> {
        let first = format!("{API_BASE}/stream?limit=40&linked_partitioning=1");
        let page: Page<ApiStreamItem> = self.page(first, next).await?;
        Ok(Paged {
            items: page
                .collection
                .into_iter()
                .filter_map(ApiStreamItem::into_feed_item)
                .collect(),
            next: page.next_href,
        })
    }

    /// People you follow (most recently followed first), up to `limit`.
    pub async fn followings(&self, limit: u32) -> AppResult<Vec<Artist>> {
        let page: Page<ApiUserFull> = self
            .get_json(&format!(
                "{API_BASE}/me/followings?limit={limit}&linked_partitioning=1"
            ))
            .await?;
        Ok(page
            .collection
            .into_iter()
            .map(|u| u.into_artist(Some(true)))
            .collect())
    }

    /// Ids of everyone you follow.
    async fn following_ids(&self) -> AppResult<Vec<u64>> {
        let ids: Vec<u64> = self
            .collect_pages(format!(
                "{API_BASE}/me/followings/ids?limit=5000&linked_partitioning=1"
            ))
            .await?;
        Ok(ids)
    }

    /// Follow (`true`) or unfollow (`false`) a SoundCloud user.
    pub async fn set_follow(&self, user_id: u64, follow: bool) -> AppResult<()> {
        let method = if follow { Method::POST } else { Method::DELETE };
        match self
            .request(method, &format!("{API_BASE}/me/followings/{user_id}"))
            .await
        {
            Ok(_) => Ok(()),
            Err(AppError::NotFound(_)) if !follow => Ok(()),
            Err(e) => Err(e),
        }
    }

    /// Tracks SoundCloud considers similar (used for autoplay).
    pub async fn related_tracks(&self, track_id: u64) -> AppResult<Vec<Track>> {
        let page: Page<ApiTrack> = self
            .get_json(&format!(
                "{API_BASE}/tracks/{track_id}/related?limit=30&linked_partitioning=1"
            ))
            .await?;
        Ok(page
            .collection
            .into_iter()
            .filter(|t| !t.is_stub())
            .map(|t| t.into_track(None))
            .collect())
    }

    /// The HTTP client, for downloading stream data from SoundCloud's CDN.
    /// (No session token is ever sent to the CDN.)
    pub fn http(&self) -> reqwest::Client {
        self.http.clone()
    }

    /// Find a playable (plain MP3) stream for a track and return its
    /// short-lived, signed URL.
    pub async fn resolve_stream(&self, track_id: u64) -> AppResult<(StreamKind, Url)> {
        let track: ApiTrack = self
            .get_json(&format!("{API_BASE}/tracks/{track_id}"))
            .await
            .map_err(|e| step("Couldn't load this track's details", e))?;
        let transcodings = track.media.map(|m| m.transcodings).unwrap_or_default();
        let offered = if transcodings.is_empty() {
            "none".to_string()
        } else {
            transcodings
                .iter()
                .map(|t| t.describe())
                .collect::<Vec<_>>()
                .join(", ")
        };
        let candidates = rank_transcodings(&transcodings);
        if candidates.is_empty() {
            let encrypted = transcodings.iter().any(|t| {
                t.format
                    .protocol
                    .as_deref()
                    .is_some_and(|p| p.contains("encrypted"))
            });
            return Err(AppError::Api(if encrypted {
                format!("Only protected (encrypted) streams are offered, which this player doesn't play. Offered: {offered}.")
            } else {
                format!("No playable stream format is offered. Offered: {offered}.")
            }));
        }

        // Try each usable format in order; SoundCloud sometimes lists formats
        // it no longer serves.
        let mut last_error: Option<AppError> = None;
        for (candidate, kind) in candidates {
            let mut address = Url::parse(candidate.url.as_deref().unwrap_or_default())?;
            if let Some(auth) = track.track_authorization.as_deref() {
                address
                    .query_pairs_mut()
                    .append_pair("track_authorization", auth);
            }
            match self.get_json::<ApiStreamUrl>(address.as_str()).await {
                Ok(resolved) => return Ok((kind, Url::parse(&resolved.url)?)),
                Err(e @ AppError::Auth(_)) => return Err(e),
                Err(e) => last_error = Some(e),
            }
        }
        let reason = last_error.map(|e| e.to_string()).unwrap_or_default();
        Err(AppError::Api(format!(
            "SoundCloud refused every stream for this track ({reason}). Offered: {offered}."
        )))
    }

    async fn collect_pages<T: DeserializeOwned>(&self, first: String) -> AppResult<Vec<T>> {
        self.collect_pages_max(first, MAX_PAGES).await
    }

    /// Follow `next_href` links, reading at most `max_pages` pages.
    async fn collect_pages_max<T: DeserializeOwned>(
        &self,
        first: String,
        max_pages: usize,
    ) -> AppResult<Vec<T>> {
        let mut next = Some(first);
        let mut items = Vec::new();
        let mut pages = 0;
        while let Some(address) = next.take() {
            let page: Page<T> = self.get_json(&address).await?;
            items.extend(page.collection);
            pages += 1;
            if pages < max_pages {
                next = page.next_href;
            }
        }
        Ok(items)
    }
}

/// Percent-encode a query value.
fn urlencode(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

/// Prefix an error with the step that failed (auth errors pass through).
fn step(what: &str, e: AppError) -> AppError {
    match e {
        AppError::Auth(_) => e,
        other => AppError::Api(format!("{what}: {other}.")),
    }
}
