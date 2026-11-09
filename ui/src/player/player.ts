// Playback logic: queue, history, shuffle, repeat, skipping, crossfade
// timing, preloading, autoplay and session restore. The actual audio is
// produced by the Rust engine through a Transport; this class polls it for
// position and end-of-track.
import { errorMessage } from "../lib/errors";
import type { AppStore, PlayerState } from "../state";
import type { Session, Track } from "../types";
import type { Transport } from "./transport";

const POLL_MS = 250;
const RESTART_THRESHOLD_MS = 3000;
const MAX_HISTORY = 200;
const MAX_RECENT = 100;
/** Stop instead of skipping forever if many tracks in a row fail. */
const MAX_CONSECUTIVE_FAILURES = 5;
/** Autoplay avoids repeating anything among the last N played tracks. */
const AUTOPLAY_AVOID_RECENT = 50;

export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export interface PlayerDeps {
  notify: (message: string) => void;
  transport: Transport;
  /** Similar tracks for autoplay. */
  related: (track: Track) => Promise<Track[]>;
}

interface StartOptions {
  fadeMs?: number;
  /** Seek here once loaded (resuming a saved session). */
  resumeAt?: number;
}

export class Player {
  private pollTimer: number | null = null;
  private polling = false;
  private loadToken = 0;
  private failures = 0;
  /** Current track was restored from a saved session but not loaded yet. */
  private needsLoad = false;
  /** Track id we already started crossfading away from. */
  private crossfadedFrom: string | null = null;
  private readonly notify: (message: string) => void;
  private readonly transport: Transport;
  private readonly related: (track: Track) => Promise<Track[]>;

  constructor(
    private readonly store: AppStore,
    deps: PlayerDeps,
  ) {
    this.notify = deps.notify;
    this.transport = deps.transport;
    this.related = deps.related;
    void this.transport.setVolume(this.effectiveVolume()).catch(() => undefined);
  }

  private get p(): PlayerState {
    return this.store.get().player;
  }

  private effectiveVolume(): number {
    return this.p.muted ? 0 : this.p.volume;
  }

  private setPlayer(patch: Partial<PlayerState>): void {
    this.store.set({ player: { ...this.p, ...patch } });
    this.syncPolling();
  }

  /** Restore a saved session: shows the track, paused, at its position. */
  restoreSession(session: Session): void {
    if (!session.current) return;
    this.store.set({ queue: session.queue, context: session.context });
    this.setPlayer({
      current: session.current,
      positionMs: Math.min(session.positionMs, session.current.durationMs),
      playing: false,
      loading: false,
    });
    this.needsLoad = true;
  }

  /** Start playing `list[index]`; the rest of the list becomes the queue. */
  playFromList(list: readonly Track[], index: number): void {
    const track = list[index];
    if (!track) return;
    if (!track.playable) {
      this.notify(`“${track.title}” is unavailable and can't be played.`);
      return;
    }
    const rest = list.slice(index + 1);
    this.store.set({
      context: [...list],
      queue: this.p.shuffle ? shuffled(rest) : rest,
      history: this.pushHistory(),
    });
    this.start(track);
  }

  /** Shuffle the whole list and start from a random playable track. */
  playShuffled(list: readonly Track[]): void {
    const order = shuffled(list.filter((t) => t.playable));
    const first = order.shift();
    if (!first) {
      this.notify("Nothing playable in this list.");
      return;
    }
    this.store.set({ context: [...list], queue: order, history: this.pushHistory() });
    this.setPlayer({ shuffle: true });
    this.start(first);
  }

  /** Stop and clear the current track (used when switching accounts). */
  stop(): void {
    this.loadToken++;
    this.needsLoad = false;
    void this.transport.stop().catch(() => undefined);
    this.setPlayer({ current: null, playing: false, loading: false, positionMs: 0 });
  }

  togglePlay(): void {
    const { current, playing, positionMs } = this.p;
    if (!current) {
      const liked = this.store.get().liked;
      const i = liked.findIndex((t) => t.playable);
      if (i >= 0) this.playFromList(liked, i);
      return;
    }
    if (this.needsLoad) {
      this.start(current, { resumeAt: positionMs });
      return;
    }
    if (!playing && positionMs >= current.durationMs - 500) {
      // Finished track: play it again from the start.
      this.start(current);
      return;
    }
    this.setPlayer({ playing: !playing });
    if (!this.p.loading) {
      void (playing ? this.transport.pause() : this.transport.resume()).catch(() => undefined);
    }
  }

  /** The track that would play next, if it's known now. */
  private peekNext(): Track | null {
    const s = this.store.get();
    if (s.player.repeat === "one") return null;
    const fromQueue = s.queue.find((t) => t.playable);
    if (fromQueue) return fromQueue;
    if (s.player.repeat === "all" && !s.player.shuffle) return s.context.find((t) => t.playable) ?? null;
    return null;
  }

  /** Download the next track in the background so it starts instantly. */
  private preloadUpcoming(): void {
    const next = this.peekNext();
    if (next && next.id !== this.p.current?.id) {
      void this.transport.preload(next).catch(() => undefined);
    }
  }

  /**
   * Advance to the next playable track, skipping unavailable ones.
   * `auto`: the track finished by itself; `fadeMs`: crossfade length.
   */
  next(auto = false, afterError = false, fadeMs = 0): void {
    const s = this.store.get();
    const current = s.player.current;
    if (auto && !afterError && s.player.repeat === "one" && current) {
      this.start(current, { fadeMs });
      return;
    }
    let queue = [...s.queue];
    if (queue.length === 0 && s.player.repeat === "all" && s.context.length > 0) {
      queue = s.player.shuffle ? shuffled(s.context) : [...s.context];
    }
    let skipped = 0;
    while (queue.length > 0) {
      const t = queue.shift() as Track;
      if (!t.playable) {
        skipped++;
        continue;
      }
      this.store.set({ queue, history: this.pushHistory() });
      if (skipped > 0) this.notify(`Skipped ${skipped} unavailable track${skipped === 1 ? "" : "s"}.`);
      this.start(t, { fadeMs });
      return;
    }
    this.store.set({ queue: [] });
    if (skipped > 0) this.notify(`Skipped ${skipped} unavailable track${skipped === 1 ? "" : "s"}.`);

    // Out of tracks: keep going with similar ones, if enabled.
    if (s.autoplay && current && !afterError && s.player.repeat === "off") {
      void this.autoplayFrom(current, auto, fadeMs);
      return;
    }
    this.endOfQueue(auto);
  }

  private endOfQueue(auto: boolean): void {
    const current = this.p.current;
    this.loadToken++;
    if (!auto) void this.transport.stop().catch(() => undefined);
    this.setPlayer({ playing: false, loading: false, positionMs: current ? current.durationMs : 0 });
  }

  private async autoplayFrom(seed: Track, auto: boolean, fadeMs: number): Promise<void> {
    const token = this.loadToken;
    let similar: Track[] = [];
    try {
      similar = await this.related(seed);
    } catch {
      similar = [];
    }
    // The user did something else meanwhile.
    if (token !== this.loadToken || this.p.current?.id !== seed.id) return;
    const s = this.store.get();
    const avoid = new Set([seed.id, ...s.recent.slice(0, AUTOPLAY_AVOID_RECENT).map((t) => t.id)]);
    const fresh = similar.filter((t) => t.playable && !avoid.has(t.id));
    const first = fresh[0];
    if (!first) {
      this.endOfQueue(auto);
      return;
    }
    this.store.set({ queue: fresh.slice(1), context: fresh, history: this.pushHistory() });
    this.notify(`Autoplay: similar tracks to “${seed.title}”.`);
    this.start(first, { fadeMs });
  }

  /** Restart the track, or go back if we're near the start. */
  prev(): void {
    const s = this.store.get();
    const previous = s.history[s.history.length - 1];
    if (this.p.positionMs > RESTART_THRESHOLD_MS || !previous) {
      if (s.player.current) this.seek(0);
      return;
    }
    const queue = s.player.current ? [s.player.current, ...s.queue] : s.queue;
    this.store.set({ history: s.history.slice(0, -1), queue });
    this.start(previous);
  }

  seek(ms: number): void {
    const current = this.p.current;
    if (!current) return;
    const position = Math.min(Math.max(0, ms), current.durationMs);
    this.setPlayer({ positionMs: position });
    if (!this.p.loading && !this.needsLoad) void this.transport.seek(position).catch(() => undefined);
  }

  setVolume(volume: number): void {
    this.setPlayer({ volume: Math.min(Math.max(0, volume), 1), muted: false });
    void this.transport.setVolume(this.effectiveVolume()).catch(() => undefined);
  }

  toggleMute(): void {
    this.setPlayer({ muted: !this.p.muted });
    void this.transport.setVolume(this.effectiveVolume()).catch(() => undefined);
  }

  toggleShuffle(): void {
    const on = !this.p.shuffle;
    if (on) this.store.set({ queue: shuffled(this.store.get().queue) });
    this.setPlayer({ shuffle: on });
    this.preloadUpcoming();
  }

  cycleRepeat(): void {
    const next = { off: "all", all: "one", one: "off" } as const;
    this.setPlayer({ repeat: next[this.p.repeat] });
  }

  enqueue(track: Track): void {
    this.store.set({ queue: [...this.store.get().queue, track] });
    this.notify(`Added “${track.title}” to the queue.`);
    this.preloadUpcoming();
  }

  enqueueAll(tracks: readonly Track[]): void {
    const playable = tracks.filter((t) => t.playable);
    this.store.set({ queue: [...this.store.get().queue, ...playable] });
    this.notify(`Added ${playable.length} track${playable.length === 1 ? "" : "s"} to the queue.`);
    this.preloadUpcoming();
  }

  playNext(track: Track): void {
    this.store.set({ queue: [track, ...this.store.get().queue] });
    this.notify(`“${track.title}” will play next.`);
    this.preloadUpcoming();
  }

  playQueued(index: number): void {
    const queue = this.store.get().queue;
    const track = queue[index];
    if (!track) return;
    if (!track.playable) {
      this.notify(`“${track.title}” is unavailable and can't be played.`);
      return;
    }
    this.store.set({ queue: queue.slice(index + 1), history: this.pushHistory() });
    this.start(track);
  }

  removeFromQueue(index: number): void {
    const queue = [...this.store.get().queue];
    queue.splice(index, 1);
    this.store.set({ queue });
    this.preloadUpcoming();
  }

  moveInQueue(index: number, delta: number): void {
    const queue = [...this.store.get().queue];
    const target = index + delta;
    if (target < 0 || target >= queue.length) return;
    const [item] = queue.splice(index, 1);
    if (item) queue.splice(target, 0, item);
    this.store.set({ queue });
    this.preloadUpcoming();
  }

  clearQueue(): void {
    this.store.set({ queue: [] });
  }

  private pushHistory(): Track[] {
    const s = this.store.get();
    return s.player.current ? [...s.history, s.player.current].slice(-MAX_HISTORY) : s.history;
  }

  private start(track: Track, opts: StartOptions = {}): void {
    const s = this.store.get();
    const recent = [track, ...s.recent.filter((t) => t.id !== track.id)].slice(0, MAX_RECENT);
    this.needsLoad = false;
    this.crossfadedFrom = null;
    this.store.set({
      recent,
      player: { ...s.player, current: track, positionMs: 0, playing: true, loading: true },
    });
    this.syncPolling();

    const token = ++this.loadToken;
    this.transport.load(track, opts.fadeMs ?? 0).then(
      () => {
        if (token !== this.loadToken) return;
        this.failures = 0;
        if (opts.resumeAt && opts.resumeAt > 1000) {
          void this.transport.seek(opts.resumeAt).catch(() => undefined);
          this.setPlayer({ positionMs: opts.resumeAt });
        }
        // The user may have pressed pause while it was loading.
        if (!this.p.playing) void this.transport.pause().catch(() => undefined);
        this.setPlayer({ loading: false });
        this.preloadUpcoming();
      },
      (err: unknown) => {
        if (token !== this.loadToken) return;
        this.failures++;
        this.setPlayer({ loading: false });
        this.notify(`Couldn't play “${track.title}”: ${errorMessage(err)}`);
        if (this.failures >= MAX_CONSECUTIVE_FAILURES) {
          this.failures = 0;
          this.setPlayer({ playing: false });
          this.notify("Playback stopped because several tracks in a row couldn't be played.");
          return;
        }
        this.next(true, true);
      },
    );
  }

  private syncPolling(): void {
    const shouldRun = this.p.current !== null && this.p.playing;
    if (shouldRun && this.pollTimer === null) {
      this.pollTimer = window.setInterval(() => void this.poll(), POLL_MS);
    } else if (!shouldRun && this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const status = await this.transport.status();
      const p = this.p;
      if (!p.current || p.loading || status.trackId !== p.current.id) return;
      if (status.state === "ended") {
        this.next(true);
        return;
      }
      if (status.state !== "playing" && status.state !== "paused") return;

      const position = Math.min(status.positionMs, p.current.durationMs);
      if (Math.abs(position - p.positionMs) >= 200) {
        this.store.set({ player: { ...p, positionMs: position } });
      }

      // Crossfade: start the next track a few seconds before this one ends.
      const fadeMs = this.store.get().crossfadeSecs * 1000;
      if (
        fadeMs > 0 &&
        status.state === "playing" &&
        p.current.durationMs > fadeMs * 2 &&
        status.positionMs >= p.current.durationMs - fadeMs &&
        this.crossfadedFrom !== p.current.id
      ) {
        this.crossfadedFrom = p.current.id;
        this.next(true, false, fadeMs);
      }
    } catch {
      // A missed poll is harmless; the next one will catch up.
    } finally {
      this.polling = false;
    }
  }
}
