import { invoke } from "../api";
import type { Track } from "../types";
import type { EngineStatus, Transport } from "./transport";

/** Transport backed by the Rust audio engine (src-tauri/src/player). */
export const tauriTransport: Transport = {
  load: (track: Track, fadeMs: number) =>
    invoke<void>("player_load", { trackId: track.id, durationMs: Math.round(track.durationMs), fadeMs: Math.round(fadeMs) }),
  preload: (track: Track) => invoke<void>("player_preload", { trackId: track.id }),
  pause: () => invoke<void>("player_pause"),
  resume: () => invoke<void>("player_resume"),
  seek: (positionMs: number) => invoke<void>("player_seek", { positionMs: Math.max(0, Math.round(positionMs)) }),
  setVolume: (volume: number) => invoke<void>("player_set_volume", { volume }),
  stop: () => invoke<void>("player_stop"),
  status: () => invoke<EngineStatus>("player_status"),
};
