// Creating and editing your Sound2K playlists. They're stored on this PC:
// SoundCloud doesn't accept playlist changes from apps, so SoundCloud
// playlists are read-only here (copy one to Sound2K to edit it).
import { api, errorMessage } from "./api";
import { confirmDialog, promptDialog } from "./components/dialog";
import { closePopover, openPopover } from "./components/popover";
import { h } from "./lib/dom";
import { plural } from "./lib/format";
import { icon } from "./lib/icons";
import { playlistArt } from "./components/playlistArt";
import { toast } from "./components/toast";
import type { AppStore } from "./state";
import type { PlaylistSummary, Track } from "./types";

const LOCAL_PREFIX = "local-playlist:";

export function isLocalPlaylist(p: PlaylistSummary): boolean {
  return p.id.startsWith(LOCAL_PREFIX);
}

/** Playlists you can edit: your Sound2K playlists. */
export function ownPlaylists(store: AppStore): PlaylistSummary[] {
  return store.get().playlists.filter(isLocalPlaylist);
}

export function canEdit(_store: AppStore, p: PlaylistSummary): boolean {
  return isLocalPlaylist(p);
}

/** Put an updated summary into the store (and the open playlist). */
function applySummary(store: AppStore, summary: PlaylistSummary, tracks?: Track[]): void {
  const s = store.get();
  const exists = s.playlists.some((p) => p.id === summary.id);
  const playlists = exists ? s.playlists.map((p) => (p.id === summary.id ? summary : p)) : [summary, ...s.playlists];
  const open = s.openPlaylist;
  store.set({
    playlists,
    openPlaylist: open && open.summary.id === summary.id ? { ...open, summary, tracks: tracks ?? open.tracks } : open,
  });
}

export async function createPlaylist(store: AppStore, withTracks: Track[] = []): Promise<PlaylistSummary | null> {
  const answer = await promptDialog({ title: "New playlist", confirm: "Create" });
  if (!answer) return null;
  try {
    const summary = await api.createPlaylist(answer.text, withTracks);
    applySummary(store, summary);
    toast(`Created “${summary.title}”.`);
    return summary;
  } catch (err) {
    toast(`Couldn't create the playlist: ${errorMessage(err)}`, "error");
    return null;
  }
}

export async function renamePlaylist(store: AppStore, p: PlaylistSummary): Promise<void> {
  const answer = await promptDialog({ title: "Rename playlist", value: p.title, confirm: "Save" });
  if (!answer || answer.text === p.title) return;
  try {
    applySummary(store, await api.renamePlaylist(p.id, answer.text));
  } catch (err) {
    toast(`Couldn't rename: ${errorMessage(err)}`, "error");
  }
}

export async function deletePlaylist(store: AppStore, p: PlaylistSummary): Promise<void> {
  if (!(await confirmDialog(`Delete the playlist “${p.title}”?`, "Delete"))) return;
  try {
    await api.deletePlaylist(p.id);
    const s = store.get();
    store.set({
      playlists: s.playlists.filter((x) => x.id !== p.id),
      openPlaylist: s.openPlaylist?.summary.id === p.id ? null : s.openPlaylist,
    });
    toast(`Deleted “${p.title}”.`);
  } catch (err) {
    toast(`Couldn't delete: ${errorMessage(err)}`, "error");
  }
}

export async function addToPlaylist(store: AppStore, p: PlaylistSummary, t: Track): Promise<void> {
  try {
    const summary = await api.editPlaylistTrack(p.id, t, "add");
    const open = store.get().openPlaylist;
    const tracks = open?.summary.id === p.id && !open.tracks.some((x) => x.id === t.id) ? [...open.tracks, t] : undefined;
    applySummary(store, summary, tracks);
    toast(`Added to “${p.title}”.`);
  } catch (err) {
    toast(`Couldn't add to “${p.title}”: ${errorMessage(err)}`, "error");
  }
}

export async function removeFromPlaylist(store: AppStore, p: PlaylistSummary, t: Track): Promise<void> {
  const open = store.get().openPlaylist;
  const before = open?.summary.id === p.id ? open.tracks : null;
  // Hide it now; put it back if saving fails.
  if (before) store.set({ openPlaylist: { ...open!, tracks: before.filter((x) => x.id !== t.id) } });
  try {
    applySummary(store, await api.editPlaylistTrack(p.id, t, "remove"));
  } catch (err) {
    const now = store.get().openPlaylist;
    if (before && now?.summary.id === p.id) store.set({ openPlaylist: { ...now, tracks: before } });
    toast(`Couldn't remove: ${errorMessage(err)}`, "error");
  }
}

export async function moveInPlaylist(store: AppStore, p: PlaylistSummary, t: Track, dir: "up" | "down"): Promise<void> {
  const open = store.get().openPlaylist;
  if (!open || open.summary.id !== p.id) return;
  const before = open.tracks;
  const i = before.findIndex((x) => x.id === t.id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= before.length) return;
  const moved = [...before];
  [moved[i], moved[j]] = [moved[j] as Track, moved[i] as Track];
  store.set({ openPlaylist: { ...open, tracks: moved } });
  try {
    applySummary(store, await api.editPlaylistTrack(p.id, t, dir));
  } catch (err) {
    const now = store.get().openPlaylist;
    if (now?.summary.id === p.id) store.set({ openPlaylist: { ...now, tracks: before } });
    toast(`Couldn't move: ${errorMessage(err)}`, "error");
  }
}

/** Drag-and-drop: move `t` so it ends up at position `toIndex`. */
export async function moveTrackTo(store: AppStore, p: PlaylistSummary, t: Track, toIndex: number): Promise<void> {
  const open = store.get().openPlaylist;
  if (!open || open.summary.id !== p.id) return;
  const before = open.tracks;
  const rest = before.filter((x) => x.id !== t.id);
  const at = Math.max(0, Math.min(toIndex, rest.length));
  const moved = [...rest.slice(0, at), t, ...rest.slice(at)];
  if (moved.every((x, i) => x.id === before[i]?.id)) return;
  store.set({ openPlaylist: { ...open, tracks: moved } });
  try {
    applySummary(store, await api.movePlaylistTrack(p.id, t.id, rest[at]?.id ?? null));
  } catch (err) {
    const now = store.get().openPlaylist;
    if (now?.summary.id === p.id) store.set({ openPlaylist: { ...now, tracks: before } });
    toast(`Couldn't move: ${errorMessage(err)}`, "error");
  }
}

/** "Add to playlist" picker: your playlists with their covers. */
export function showAddToPlaylist(store: AppStore, anchor: HTMLElement, t: Track): void {
  const mine = ownPlaylists(store);

  const list = h("div", { class: "pl-picker-list", attrs: { role: "listbox", "aria-label": "Your playlists" } });
  const row = (art: HTMLElement, title: string, sub: string, onPick: () => void, extra = ""): HTMLButtonElement => {
    const b = h("button", { class: `pl-picker-row ${extra}`.trim(), attrs: { type: "button", role: "option" } }, [
      art,
      h("span", { class: "pl-picker-text" }, [h("span", { class: "pl-picker-title", text: title }), h("span", { class: "pl-picker-sub", text: sub })]),
    ]);
    b.addEventListener("click", onPick);
    return b;
  };
  const newArt = h("div", { class: "art pl-picker-art new-playlist-art", attrs: { "aria-hidden": "true" } }, [icon("plus")]);
  const newRow = row(newArt, "New playlist", "Create one with this song", () => {
    closePopover();
    void createPlaylist(store, [t]);
  }, "is-new");

  const render = (filter: string): void => {
    const f = filter.trim().toLowerCase();
    const shown = mine.filter((p) => !f || p.title.toLowerCase().includes(f));
    list.replaceChildren(
      newRow,
      ...shown.map((p) =>
        row(playlistArt(p), p.title, plural(p.trackCount, "track"), () => {
          closePopover();
          void addToPlaylist(store, p, t);
        }),
      ),
      ...(shown.length === 0 && mine.length > 0 ? [h("p", { class: "pl-picker-empty", text: "No playlists match." })] : []),
    );
  };
  render("");

  const parts: HTMLElement[] = [h("div", { class: "pl-picker-head" }, [h("h3", { text: "Add to playlist" }), h("span", { class: "pl-picker-song", text: t.title })])];
  if (mine.length > 6) {
    const filter = h("input", { class: "glass-field pl-picker-filter", attrs: { type: "search", placeholder: "Find a playlist", "aria-label": "Find a playlist" } });
    filter.addEventListener("input", () => render(filter.value));
    parts.push(filter);
  }
  parts.push(list);
  // Let the ⋯ menu finish closing first.
  window.setTimeout(() => openPopover(anchor, h("div", { class: "pl-picker" }, parts), { align: "end", className: "popover-picker" }), 0);
}

/** Copy a playlist (e.g. a SoundCloud one) into a new Sound2K playlist you
 * can edit. */
export async function copyToSound2K(store: AppStore, p: PlaylistSummary, tracks: readonly Track[]): Promise<void> {
  const answer = await promptDialog({ title: "Copy to Sound2K", value: p.title, confirm: "Copy" });
  if (!answer) return;
  try {
    const summary = await api.createPlaylist(answer.text, [...tracks]);
    applySummary(store, summary);
    toast(`Copied to “${summary.title}” (${plural(summary.trackCount, "track")}). You can edit it now.`);
  } catch (err) {
    toast(`Couldn't copy the playlist: ${errorMessage(err)}`, "error");
  }
}
