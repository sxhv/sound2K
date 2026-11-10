// Loading the library and signing in/out. Everything network-related
// happens in Rust; this only orchestrates and reports.
import { api, errorKind, errorMessage } from "./api";
import { toast } from "./components/toast";
import type { Player } from "./player/player";
import type { AppStore } from "./state";
import type { Track } from "./types";

/** Load likes + playlists. `refresh: false` uses the local cache if present. */
/** Which tracks you've reposted (for the Repost buttons). */
export async function loadRepostedIds(store: AppStore): Promise<void> {
  try {
    const ids = await api.getRepostedIds();
    store.set({ repostedIds: new Set(ids) });
  } catch {
    // Not critical: the buttons just start as "Repost".
  }
}

export async function loadLibrary(store: AppStore, refresh: boolean): Promise<void> {
  const [liked, playlists] = await Promise.all([api.likedTracks(refresh), api.playlists(refresh)]);
  const s = store.get();
  store.set({
    liked,
    likedIds: new Set(liked.map((t) => t.id)),
    playlists,
    // Re-open the same playlist's summary if it still exists.
    openPlaylist: s.openPlaylist && playlists.some((p) => p.id === s.openPlaylist?.summary.id) ? s.openPlaylist : null,
    loading: false,
    error: null,
  });
}

/** Download a fresh copy from SoundCloud in the background. */
export async function syncLibrary(store: AppStore): Promise<void> {
  if (!store.get().account || store.get().syncing) return;
  store.set({ syncing: true });
  try {
    await loadLibrary(store, true);
    void loadRepostedIds(store);
  } catch (err) {
    if (errorKind(err) === "auth") {
      toast("Your SoundCloud session has expired. Open Settings (gear icon) to sign in again.", "error");
    } else {
      toast(`Couldn't refresh from SoundCloud: ${errorMessage(err)}`, "error");
    }
    if (store.get().liked.length === 0) store.set({ loading: false, error: errorMessage(err) });
  } finally {
    store.set({ syncing: false });
  }
}

function resetLibraryState(store: AppStore, player: Player): void {
  player.stop();
  store.set({
    liked: [],
    likedIds: new Set(),
    repostedIds: new Set(),
    playlists: [],
    openPlaylist: null,
    queue: [],
    history: [],
    context: [],
    recent: [],
    selectedId: null,
    search: "",
    loading: true,
    error: null,
  });
}

export async function signIn(store: AppStore, player: Player): Promise<void> {
  if (store.get().signingIn) return;
  store.set({ signingIn: true });
  try {
    const account = await api.startLogin();
    resetLibraryState(store, player);
    store.set({ account });
    toast(`Signed in as ${account.username}. Loading your library…`);
    await syncLibrary(store);
  } catch (err) {
    if (errorKind(err) !== "cancelled") toast(`Sign-in failed: ${errorMessage(err)}`, "error");
  } finally {
    store.set({ signingIn: false });
  }
}

export async function signOut(store: AppStore, player: Player): Promise<void> {
  try {
    await api.logout();
  } catch (err) {
    toast(`Couldn't fully sign out: ${errorMessage(err)}`, "error");
  }
  resetLibraryState(store, player);
  store.set({ account: null });
  toast("Signed out. Your token and cached library were removed.");
  try {
    await loadLibrary(store, false);
  } catch (err) {
    store.set({ loading: false, error: errorMessage(err) });
  }
}

/** Like or unlike a track on SoundCloud (updates the UI immediately). */
export async function toggleLike(store: AppStore, track: Track): Promise<void> {
  if (!store.get().account) {
    toast("Sign in to SoundCloud to like tracks (gear icon).");
    return;
  }
  const before = store.get();
  const wasLiked = before.likedIds.has(track.id);
  const setLiked = (liked: Track[]): void => store.set({ liked, likedIds: new Set(liked.map((t) => t.id)) });

  const without = before.liked.filter((t) => t.id !== track.id);
  setLiked(wasLiked ? without : [{ ...track, likedAtMs: Date.now() }, ...without]);
  try {
    await api.likeTrack(track, !wasLiked);
  } catch (err) {
    // Put things back the way they were.
    const now = store.get().liked.filter((t) => t.id !== track.id);
    setLiked(wasLiked ? [track, ...now] : now);
    toast(`Couldn't ${wasLiked ? "unlike" : "like"} “${track.title}”: ${errorMessage(err)}`, "error");
  }
}

/** The artist's SoundCloud page, derived from the track's address. */
export function artistUrl(track: Track): string | null {
  if (!track.permalinkUrl) return null;
  try {
    const url = new URL(track.permalinkUrl);
    const user = url.pathname.split("/").filter(Boolean)[0];
    return user ? `${url.origin}/${user}` : null;
  } catch {
    return null;
  }
}

/** Official download (only for tracks the artist made downloadable). Your
 * browser saves the file, like any other download. */
export function downloadTrack(store: AppStore, t: Track): void {
  if (!store.get().account) {
    toast("Sign in to SoundCloud to download tracks.");
    return;
  }
  toast(`Opening the download for “${t.title}” in your browser…`);
  api.downloadTrack(t.id, t.permalinkUrl).catch((err: unknown) => toast(`Couldn't download: ${errorMessage(err)}`, "error"));
}

export function openOnSoundCloud(url: string | null): void {
  if (!url) return;
  api.openOnSoundCloud(url).catch((err: unknown) => toast(errorMessage(err), "error"));
}
