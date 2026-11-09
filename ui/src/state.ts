import { Store } from "./store";
import type {
  Account,
  FilterPrefs,
  PlaylistSummary,
  RepeatMode,
  Settings,
  SortKey,
  TabId,
  Theme,
  Track,
} from "./types";

export interface PlayerState {
  current: Track | null;
  playing: boolean;
  /** Waiting for the engine to resolve/buffer the stream. */
  loading: boolean;
  positionMs: number;
  volume: number; // 0..1
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
}

export interface OpenPlaylist {
  summary: PlaylistSummary;
  tracks: Track[];
  loading: boolean;
}

export interface AppState {
  tab: TabId;
  loading: boolean;
  error: string | null;

  /** Signed-in SoundCloud account; null = built-in sample library. */
  account: Account | null;
  /** Downloading a fresh copy of the library from SoundCloud. */
  syncing: boolean;
  /** A sign-in window is open. */
  signingIn: boolean;

  liked: Track[];
  likedIds: ReadonlySet<string>;
  playlists: PlaylistSummary[];
  openPlaylist: OpenPlaylist | null;

  /** Upcoming tracks. */
  queue: Track[];
  /** Tracks played before the current one (for "Previous"). */
  history: Track[];
  /** The list playback was started from (used by Repeat all). */
  context: Track[];
  /** Recently played, newest first (saved to history.json). */
  recent: Track[];

  search: string;
  sort: SortKey;
  filters: FilterPrefs;
  theme: Theme;
  selectedId: string | null;

  crossfadeSecs: number;
  normalize: boolean;
  eqEnabled: boolean;
  eqPreset: string;
  eqGains: number[];
  visualizer: boolean;
  autoplay: boolean;
  artBackgrounds: boolean;
  mascot: boolean;
  discordStatus: boolean;

  /** Library (tabs) or one of the top-bar pages. */
  page: "library" | "equalizer" | "sound";
  /** Full-screen Now Playing view. */
  nowPlayingOpen: boolean;
  /** Queue slide-out panel. */
  queueOpen: boolean;

  /** Compact mini-player window. */
  mini: boolean;
  /** Keep the mini-player above other windows. */
  pinned: boolean;

  player: PlayerState;
}

export type AppStore = Store<AppState>;

export const DEFAULT_FILTERS: FilterPrefs = {
  playableOnly: false,
  under3: false,
  over5: false,
  recent: false,
  artist: null,
};

export const DEFAULT_SETTINGS: Settings = {
  theme: "orange-glass",
  sort: "recently-liked",
  filters: DEFAULT_FILTERS,
  volume: 0.8,
  crossfadeSecs: 0,
  normalize: false,
  eqEnabled: false,
  eqPreset: "flat",
  eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  visualizer: true,
  autoplay: true,
  artBackgrounds: true,
  mascot: true,
  discordStatus: false,
};

export function createInitialState(settings: Settings): AppState {
  return {
    tab: "liked",
    loading: true,
    error: null,
    account: null,
    syncing: false,
    signingIn: false,
    liked: [],
    likedIds: new Set(),
    playlists: [],
    openPlaylist: null,
    queue: [],
    history: [],
    context: [],
    recent: [],
    search: "",
    sort: settings.sort,
    filters: { ...DEFAULT_FILTERS, ...settings.filters },
    theme: settings.theme,
    selectedId: null,
    crossfadeSecs: settings.crossfadeSecs ?? DEFAULT_SETTINGS.crossfadeSecs,
    normalize: settings.normalize ?? DEFAULT_SETTINGS.normalize,
    eqEnabled: settings.eqEnabled ?? DEFAULT_SETTINGS.eqEnabled,
    eqPreset: settings.eqPreset ?? DEFAULT_SETTINGS.eqPreset,
    eqGains: settings.eqGains?.length === 10 ? [...settings.eqGains] : [...DEFAULT_SETTINGS.eqGains],
    visualizer: settings.visualizer ?? DEFAULT_SETTINGS.visualizer,
    autoplay: settings.autoplay ?? DEFAULT_SETTINGS.autoplay,
    artBackgrounds: settings.artBackgrounds ?? DEFAULT_SETTINGS.artBackgrounds,
    mascot: settings.mascot ?? DEFAULT_SETTINGS.mascot,
    discordStatus: settings.discordStatus ?? DEFAULT_SETTINGS.discordStatus,
    page: "library",
    nowPlayingOpen: false,
    queueOpen: false,
    mini: false,
    pinned: false,
    player: {
      current: null,
      playing: false,
      loading: false,
      positionMs: 0,
      volume: settings.volume,
      muted: false,
      shuffle: false,
      repeat: "off",
    },
  };
}
