// Creating and editing your own SoundCloud playlists. Changes go to
// SoundCloud first; the app's lists update when SoundCloud confirms.
import { api, errorMessage } from "./api";
import { confirmDialog, promptDialog } from "./components/dialog";
import { showMenu, type MenuItem } from "./components/popover";
import { toast } from "./components/toast";
import type { AppStore } from "./state";
import type { PlaylistSummary, Track } from "./types";

/** Playlists you can edit (your own SoundCloud playlists). */
export function ownPlaylists(store: AppStore): PlaylistSummary[] {
  const s = store.get();
  const me = s.account?.id;
  return me ? s.playlists.filter((p) => p.ownerId === me && p.id.startsWith("sc-playlist:")) : [];
}

export function canEdit(store: AppStore, p: PlaylistSummary): boolean {
  const me = store.get().account?.id;
  return me !== undefined && p.ownerId === me && p.id.startsWith("sc-playlist:");
}

function needAccount(store: AppStore): boolean {
  if (store.get().account) return true;
  toast("Sign in to SoundCloud to make playlists.");
  return false;
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
  if (!needAccount(store)) return null;
  const answer = await promptDialog({ title: "New playlist", confirm: "Create", privacy: true });
  if (!answer) return null;
  try {
    const summary = await api.createPlaylist(answer.text, answer.private, withTracks.map((t) => t.id));
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
  if (!(await confirmDialog(`Delete “${p.title}” from SoundCloud?`, "Delete"))) return;
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
    const summary = await api.editPlaylistTrack(p.id, t.id, "add");
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
  // Optimistic: hide it now, put it back if SoundCloud says no.
  if (before) store.set({ openPlaylist: { ...open!, tracks: before.filter((x) => x.id !== t.id) } });
  try {
    applySummary(store, await api.editPlaylistTrack(p.id, t.id, "remove"));
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
    applySummary(store, await api.editPlaylistTrack(p.id, t.id, dir));
  } catch (err) {
    const now = store.get().openPlaylist;
    if (now?.summary.id === p.id) store.set({ openPlaylist: { ...now, tracks: before } });
    toast(`Couldn't move: ${errorMessage(err)}`, "error");
  }
}

/** "Add to playlist" picker (opened from a track's ⋯ menu). */
export function showAddToPlaylist(store: AppStore, anchor: HTMLElement, t: Track): void {
  if (!needAccount(store)) return;
  const items: MenuItem[] = [
    { label: "＋ New playlist…", action: () => void createPlaylist(store, [t]) },
    ...ownPlaylists(store).map((p) => ({ label: p.title, action: () => void addToPlaylist(store, p, t) })),
  ];
  // Let the first menu finish closing before opening this one.
  window.setTimeout(() => showMenu(anchor, items), 0);
}
