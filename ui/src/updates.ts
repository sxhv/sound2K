// Updates from GitHub Releases. Checking is read-only; installing downloads
// the signed update (verified in Rust) and restarts the app.
import { listen } from "@tauri-apps/api/event";
import { api, errorMessage } from "./api";
import { toast } from "./components/toast";
import type { AppStore } from "./state";

/** Download + install the update. `onProgress` gets 0–100 (or null if unknown). */
export async function installUpdate(onProgress: (pct: number | null) => void): Promise<void> {
  const stop = await listen<{ downloaded: number; total: number | null }>("update-progress", (e) => {
    const { downloaded, total } = e.payload;
    onProgress(total ? Math.min(100, Math.round((downloaded / total) * 100)) : null);
  }).catch(() => () => undefined);
  try {
    await api.installUpdate(); // the app restarts when this succeeds
  } catch (e) {
    toast(errorMessage(e), "error");
  } finally {
    stop();
  }
}

/** "What's new": the release page in the browser. */
export function openUpdate(store: AppStore): void {
  const url = store.get().update?.url;
  if (url) api.openUpdatePage(url).catch((e: unknown) => toast(errorMessage(e), "error"));
}

/** `manual`: from the button (always reports the result). */
export async function checkForUpdate(store: AppStore, manual: boolean): Promise<void> {
  try {
    const info = await api.checkForUpdate();
    if (info.available) {
      store.set({ update: info });
      toast(`Sound2K ${info.latest} is available. Settings → About → Update & restart.`);
    } else if (manual) {
      toast(`You're up to date (v${info.current}).`);
    }
  } catch (e) {
    if (manual) toast(`Couldn't check for updates: ${errorMessage(e)}`, "error");
  }
}

/** Quiet check a few seconds after launch (if enabled). */
export function startUpdateCheck(store: AppStore): void {
  if (!store.get().updateCheck) return;
  window.setTimeout(() => void checkForUpdate(store, false), 5000);
}
