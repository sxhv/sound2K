// Experimental: play a track with SoundCloud's own embedded player
// (w.soundcloud.com) inside the app, for protected (DRM-only) uploads that
// have no unprotected stand-in. SoundCloud's player handles the audio and
// any protection; we only send it commands (play, pause, seek, volume) and
// read its progress, using the Widget API's documented postMessage
// protocol. SoundCloud's script is never loaded into the app itself.
//
// Its audio doesn't go through Sound2K's engine, so EQ, crossfade,
// levelling and the visualizer don't apply to these tracks.
import type { Track } from "../types";
import type { EngineState, EngineStatus, Transport } from "./transport";

const ORIGIN = "https://w.soundcloud.com";
const LOAD_TIMEOUT_MS = 15_000;
const EVENTS = ["play", "pause", "finish", "playProgress", "error"];

interface WidgetMessage {
  method?: string;
  value?: unknown;
}

export class EmbedTransport implements Transport {
  private frame: HTMLIFrameElement | null = null;
  private trackId: string | null = null;
  private state: EngineState = "idle";
  private positionMs = 0;
  private volume = 1;
  private generation = 0;
  private error: string | null = null;
  private expectedMs = 0;
  private pending: { resolve: () => void; reject: (e: Error) => void; timer: number } | null = null;

  constructor() {
    window.addEventListener("message", (e) => this.onMessage(e));
  }

  load(track: Track, _fadeMs: number): Promise<void> {
    this.stopFrame();
    const id = /^sc:(\d+)$/.exec(track.id)?.[1];
    if (!id) return Promise.reject(new Error("Only SoundCloud tracks can use SoundCloud's player."));
    this.generation++;
    this.trackId = track.id;
    this.state = "loading";
    this.positionMs = 0;
    this.error = null;
    this.expectedMs = track.durationMs;

    const params = new URLSearchParams({
      url: `https://api.soundcloud.com/tracks/${id}`,
      auto_play: "true",
      buying: "false",
      sharing: "false",
      download: "false",
      show_artwork: "false",
      show_comments: "false",
      show_user: "false",
      show_reposts: "false",
      show_teaser: "false",
      visual: "false",
      single_active: "false",
    });
    const frame = document.createElement("iframe");
    frame.className = "sc-embed";
    frame.title = "SoundCloud player";
    frame.allow = "autoplay; encrypted-media";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.src = `${ORIGIN}/player/?${params.toString()}`;
    this.frame = frame;
    document.body.append(frame);

    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.fail("SoundCloud's player didn't start this track here (it may need DRM support this app's browser doesn't have).");
      }, LOAD_TIMEOUT_MS);
      this.pending = { resolve, reject, timer };
    });
  }

  preload(_track: Track): Promise<void> {
    return Promise.resolve();
  }

  pause(): Promise<void> {
    this.post("pause");
    if (this.state === "playing") this.state = "paused";
    return Promise.resolve();
  }

  resume(): Promise<void> {
    this.post("play");
    return Promise.resolve();
  }

  seek(positionMs: number): Promise<void> {
    this.post("seekTo", Math.max(0, Math.round(positionMs)));
    this.positionMs = positionMs;
    return Promise.resolve();
  }

  setVolume(volume: number): Promise<void> {
    this.volume = volume;
    this.post("setVolume", Math.round(volume * 100));
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.stopFrame();
    this.state = "idle";
    this.trackId = null;
    return Promise.resolve();
  }

  status(): Promise<EngineStatus> {
    return Promise.resolve({ trackId: this.trackId, state: this.state, positionMs: this.positionMs, error: this.error, generation: this.generation });
  }

  private post(method: string, value?: unknown): void {
    const target = this.frame?.contentWindow;
    if (!target) return;
    target.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), ORIGIN);
  }

  private onMessage(e: MessageEvent): void {
    // Only messages from our own SoundCloud player frame.
    if (e.origin !== ORIGIN || !this.frame || e.source !== this.frame.contentWindow) return;
    let msg: WidgetMessage;
    try {
      msg = (typeof e.data === "string" ? JSON.parse(e.data) : e.data) as WidgetMessage;
    } catch {
      return;
    }
    switch (msg.method) {
      case "ready":
        for (const ev of EVENTS) this.post("addEventListener", ev);
        this.post("setVolume", Math.round(this.volume * 100));
        this.post("play");
        break;
      case "play":
        this.state = "playing";
        break;
      case "playProgress": {
        const v = msg.value as { currentPosition?: number } | undefined;
        if (typeof v?.currentPosition === "number") this.positionMs = v.currentPosition;
        if (this.state === "loading" || this.state === "paused") this.state = "playing";
        // A 30-second preview instead of the full song: treat as failure.
        if (this.pending && this.expectedMs > 60_000 && this.positionMs > 0) this.post("getDuration");
        else this.settle();
        break;
      }
      case "getDuration": {
        const ms = typeof msg.value === "number" ? msg.value : 0;
        if (ms > 0 && ms < 35_000 && this.expectedMs > 60_000) {
          this.fail("SoundCloud's player only offers a 30-second preview of this track here.");
        } else {
          this.settle();
        }
        break;
      }
      case "pause":
        if (this.state === "playing") this.state = "paused";
        break;
      case "finish":
        this.state = "ended";
        break;
      case "error":
        this.fail("SoundCloud's player couldn't play this track here.");
        break;
    }
  }

  private settle(): void {
    if (!this.pending) return;
    window.clearTimeout(this.pending.timer);
    this.pending.resolve();
    this.pending = null;
  }

  private fail(message: string): void {
    this.state = "error";
    this.error = message;
    if (this.pending) {
      window.clearTimeout(this.pending.timer);
      this.pending.reject(new Error(message));
      this.pending = null;
    }
    this.stopFrame();
  }

  private stopFrame(): void {
    if (this.pending) {
      window.clearTimeout(this.pending.timer);
      this.pending.reject(new Error("Stopped."));
      this.pending = null;
    }
    this.frame?.remove();
    this.frame = null;
  }
}

/** Sends each track to the right transport: SoundCloud's embedded player
 * for tracks marked `viaEmbed`, the Rust engine for everything else. */
export function routingTransport(engine: Transport, embed: EmbedTransport): Transport {
  let active: Transport = engine;
  return {
    load(track, fadeMs) {
      const next = track.viaEmbed ? embed : engine;
      if (next !== active) {
        void active.stop().catch(() => undefined);
        active = next;
      }
      return active.load(track, next === embed ? 0 : fadeMs);
    },
    preload: (track) => (track.viaEmbed ? Promise.resolve() : engine.preload(track)),
    pause: () => active.pause(),
    resume: () => active.resume(),
    seek: (ms) => active.seek(ms),
    setVolume: (v) => Promise.all([engine.setVolume(v), embed.setVolume(v)]).then(() => undefined),
    stop: () => active.stop(),
    status: () => active.status(),
  };
}
