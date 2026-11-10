// Browsing SoundCloud beyond your library: search, the home feed, artist
// pages and following. All requests go through Rust (see commands.rs).
import { api, errorMessage } from "./api";
import { toast } from "./components/toast";
import { artistUrl } from "./library";
import type { ArtistSection, AppStore, SearchKind } from "./state";
import type { PlaylistSummary, Track } from "./types";

// --- Search ------------------------------------------------------------------

let searchSeq = 0;

/** Run a new search (or switch result type). */
export async function runSearch(store: AppStore, q: string, kind: SearchKind): Promise<void> {
  const query = q.trim();
  const seq = ++searchSeq;
  const base = store.get().scSearch;
  if (!query) {
    store.set({ scSearch: { ...base, q, kind, tracks: [], artists: [], playlists: [], next: null, loading: false, error: null, done: false } });
    return;
  }
  store.set({ scSearch: { ...base, q, kind, tracks: [], artists: [], playlists: [], next: null, loading: true, error: null, done: true } });
  await fetchSearchPage(store, seq, null);
}

/** Next page of the current search (when scrolling to the end). */
export async function moreSearch(store: AppStore): Promise<void> {
  const s = store.get().scSearch;
  if (s.loading || !s.next) return;
  store.set({ scSearch: { ...s, loading: true } });
  await fetchSearchPage(store, searchSeq, s.next);
}

async function fetchSearchPage(store: AppStore, seq: number, next: string | null): Promise<void> {
  const s = store.get().scSearch;
  try {
    if (s.kind === "tracks") {
      const page = await api.searchTracks(s.q, next);
      if (seq !== searchSeq) return;
      const cur = store.get().scSearch;
      store.set({ scSearch: { ...cur, tracks: [...cur.tracks, ...page.items], next: page.next, loading: false } });
    } else if (s.kind === "artists") {
      const page = await api.searchArtists(s.q, next);
      if (seq !== searchSeq) return;
      const cur = store.get().scSearch;
      store.set({ scSearch: { ...cur, artists: [...cur.artists, ...page.items], next: page.next, loading: false } });
    } else {
      const page = await api.searchPlaylists(s.q, next);
      if (seq !== searchSeq) return;
      const cur = store.get().scSearch;
      store.set({ scSearch: { ...cur, playlists: [...cur.playlists, ...page.items], next: page.next, loading: false } });
    }
  } catch (e) {
    if (seq !== searchSeq) return;
    const cur = store.get().scSearch;
    // New arrays so the lists re-render their empty/error text.
    store.set({ scSearch: { ...cur, tracks: [...cur.tracks], loading: false, error: errorMessage(e) } });
  }
}

// --- Home feed -----------------------------------------------------------------

export async function loadFeed(store: AppStore, more = false): Promise<void> {
  const f = store.get().feed;
  if (f.loading || (more && !f.next)) return;
  if (!store.get().account) {
    store.set({ feed: { ...f, tracks: [...f.tracks], loaded: true, error: null } });
    return;
  }
  store.set({ feed: { ...f, loading: true, error: null } });
  try {
    const page = await api.getFeed(more ? f.next : null);
    const cur = store.get().feed;
    const items = more ? [...cur.items, ...page.items] : page.items;
    // The same track can appear twice (upload + repost); keep the first.
    const seen = new Set<string>();
    const tracks = items.map((i) => i.track).filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
    store.set({ feed: { items, tracks, next: page.next, loading: false, error: null, loaded: true } });
  } catch (e) {
    const cur = store.get().feed;
    store.set({ feed: { ...cur, tracks: [...cur.tracks], loading: false, error: errorMessage(e), loaded: true } });
  }
}

// --- Artist pages ----------------------------------------------------------------

let artistSeq = 0;

/** Open the artist page for a track's uploader. */
export function openArtistOf(store: AppStore, t: Track): void {
  openArtist(store, { id: t.artistId ?? null, profileUrl: artistUrl(t), name: t.artist });
}

export function openArtist(store: AppStore, ref: { id: number | null; profileUrl: string | null; name: string }): void {
  if (ref.id === null && !ref.profileUrl) {
    toast("This track has no artist page.");
    return;
  }
  const seq = ++artistSeq;
  store.set({
    page: "artist",
    nowPlayingOpen: false,
    artist: { ...ref, info: null, section: "popular", tracks: [], playlists: [], next: null, loading: true, error: null },
  });
  api
    .getArtist(ref.id, ref.profileUrl)
    .then((info) => {
      const a = store.get().artist;
      if (seq !== artistSeq || !a) return;
      store.set({ artist: { ...a, id: info.id, info, name: info.username } });
      void loadArtistSection(store, "popular");
    })
    .catch((e: unknown) => {
      const a = store.get().artist;
      if (seq !== artistSeq || !a) return;
      store.set({ artist: { ...a, loading: false, error: errorMessage(e) } });
    });
}

export async function loadArtistSection(store: AppStore, section: ArtistSection, more = false): Promise<void> {
  const a = store.get().artist;
  if (!a || a.id === null) return;
  if (more && (a.loading || !a.next || section !== a.section)) return;
  const seq = artistSeq;
  const id = a.id;
  store.set({
    artist: more ? { ...a, loading: true } : { ...a, section, tracks: [], playlists: [], next: null, loading: true, error: null },
  });
  try {
    if (section === "playlists") {
      const playlists = await api.getArtistPlaylists(id);
      const cur = store.get().artist;
      if (seq !== artistSeq || !cur || cur.section !== section) return;
      store.set({ artist: { ...cur, playlists, loading: false } });
    } else {
      const page = await api.getArtistTracks(id, section, more ? a.next : null);
      const cur = store.get().artist;
      if (seq !== artistSeq || !cur || cur.section !== section) return;
      store.set({ artist: { ...cur, tracks: more ? [...cur.tracks, ...page.items] : page.items, next: page.next, loading: false } });
    }
  } catch (e) {
    const cur = store.get().artist;
    if (seq !== artistSeq || !cur) return;
    store.set({ artist: { ...cur, tracks: [...cur.tracks], loading: false, error: errorMessage(e) } });
  }
}

export async function toggleFollow(store: AppStore): Promise<void> {
  const a = store.get().artist;
  if (!a?.info) return;
  if (!store.get().account) {
    toast("Sign in to SoundCloud to follow artists.");
    return;
  }
  const was = a.info.following === true;
  const set = (following: boolean, delta: number): void => {
    const cur = store.get().artist;
    if (cur?.info?.id !== a.info?.id || !cur?.info) return;
    store.set({ artist: { ...cur, info: { ...cur.info, following, followers: Math.max(0, cur.info.followers + delta) } } });
  };
  set(!was, was ? -1 : 1); // optimistic
  try {
    await api.followArtist(a.info.id, !was);
  } catch (e) {
    set(was, was ? 1 : -1);
    toast(`Couldn't ${was ? "unfollow" : "follow"}: ${errorMessage(e)}`, "error");
  }
}

// --- Playlists from search / artist pages --------------------------------------------

/** Open any playlist in the Playlists tab. */
export function openPlaylist(store: AppStore, p: PlaylistSummary): void {
  store.set({
    page: "library",
    tab: "playlists",
    openPlaylist: { summary: p, tracks: [], loading: true },
    search: "",
    selectedId: null,
  });
  const stillOpen = (): boolean => store.get().openPlaylist?.summary.id === p.id;
  api
    .playlistTracks(p.id)
    .then((tracks) => {
      if (stillOpen()) store.set({ openPlaylist: { summary: p, tracks, loading: false } });
    })
    .catch(() => {
      toast(`Couldn't load “${p.title}”.`, "error");
      if (stillOpen()) store.set({ openPlaylist: { summary: p, tracks: [], loading: false } });
    });
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}
