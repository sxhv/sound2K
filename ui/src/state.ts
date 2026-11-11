import { Store } from "./store";
import type {
  Artist,
  FeedItem,
  UpdateInfo,
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

export type Page = "library" | "equalizer" | "sound" | "artist";

/** Which likes the Liked Songs tab shows. */
export type LikedSource = "all" | "sound2k" | "soundcloud";

export type ArtistSection = "popular" | "tracks" | "albums" | "eps" | "playlists" | "reposts";
/** Sections that list albums / playlists rather than tracks. */
export const SET_SECTIONS: ReadonlySet<ArtistSection> = new Set(["albums", "eps", "playlists"]);
/** Sort for an artist page list ("default" = SoundCloud's order). */
export type ArtistSort = "default" | "plays" | "title" | "longest" | "shortest";

/** The open artist page. */
export interface ArtistPageState {
  id: number | null;
  profileUrl: string | null;
  /** Shown while loading (from the track that was clicked). */
  name: string;
  info: Artist | null;
  section: ArtistSection;
  /** Search within this artist's list, and its sort. */
  query: string;
  sort: ArtistSort;
  tracks: Track[];
  playlists: PlaylistSummary[];
  next: string | null;
  loading: boolean;
  error: string | null;
}

export type SearchKind = "tracks" | "artists" | "playlists";

export interface SearchState {
  q: string;
  kind: SearchKind;
  tracks: Track[];
  artists: Artist[];
  playlists: PlaylistSummary[];
  next: string | null;
  loading: boolean;
  error: string | null;
  /** A search has been run (vs. the empty start screen). */
  done: boolean;
}

export interface FeedState {
  items: FeedItem[];
  tracks: Track[];
  next: string | null;
  loading: boolean;
  error: string | null;
  loaded: boolean;
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

  /** Your SoundCloud likes (read-only: SoundCloud doesn't accept likes from apps). */
  liked: Track[];
  /** Songs liked in Sound2K (stored on this PC). */
  localLiked: Track[];
  /** Both lists combined (Sound2K likes first), newest first. */
  allLiked: Track[];
  /** Liked anywhere (fills the hearts). */
  likedIds: ReadonlySet<string>;
  /** Which likes the Liked Songs tab shows. */
  likedSource: LikedSource;
  /** Bumped when you follow / unfollow (Home reloads its artists row). */
  followsVersion: number;
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
  aura: boolean;
  discordStatus: boolean;
  updateCheck: boolean;
  /** Set when a newer version was found. */
  update: UpdateInfo | null;

  /** Library (tabs) or one of the top-bar pages. */
  page: Page;
  /** Where to return when the Equalizer / Sound page closes. */
  pageBack: "library" | "artist";
  artist: ArtistPageState | null;
  scSearch: SearchState;
  feed: FeedState;
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
  aura: true,
  discordStatus: false,
  updateCheck: true,
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
    localLiked: [],
    allLiked: [],
    likedSource: "all",
    followsVersion: 0,
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
    aura: settings.aura ?? DEFAULT_SETTINGS.aura,
    discordStatus: settings.discordStatus ?? DEFAULT_SETTINGS.discordStatus,
    updateCheck: settings.updateCheck ?? DEFAULT_SETTINGS.updateCheck,
    update: null,
    page: "library",
    pageBack: "library",
    artist: null,
    scSearch: { q: "", kind: "tracks", tracks: [], artists: [], playlists: [], next: null, loading: false, error: null, done: false },
    feed: { items: [], tracks: [], next: null, loading: false, error: null, loaded: false },
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

/** The likes the Liked Songs tab is showing. */
export function likedList(s: Pick<AppState, "likedSource" | "allLiked" | "localLiked" | "liked">): Track[] {
  return s.likedSource === "sound2k" ? s.localLiked : s.likedSource === "soundcloud" ? s.liked : s.allLiked;
}

/** Open the Equalizer or Sound page, remembering the page you were on;
 * opening the one already open closes it. */
export function togglePage(s: AppState, page: "equalizer" | "sound"): Partial<AppState> {
  if (s.page === page) return closeToolPage(s);
  const back = s.page === "artist" ? "artist" : s.page === "library" ? "library" : s.pageBack;
  return { page, pageBack: back, nowPlayingOpen: false };
}

/** Close the Equalizer / Sound page: back to the artist page or tab you
 * were on before. */
export function closeToolPage(s: AppState): Partial<AppState> {
  return { page: s.pageBack === "artist" && s.artist ? "artist" : "library" };
}
