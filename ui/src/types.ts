// Shapes shared with the Rust backend (see src-tauri/src/library/models.rs
// and src-tauri/src/settings.rs).

export interface AppInfo {
  name: string;
  version: string;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  artworkUrl: string | null;
  permalinkUrl: string | null;
  /** When the track was liked, if the source provides it. */
  likedAtMs: number | null;
  /** False for blocked, private or otherwise unstreamable tracks. */
  playable: boolean;
  /** The artist allows downloads on SoundCloud. */
  downloadable?: boolean;
}

export interface PlaylistSummary {
  id: string;
  title: string;
  owner: string;
  trackCount: number;
  artworkUrl: string | null;
  /** SoundCloud user id of the owner (0 = unknown). */
  ownerId: number;
  sharing: string | null;
}

/** The signed-in SoundCloud user. */
export interface Account {
  id: number;
  username: string;
  avatarUrl: string | null;
  permalinkUrl: string | null;
}

/** Error shape returned by Rust commands. */
export interface AppError {
  kind: string;
  message: string;
}

export type Theme = "orange-glass" | "dark-orange";

export type SortKey =
  | "recently-liked"
  | "oldest-liked"
  | "title-asc"
  | "title-desc"
  | "artist-asc"
  | "artist-desc"
  | "shortest"
  | "longest";

export interface FilterPrefs {
  playableOnly: boolean;
  under3: boolean;
  over5: boolean;
  recent: boolean;
  artist: string | null;
}

export type BoolFilterKey = "playableOnly" | "under3" | "over5" | "recent";

export interface Settings {
  theme: Theme;
  sort: SortKey;
  filters: FilterPrefs;
  volume: number;
  /** 0 = off, up to 12 seconds. */
  crossfadeSecs: number;
  /** Volume levelling. */
  normalize: boolean;
  eqEnabled: boolean;
  eqPreset: string;
  /** dB per band, 31 Hz … 16 kHz. */
  eqGains: number[];
  visualizer: boolean;
  autoplay: boolean;
  /** Tint backgrounds with the current artwork. */
  artBackgrounds: boolean;
  /** Show the animated cat. */
  mascot: boolean;
  /** Show "Listening to …" on Discord. */
  discordStatus: boolean;
  /** Look for a newer version on GitHub at startup. */
  updateCheck: boolean;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  available: boolean;
  url: string | null;
}

/** Saved playback session ("pick up where you left off"). */
export interface Session {
  current: Track | null;
  positionMs: number;
  queue: Track[];
  context: Track[];
}

/** Sent to Rust for the Discord status (see discord.rs). */
export interface DiscordPresence {
  title: string;
  artist: string;
  artworkUrl: string | null;
  permalinkUrl: string | null;
  positionMs: number;
  durationMs: number;
}

/** Disk usage in bytes (see storage_info in commands.rs). */
export interface StorageInfo {
  total: number;
  webCache: number;
  libraryCache: number;
  other: number;
  folder: string;
}

export type TabId = "liked" | "playlists" | "queue" | "recent";

export type RepeatMode = "off" | "all" | "one";
