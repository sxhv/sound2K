// The link between the UI's player logic and the Rust audio engine.
// Kept behind an interface so the queue logic can be tested without audio.
import type { Track } from "../types";

export type EngineState = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

export interface EngineStatus {
  trackId: string | null;
  state: EngineState;
  positionMs: number;
  error: string | null;
  generation: number;
}

export interface Transport {
  /** Resolves when audio has started; rejects with a readable error.
   *  `fadeMs` > 0 crossfades from the track that is playing. */
  load(track: Track, fadeMs: number): Promise<void>;
  /** Start downloading a track in the background so it starts instantly. */
  preload(track: Track): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  /** 0..1, already accounting for mute. */
  setVolume(volume: number): Promise<void>;
  stop(): Promise<void>;
  status(): Promise<EngineStatus>;
}
