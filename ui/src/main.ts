import "./styles/base.css";
import "./styles/components.css";

import { api, errorMessage } from "./api";
import { loadLibrary, syncLibrary } from "./library";
import { mountApp, type AppHandle } from "./app";
import { startDiscordStatus } from "./discordStatus";
import { toast } from "./components/toast";
import { Player } from "./player/player";
import { installMediaKeys } from "./player/mediaKeys";
import { tauriTransport } from "./player/tauriTransport";
import { DEFAULT_SETTINGS, createInitialState, type AppState, type AppStore } from "./state";
import type { Settings } from "./types";
import { Store } from "./store";

const SAVE_DEBOUNCE_MS = 400;

function settingsOf(s: AppState): Settings {
  return {
    theme: s.theme,
    sort: s.sort,
    filters: s.filters,
    volume: s.player.volume,
    crossfadeSecs: s.crossfadeSecs,
    normalize: s.normalize,
    eqEnabled: s.eqEnabled,
    eqPreset: s.eqPreset,
    eqGains: s.eqGains,
    visualizer: s.visualizer,
    autoplay: s.autoplay,
    artBackgrounds: s.artBackgrounds,
    mascot: s.mascot,
    discordStatus: s.discordStatus,
  };
}

/** Persist settings to the app's settings file whenever they change. */
function persistSettings(store: AppStore): void {
  let timer = 0;
  let last = JSON.stringify(settingsOf(store.get()));
  store.subscribe((s) => {
    const next = JSON.stringify(settingsOf(s));
    if (next === last) return;
    last = next;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      api.saveSettings(settingsOf(store.get())).catch((err: unknown) => console.error("Could not save settings", err));
    }, SAVE_DEBOUNCE_MS);
  });
}

/** Keep the engine's equalizer / levelling in sync with the settings. */
function syncAudioProcessing(store: AppStore): void {
  const push = (s: AppState): void => {
    api.setDsp(s.eqEnabled, s.eqGains, s.normalize).catch(() => undefined);
  };
  push(store.get());
  store.subscribe((s, prev) => {
    if (s.eqEnabled !== prev.eqEnabled || s.eqGains !== prev.eqGains || s.normalize !== prev.normalize) push(s);
  });
}

/** Save the queue, current track and position so the next launch resumes. */
function persistSession(store: AppStore): void {
  let timer = 0;
  const save = (): void => {
    const s = store.get();
    api
      .saveSession({ current: s.player.current, positionMs: Math.round(s.player.positionMs), queue: s.queue, context: s.context })
      .catch((err: unknown) => console.error("Could not save session", err));
  };
  store.subscribe((s, prev) => {
    if (s.player.current === prev.player.current && s.queue === prev.queue && s.context === prev.context) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(save, 1500);
  });
  // Position while playing, and once more when the window closes.
  window.setInterval(() => {
    if (store.get().player.playing) save();
  }, 15_000);
  window.addEventListener("beforeunload", save);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && store.get().player.current) save();
  });
}

/** Save Recently Played (history.json) whenever it changes. */
function persistHistory(store: AppStore): void {
  let timer = 0;
  store.subscribe((s, prev) => {
    if (s.recent === prev.recent) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      api.saveHistory(store.get().recent).catch((err: unknown) => console.error("Could not save history", err));
    }, 1000);
  });
}

function installShortcuts(app: AppHandle, player: Player): void {
  document.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    const typing = target?.matches("input, textarea, select, [contenteditable]") ?? false;

    if (e.ctrlKey && e.key.toLowerCase() === "f") {
      e.preventDefault(); // also suppresses the webview's own find bar
      app.focusSearch();
      return;
    }
    if (typing) return;

    if (e.code === "Space" && !(target instanceof HTMLButtonElement)) {
      e.preventDefault();
      player.togglePlay();
    } else if (e.ctrlKey && e.key === "ArrowRight") {
      e.preventDefault();
      player.next();
    } else if (e.ctrlKey && e.key === "ArrowLeft") {
      e.preventDefault();
      player.prev();
    }
  });
}

async function boot(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;

  const [settings, info, recent] = await Promise.all([
    api.loadSettings().catch(() => DEFAULT_SETTINGS),
    api.appInfo().catch(() => ({ name: "Sound2K", version: "dev" })),
    api.loadHistory().catch(() => []),
  ]);

  const store = new Store({ ...createInitialState(settings), recent });
  const player = new Player(store, {
    notify: (msg) => toast(msg),
    transport: tauriTransport,
    related: (track) => api.relatedTracks(track.id),
  });
  const app = mountApp(root, store, player, info.version);
  startDiscordStatus(store);
  installShortcuts(app, player);
  persistSettings(store);
  persistHistory(store);
  syncAudioProcessing(store);
  installMediaKeys(store, player);

  // Pause decorative animations while the window is hidden/minimized.
  document.addEventListener("visibilitychange", () => {
    document.documentElement.classList.toggle("is-window-hidden", document.hidden);
  });

  // Signed in? Show the cached library instantly, then refresh it from
  // SoundCloud in the background. Signed out: the built-in sample library.
  const account = await api.getAccount().catch((err: unknown) => {
    toast(`Couldn't restore your SoundCloud session: ${errorMessage(err)}`, "error");
    return null;
  });
  store.set({ account });
  try {
    await loadLibrary(store, false);
  } catch (err) {
    store.set({ loading: false, error: errorMessage(err) });
  }
  // Pick up where you left off (paused until you press play).
  const session = await api.loadSession().catch(() => null);
  if (session?.current) player.restoreSession(session);
  persistSession(store);

  if (account) void syncLibrary(store);
}

void boot();
