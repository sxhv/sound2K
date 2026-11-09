// Keeps the Discord status in step with playback (only when switched on).
// Updates are sent on song change, play/pause and seeks; Rust paces them.
import { api } from "./api";
import type { AppState, AppStore } from "./state";
import type { DiscordPresence } from "./types";

export function startDiscordStatus(store: AppStore): void {
  let lastKey = "";
  let sentPos = 0;
  let sentAt = 0;

  store.subscribe((s: AppState) => {
    const t = s.player.current;
    const active = s.discordStatus && s.player.playing && !s.player.loading && t !== null && t.playable;
    const key = active && t ? `${t.id}|playing` : "off";
    // Detect seeks: position drifting > 3 s from where it should be.
    const expected = sentPos + (performance.now() - sentAt);
    const seeked = active && Math.abs(s.player.positionMs - expected) > 3000;
    if (key === lastKey && !seeked) return;
    lastKey = key;
    sentPos = s.player.positionMs;
    sentAt = performance.now();
    const presence: DiscordPresence | null =
      active && t
        ? {
            title: t.title,
            artist: t.artist,
            artworkUrl: t.artworkUrl,
            permalinkUrl: t.permalinkUrl,
            positionMs: Math.floor(s.player.positionMs),
            durationMs: t.durationMs,
          }
        : null;
    api.discordPresence(presence).catch(() => undefined);
  });
}
