// Windows media keys + "now playing" card. The Rust side (src/media.rs)
// emits `media-control` events; we send it metadata when playback changes.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppStore } from "../state";
import type { Player } from "./player";

export function installMediaKeys(store: AppStore, player: Player): void {
  void listen<string>("media-control", (event) => {
    const playing = store.get().player.playing;
    switch (event.payload) {
      case "toggle":
        player.togglePlay();
        break;
      case "play":
        if (!playing) player.togglePlay();
        break;
      case "pause":
        if (playing) player.togglePlay();
        break;
      case "next":
        player.next();
        break;
      case "previous":
        player.prev();
        break;
    }
  }).catch(() => undefined);

  store.subscribe((s, prev) => {
    const p = s.player;
    if (p.current === prev.player.current && p.playing === prev.player.playing) return;
    const t = p.current;
    void invoke("media_update", {
      title: t?.title ?? "",
      artist: t?.artist ?? "",
      artworkUrl: t?.artworkUrl?.replace("-large.", "-t300x300.") ?? null,
      durationMs: Math.round(t?.durationMs ?? 0),
      state: t ? (p.playing ? "playing" : "paused") : "stopped",
    }).catch(() => undefined);
  });
}
