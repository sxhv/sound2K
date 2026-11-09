// Typed wrappers around the Rust commands registered in src-tauri/src/lib.rs.
// (Playback commands live in player/tauriTransport.ts.)
import { invoke } from "@tauri-apps/api/core";
import type { Account, AppInfo, DiscordPresence, PlaylistSummary, Session, Settings, StorageInfo, Track, UpdateInfo } from "./types";

export { errorKind, errorMessage } from "./lib/errors";

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  getAccount: () => invoke<Account | null>("get_account"),
  startLogin: () => invoke<Account>("start_login"),
  logout: () => invoke<void>("logout"),
  likedTracks: (refresh = false) => invoke<Track[]>("get_liked_tracks", { refresh }),
  playlists: (refresh = false) => invoke<PlaylistSummary[]>("get_playlists", { refresh }),
  playlistTracks: (id: string) => invoke<Track[]>("get_playlist_tracks", { id }),
  loadSettings: () => invoke<Settings>("load_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  loadHistory: () => invoke<Track[]>("load_history"),
  saveHistory: (tracks: Track[]) => invoke<void>("save_history", { tracks }),
  likeTrack: (track: Track, like: boolean) => invoke<void>("like_track", { track, like }),
  createPlaylist: (title: string, isPrivate: boolean, trackIds: string[]) =>
    invoke<PlaylistSummary>("create_playlist", { title, private: isPrivate, trackIds }),
  renamePlaylist: (playlistId: string, title: string) => invoke<PlaylistSummary>("rename_playlist", { playlistId, title }),
  editPlaylistTrack: (playlistId: string, trackId: string, action: "add" | "remove" | "up" | "down") =>
    invoke<PlaylistSummary>("edit_playlist_track", { playlistId, trackId, action }),
  deletePlaylist: (playlistId: string) => invoke<void>("delete_playlist", { playlistId }),
  discordPresence: (presence: DiscordPresence | null) => invoke<void>("discord_presence", { presence }),
  discordAvailable: () => invoke<boolean>("discord_available"),
  checkForUpdate: () => invoke<UpdateInfo>("check_for_update"),
  openUpdatePage: (url: string) => invoke<void>("open_update_page", { url }),
  installUpdate: () => invoke<void>("install_update"),
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
