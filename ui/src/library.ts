// Loading the library and signing in/out. Everything network-related
// happens in Rust; this only orchestrates and reports.
import { api, errorKind, errorMessage } from "./api";
import { toast } from "./components/toast";
import type { Player } from "./player/player";
import type { AppState, AppStore } from "./state";
import type { Track } from "./types";

/** The first time you like something, explain where likes are kept. */
function explainLocalLikes(): void {
  try {
    if (localStorage.getItem("sound2k.localLikesExplained")) return;
    localStorage.setItem("sound2k.localLikesExplained", "1");
  } catch {
    return;
  }
  toast("Saved to your Sound2K likes on this PC. SoundCloud doesn't accept likes from apps, so they're kept separate (Liked Songs → Sound2K).");
}

/** State for both like lists: SoundCloud likes and Sound2K likes, the two
 * combined (Sound2K likes first; a song in both is listed once) and the ids
 * that fill the hearts. */
export function likesState(liked: Track[], localLiked: Track[]): Pick<AppState, "liked" | "localLiked" | "allLiked" | "likedIds"> {
  const localIds = new Set(localLiked.map((t) => t.id));
  const allLiked = [...localLiked, ...liked.filter((t) => !localIds.has(t.id))];
  return { liked, localLiked, allLiked, likedIds: new Set(allLiked.map((t) => t.id)) };
}

/** Load likes + playlists. `refresh: false` uses the local cache if present. */
export async function loadLibrary(store: AppStore, refresh: boolean): Promise<void> {
  const [liked, localLiked, playlists] = await Promise.all([api.likedTracks(refresh), api.localLikes(), api.playlists(refresh)]);
  const s = store.get();
  store.set({
    ...likesState(liked, localLiked),
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
    ...likesState([], []),
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

/** Like or unlike a track in Sound2K (stored on this PC; updates at once).
 * Songs liked on SoundCloud itself can only be unliked on soundcloud.com. */
export async function toggleLike(store: AppStore, track: Track): Promise<void> {
  const before = store.get();
  const localLiked = before.localLiked.some((t) => t.id === track.id);
  if (!localLiked && before.likedIds.has(track.id)) {
    toast("This song is liked on SoundCloud itself. Unlike it on soundcloud.com (⋯ → Open on SoundCloud).");
    return;
  }
  const without = before.localLiked.filter((t) => t.id !== track.id);
  store.set(likesState(before.liked, localLiked ? without : [{ ...track, likedAtMs: Date.now() }, ...without]));
  try {
    await api.likeTrack(track, !localLiked);
    explainLocalLikes();
  } catch (err) {
    store.set(likesState(store.get().liked, before.localLiked));
    toast(`Couldn't ${localLiked ? "unlike" : "like"} “${track.title}”: ${errorMessage(err)}`, "error");
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
