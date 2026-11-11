// Typed wrappers around the Rust commands registered in src-tauri/src/lib.rs.
// (Playback commands live in player/tauriTransport.ts.)
import { invoke as rawInvoke } from "@tauri-apps/api/core";
import { errorKind } from "./lib/errors";
import type { Account, AppInfo, Artist, FeedItem, Paged, DiscordPresence, PlaylistSummary, Session, Settings, StorageInfo, Track, UpdateInfo } from "./types";

export { errorKind, errorMessage } from "./lib/errors";

// SoundCloud's login token is short-lived. When a request fails because it
// expired, let soundcloud.com renew the session in the background (no
// sign-in window), then retry the request once. Several requests failing
// at the same moment share one renewal.
const NO_RENEW = new Set(["refresh_session", "start_login", "logout", "get_account"]);
let renewing: Promise<boolean> | null = null;

function renewSession(): Promise<boolean> {
  renewing ??= rawInvoke<boolean>("refresh_session")
    .catch(() => false)
    .finally(() => {
      // Let the next expiry (hours later) try again.
      setTimeout(() => (renewing = null), 30_000);
    });
  return renewing;
}

/** `invoke` that renews an expired SoundCloud session and retries once. */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await rawInvoke<T>(cmd, args);
  } catch (err) {
    if (errorKind(err) !== "auth" || NO_RENEW.has(cmd)) throw err;
    if (!(await renewSession())) throw err;
    return rawInvoke<T>(cmd, args);
  }
}

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  getAccount: () => invoke<Account | null>("get_account"),
  startLogin: () => invoke<Account>("start_login"),
  logout: () => invoke<void>("logout"),
  refreshSession: () => renewSession(),
  likedTracks: (refresh = false) => invoke<Track[]>("get_liked_tracks", { refresh }),
  playlists: (refresh = false) => invoke<PlaylistSummary[]>("get_playlists", { refresh }),
  playlistTracks: (id: string) => invoke<Track[]>("get_playlist_tracks", { id }),
  loadSettings: () => invoke<Settings>("load_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  loadHistory: () => invoke<Track[]>("load_history"),
  saveHistory: (tracks: Track[]) => invoke<void>("save_history", { tracks }),
  likeTrack: (track: Track, like: boolean) => invoke<void>("like_track", { track, like }),
  localLikes: () => invoke<Track[]>("get_local_likes"),
  findStandin: (track: Track) => invoke<Track | null>("find_standin", { track }),
  createPlaylist: (title: string, tracks: Track[]) => invoke<PlaylistSummary>("create_playlist", { title, tracks }),
  renamePlaylist: (playlistId: string, title: string) => invoke<PlaylistSummary>("rename_playlist", { playlistId, title }),
  editPlaylistTrack: (playlistId: string, track: Track, action: "add" | "remove" | "up" | "down") =>
    invoke<PlaylistSummary>("edit_playlist_track", { playlistId, track, action }),
  deletePlaylist: (playlistId: string) => invoke<void>("delete_playlist", { playlistId }),
  movePlaylistTrack: (playlistId: string, trackId: string, beforeId: string | null) =>
    invoke<PlaylistSummary>("move_playlist_track", { playlistId, trackId, beforeId }),
  discordPresence: (presence: DiscordPresence | null) => invoke<void>("discord_presence", { presence }),
  discordAvailable: () => invoke<boolean>("discord_available"),
  discordStatusText: () => invoke<string>("discord_status_text"),
  checkForUpdate: () => invoke<UpdateInfo>("check_for_update"),
  openUpdatePage: (url: string) => invoke<void>("open_update_page", { url }),
  installUpdate: () => invoke<void>("install_update"),
  searchTracks: (q: string, next: string | null) => invoke<Paged<Track>>("search_tracks", { q, next }),
  searchArtists: (q: string, next: string | null) => invoke<Paged<Artist>>("search_artists", { q, next }),
  searchPlaylists: (q: string, next: string | null) => invoke<Paged<PlaylistSummary>>("search_playlists", { q, next }),
  getArtist: (id: number | null, profileUrl: string | null) => invoke<Artist>("get_artist", { id, profileUrl }),
  getArtistTracks: (id: number, section: string, next: string | null) =>
    invoke<Paged<Track>>("get_artist_tracks", { id, section, next }),
  getArtistPlaylists: (id: number, kind: "albums" | "eps" | "playlists") => invoke<PlaylistSummary[]>("get_artist_playlists", { id, kind }),
  getFeed: (next: string | null) => invoke<Paged<FeedItem>>("get_feed", { next }),
  followArtist: (artist: Artist, follow: boolean) => invoke<void>("follow_artist", { artist, follow }),
  getFollowings: () => invoke<Artist[]>("get_followings"),
  downloadTrack: (trackId: string, permalinkUrl: string | null) => invoke<void>("download_track", { trackId, permalinkUrl }),
  relatedTracks: (trackId: string) => invoke<Track[]>("get_related_tracks", { trackId }),
  openOnSoundCloud: (url: string) => invoke<void>("open_on_soundcloud", { url }),
  loadSession: () => invoke<Session>("load_session"),
  saveSession: (session: Session) => invoke<void>("save_session", { session }),
  storageInfo: () => invoke<StorageInfo>("storage_info"),
  clearCache: () => invoke<void>("clear_cache"),
  artworkColour: (url: string) => invoke<[number, number, number] | null>("artwork_colour", { url }),
  setDsp: (eqEnabled: boolean, eqGains: number[], normalize: boolean) =>
    invoke<void>("player_set_dsp", { eqEnabled, eqGains, normalize }),
  spectrum: (bars: number) => invoke<number[]>("player_spectrum", { bars }),
};
