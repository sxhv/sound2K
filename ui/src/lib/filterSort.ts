// Pure search / filter / sort logic. Runs locally on already-loaded
// metadata, so typing never triggers network requests.
import type { BoolFilterKey, FilterPrefs, PlaylistSummary, SortKey, Track } from "../types";

export const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const THREE_MIN_MS = 3 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;

export const SORT_ORDER: readonly SortKey[] = [
  "recently-liked",
  "oldest-liked",
  "title-asc",
  "title-desc",
  "artist-asc",
  "artist-desc",
  "shortest",
  "longest",
];

export const SORT_LABELS: Record<SortKey, string> = {
  "recently-liked": "Recently liked",
  "oldest-liked": "Oldest liked",
  "title-asc": "Title A–Z",
  "title-desc": "Title Z–A",
  "artist-asc": "Artist A–Z",
  "artist-desc": "Artist Z–A",
  shortest: "Shortest",
  longest: "Longest",
};

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Lower-case and strip accents so "beyonce" matches "Beyoncé". */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export interface ListQuery {
  search: string;
  sort: SortKey;
  filters: FilterPrefs;
}

interface Indexed {
  t: Track;
  /** Position in the source list (the API's order: newest like first). */
  i: number;
}

function compare(sort: SortKey, a: Indexed, b: Indexed): number {
  switch (sort) {
    // "Liked" order uses the order the source returned, not invented dates.
    case "recently-liked":
      return a.i - b.i;
    case "oldest-liked":
      return b.i - a.i;
    case "title-asc":
      return collator.compare(a.t.title, b.t.title);
    case "title-desc":
      return collator.compare(b.t.title, a.t.title);
    case "artist-asc":
      return collator.compare(a.t.artist, b.t.artist) || collator.compare(a.t.title, b.t.title);
    case "artist-desc":
      return collator.compare(b.t.artist, a.t.artist) || collator.compare(a.t.title, b.t.title);
    case "shortest":
      return a.t.durationMs - b.t.durationMs;
    case "longest":
      return b.t.durationMs - a.t.durationMs;
  }
}

export function passesFilters(t: Track, f: FilterPrefs, now: number): boolean {
  if (f.playableOnly && !t.playable) return false;
  if (f.under3 && t.durationMs >= THREE_MIN_MS) return false;
  if (f.over5 && t.durationMs <= FIVE_MIN_MS) return false;
  if (f.artist !== null && t.artist !== f.artist) return false;
  if (f.recent && (t.likedAtMs === null || now - t.likedAtMs > RECENT_WINDOW_MS)) return false;
  return true;
}

export function applyQuery(tracks: readonly Track[], q: ListQuery, now = Date.now()): Track[] {
  const needle = normalize(q.search);
  const kept: Indexed[] = [];
  tracks.forEach((t, i) => {
    if (!passesFilters(t, q.filters, now)) return;
    if (needle && !normalize(t.title).includes(needle) && !normalize(t.artist).includes(needle)) {
      return;
    }
    kept.push({ t, i });
  });
  // Ties keep source order, so sorting is stable and predictable.
  kept.sort((a, b) => compare(q.sort, a, b) || a.i - b.i);
  return kept.map((k) => k.t);
}

export function searchPlaylists(list: readonly PlaylistSummary[], search: string): PlaylistSummary[] {
  const needle = normalize(search);
  return needle ? list.filter((p) => normalize(p.title).includes(needle)) : [...list];
}

/** True if like dates are known for any track (enables "recently liked" filter). */
export function hasLikedDates(tracks: readonly Track[]): boolean {
  return tracks.some((t) => t.likedAtMs !== null);
}

export function uniqueArtists(tracks: readonly Track[]): string[] {
  return [...new Set(tracks.map((t) => t.artist))].sort(collator.compare);
}

export const FILTER_LABELS: Record<BoolFilterKey, string> = {
  playableOnly: "Playable only",
  under3: "Under 3 min",
  over5: "Over 5 min",
  recent: "Liked in last 30 days",
};

export interface Chip {
  key: keyof FilterPrefs;
  label: string;
}

export function filterChips(f: FilterPrefs): Chip[] {
  const chips: Chip[] = [];
  for (const key of Object.keys(FILTER_LABELS) as BoolFilterKey[]) {
    if (f[key]) chips.push({ key, label: FILTER_LABELS[key] });
  }
  if (f.artist !== null) chips.push({ key: "artist", label: `Artist: ${f.artist}` });
  return chips;
}
