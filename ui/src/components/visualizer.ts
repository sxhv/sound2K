// Spectrum bars drawn behind the dock and the mini-player. Levels come
// from the Rust engine (`player_spectrum`). The loop only runs while music
// is playing, the visualizer is on, and the window is visible.
import type { AppState, AppStore } from "../state";

const BARS = 48;
const FRAME_MS = 33; // ~30 fps

export class Visualizer {
  private readonly canvases: HTMLCanvasElement[] = [];
  private levels = new Float32Array(BARS);
  /** An animation loop is scheduled (only ever one). */
  private running = false;
  private lastFetch = 0;
  private fetching = false;
  private active = false;
  private readonly beatListeners = new Set<(bass: number) => void>();

  /** Called ~30×/s with the current bass level (0–1) while music plays.
   * Used by the cat mascot to bob along. */
  onBeat(listener: (bass: number) => void): () => void {
    this.beatListeners.add(listener);
    return () => this.beatListeners.delete(listener);
  }

  constructor(
    private readonly store: AppStore,
    private readonly fetchLevels: (bars: number) => Promise<number[]>,
  ) {
    document.addEventListener("visibilitychange", () => this.sync(this.store.get()));
  }

  /** A canvas that fills its (position: relative) parent. */
  createCanvas(className: string): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.className = `visualizer ${className}`;
    canvas.setAttribute("aria-hidden", "true");
    this.canvases.push(canvas);
    return canvas;
  }

  update(s: AppState, prev: AppState | null): void {
    if (
      !prev ||
      s.visualizer !== prev.visualizer ||
      s.mascot !== prev.mascot ||
      s.player.playing !== prev.player.playing ||
      s.player.current !== prev.player.current
    ) {
      this.sync(s);
    }
  }

  private sync(s: AppState): void {
    // Levels are also fetched for the mascot even when the bars are hidden.
    this.active = (s.visualizer || s.mascot) && s.player.playing && s.player.current !== null && !document.hidden;
    for (const c of this.canvases) c.hidden = !s.visualizer;
    // When inactive, the loop keeps running only until the bars fall to zero.
    if (!this.running && (this.active || this.levels.some((v) => v > 0))) {
      this.running = true;
      requestAnimationFrame((t) => this.tick(t));
    }
  }

  private tick(time: number): void {
    if (this.active && time - this.lastFetch >= FRAME_MS && !this.fetching) {
      this.lastFetch = time;
      this.fetching = true;
      this.fetchLevels(BARS)
        .then((next) => {
          for (let i = 0; i < BARS; i++) {
            const target = next[i] ?? 0;
            const current = this.levels[i] ?? 0;
            // Rise fast, fall slowly.
            this.levels[i] = target > current ? target : current * 0.86 + target * 0.14;
          }
        })
        .catch(() => undefined)
        .finally(() => {
          this.fetching = false;
        });
    }
    if (!this.active) {
      for (let i = 0; i < BARS; i++) this.levels[i] = (this.levels[i] ?? 0) * 0.85;
    }
    if (this.beatListeners.size > 0) {
      let bass = 0;
      for (let i = 0; i < 6; i++) bass += this.levels[i] ?? 0;
      bass /= 6;
      for (const l of this.beatListeners) l(bass);
    }
    this.draw();
    const settled = !this.active && this.levels.every((v) => v < 0.01);
    if (settled) {
      this.levels.fill(0);
      this.draw();
      this.running = false;
      return;
    }
    requestAnimationFrame((t) => this.tick(t));
  }

  private draw(): void {
    const dark = document.documentElement.dataset.theme === "dark-orange";
    // The accent follows the current artwork (and fades between songs).
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent");
    const accentLight = css.getPropertyValue("--accent-light");
    const accentDark = css.getPropertyValue("--accent-dark");
    for (const canvas of this.canvases) {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0 || canvas.hidden) continue;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const count = canvas.classList.contains("visualizer-mini") ? 32 : BARS;
      const gap = 2;
      const barW = Math.max(1, (w - gap * (count - 1)) / count);
      const grad = ctx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, withAlpha(dark ? accent : accentDark, dark ? 0.3 : 0.5));
      grad.addColorStop(1, withAlpha(accentLight, dark ? 0.1 : 0.2));
      ctx.fillStyle = grad;
      for (let i = 0; i < count; i++) {
        const level = this.levels[Math.floor((i * BARS) / count)] ?? 0;
        const barH = Math.max(0, level * h * 0.9);
        if (barH < 1) continue;
        const x = i * (barW + gap);
        ctx.beginPath();
        ctx.roundRect(x, h - barH, barW, barH, Math.min(3, barW / 2));
        ctx.fill();
      }
    }
  }
}

/** "rgb(1, 2, 3)" (a computed colour) → "rgba(1, 2, 3, a)". */
function withAlpha(colour: string, alpha: number): string {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(colour);
  return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})` : `rgba(255, 121, 0, ${alpha})`;
}
