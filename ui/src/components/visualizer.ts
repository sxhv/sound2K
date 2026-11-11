// Spectrum bars drawn behind the dock and the mini-player. Levels come
// from the Rust engine (`player_spectrum`). The loop only runs while music
// is playing, the visualizer is on, and the window is visible.
import type { AppState, AppStore } from "../state";

const BARS = 48;
const FRAME_MS = 33; // ~30 fps

export class Visualizer {
  private readonly canvases: HTMLCanvasElement[] = [];
  private levels = new Float32Array(BARS);
  private peaks = new Float32Array(BARS);
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
      s.aura !== prev.aura ||
      s.player.playing !== prev.player.playing ||
      s.player.current !== prev.player.current
    ) {
      this.sync(s);
    }
  }

  private sync(s: AppState): void {
    // Levels are also fetched for the mascot even when the bars are hidden.
    this.active = (s.visualizer || s.mascot || s.aura) && s.player.playing && s.player.current !== null && !document.hidden;
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
      this.peaks.fill(0);
      this.draw();
      this.running = false;
      return;
    }
    requestAnimationFrame((t) => this.tick(t));
  }

  private draw(): void {
    const root = document.documentElement;
    const theme = root.dataset.theme ?? "";
    const flat = root.dataset.style === "flat";
    // The accent follows the current artwork (and fades between songs).
    const css = getComputedStyle(root);
    const colours = { accent: css.getPropertyValue("--accent"), light: css.getPropertyValue("--accent-light"), dark: css.getPropertyValue("--accent-dark") };
    // Winamp-style falling peak caps.
    for (let i = 0; i < BARS; i++) {
      const v = this.levels[i] ?? 0;
      this.peaks[i] = v >= (this.peaks[i] ?? 0) ? v : Math.max(0, (this.peaks[i] ?? 0) - 0.012);
    }
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
      const level = (i: number): number => this.levels[Math.floor((i * BARS) / count)] ?? 0;
      const peak = (i: number): number => this.peaks[Math.floor((i * BARS) / count)] ?? 0;
      if (theme === "frutiger-aero") drawWave(ctx, w, h, count, level, colours);
      else if (theme === "winamp") drawBlocks(ctx, w, h, count, level, peak);
      else if (theme === "midnight") drawStars(ctx, w, h, count, level, colours);
      else if (theme === "chrome") drawMirror(ctx, w, h, count, level, colours);
      else if (theme === "bubblegum") drawBubbles(ctx, w, h, count, level, colours);
      else if (theme === "oled") drawLine(ctx, w, h, count, level, colours);
      else if (theme === "song") drawBars(ctx, w, h, count, level, colours, flat, true);
      else drawBars(ctx, w, h, count, level, colours, flat);
    }
  }
}

type Colours = { accent: string; light: string; dark: string };

/** Default: rounded bars in the accent colour. */
function drawBars(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, level: (i: number) => number, c: Colours, flat: boolean, sweep = false): void {
  const gap = 2;
  const barW = Math.max(1, (w - gap * (count - 1)) / count);
  let grad: CanvasGradient;
  if (sweep) {
    // Song theme: the cover's colours sweep across the bars.
    grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, withAlpha(c.dark, 0.55));
    grad.addColorStop(0.5, withAlpha(c.accent, 0.5));
    grad.addColorStop(1, withAlpha(c.light, 0.55));
  } else {
    grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, withAlpha(flat ? c.accent : c.dark, flat ? 0.3 : 0.5));
    grad.addColorStop(1, withAlpha(c.light, flat ? 0.1 : 0.2));
  }
  ctx.fillStyle = grad;
  for (let i = 0; i < count; i++) {
    const barH = Math.max(0, level(i) * h * 0.9);
    if (barH < 1) continue;
    ctx.beginPath();
    ctx.roundRect(i * (barW + gap), h - barH, barW, barH, Math.min(3, barW / 2));
    ctx.fill();
  }
}

/** Chrome: bars mirrored around a centre line, like a reflection. */
function drawMirror(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, level: (i: number) => number, c: Colours): void {
  const gap = 2;
  const barW = Math.max(1, (w - gap * (count - 1)) / count);
  const mid = h * 0.62;
  const up = ctx.createLinearGradient(0, mid, 0, 0);
  up.addColorStop(0, "rgba(255, 255, 255, 0.55)");
  up.addColorStop(0.5, withAlpha(c.light, 0.45));
  up.addColorStop(1, "rgba(255, 255, 255, 0.15)");
  const down = ctx.createLinearGradient(0, mid, 0, h);
  down.addColorStop(0, "rgba(255, 255, 255, 0.22)");
  down.addColorStop(1, "rgba(255, 255, 255, 0)");
  for (let i = 0; i < count; i++) {
    const v = level(i);
    if (v < 0.01) continue;
    const x = i * (barW + gap);
    ctx.fillStyle = up;
    ctx.fillRect(x, mid - v * mid * 0.95, barW, v * mid * 0.95);
    ctx.fillStyle = down;
    ctx.fillRect(x, mid + 1, barW, v * (h - mid) * 0.9);
  }
}

/** Bubblegum: each bar is a stack of little bubbles. */
function drawBubbles(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, level: (i: number) => number, c: Colours): void {
  const n = Math.max(8, Math.round(count * 0.75));
  const step = w / n;
  const r = Math.max(2, Math.min(step * 0.38, 6));
  const rows = Math.floor(h / (r * 2 + 2));
  for (let i = 0; i < n; i++) {
    const lit = Math.round(level(Math.floor((i * count) / n)) * rows * 0.9);
    const x = i * step + step / 2;
    for (let k = 0; k < lit; k++) {
      const y = h - r - 1 - k * (r * 2 + 2);
      ctx.fillStyle = withAlpha(k % 2 ? c.light : c.accent, 0.35 + (k / rows) * 0.4);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** OLED: a single thin line. */
function drawLine(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, level: (i: number) => number, c: Colours): void {
  const step = w / (count - 1);
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const y = h - 2 - level(i) * (h - 4) * 0.85;
    if (i === 0) ctx.moveTo(0, y);
    else ctx.lineTo(i * step, y);
  }
  ctx.strokeStyle = withAlpha(c.accent, 0.8);
  ctx.lineWidth = 1.25;
  ctx.stroke();
}

/** Frutiger Aero: a smooth liquid wave with a glossy top edge. */
function drawWave(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, level: (i: number) => number, c: Colours): void {
  const step = w / (count - 1);
  const y = (i: number): number => h - Math.max(0.02, level(i)) * h * 0.85;
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, y(0));
  for (let i = 1; i < count; i++) {
    const x0 = (i - 1) * step;
    const x1 = i * step;
    const mx = (x0 + x1) / 2;
    ctx.bezierCurveTo(mx, y(i - 1), mx, y(i), x1, y(i));
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, withAlpha(c.light, 0.45));
  grad.addColorStop(1, withAlpha(c.dark, 0.12));
  ctx.fillStyle = grad;
  ctx.fill();
  // Glossy highlight along the surface.
  ctx.beginPath();
  ctx.moveTo(0, y(0));
  for (let i = 1; i < count; i++) {
    const x0 = (i - 1) * step;
    const x1 = i * step;
    const mx = (x0 + x1) / 2;
    ctx.bezierCurveTo(mx, y(i - 1), mx, y(i), x1, y(i));
  }
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** Winamp: stacked pixel blocks, green → yellow → red, with falling peaks. */
function drawBlocks(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, level: (i: number) => number, peak: (i: number) => number): void {
  const gap = 2;
  const barW = Math.max(2, Math.floor((w - gap * (count - 1)) / count));
  const block = 3;
  const rows = Math.floor(h / (block + 1));
  const colour = (row: number): string => {
    const t = row / rows;
    return t > 0.85 ? "rgba(255, 70, 50, 0.85)" : t > 0.6 ? "rgba(240, 220, 60, 0.75)" : "rgba(60, 230, 90, 0.6)";
  };
  for (let i = 0; i < count; i++) {
    const x = i * (barW + gap);
    const lit = Math.round(level(i) * rows * 0.9);
    for (let r = 0; r < lit; r++) {
      ctx.fillStyle = colour(r);
      ctx.fillRect(x, h - (r + 1) * (block + 1), barW, block);
    }
    const p = Math.round(peak(i) * rows * 0.9);
    if (p > 0) {
      ctx.fillStyle = "rgba(220, 255, 220, 0.8)";
      ctx.fillRect(x, h - (p + 1) * (block + 1), barW, 2);
    }
  }
}

/** Midnight: glowing dots joined like a constellation. */
function drawStars(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, level: (i: number) => number, c: Colours): void {
  const n = Math.max(8, Math.round(count / 2));
  const step = w / (n - 1);
  const pts: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const v = level(Math.floor((i * count) / n));
    pts.push([i * step, h - (0.08 + v * 0.8) * h, v]);
  }
  ctx.strokeStyle = withAlpha(c.light, 0.25);
  ctx.lineWidth = 1;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
  for (const [x, y, v] of pts) {
    const r = 1.2 + v * 2.6;
    ctx.fillStyle = withAlpha(c.light, 0.35 + v * 0.6);
    ctx.shadowColor = withAlpha(c.accent, 0.9);
    ctx.shadowBlur = 4 + v * 10;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

/** "rgb(1, 2, 3)" (a computed colour) → "rgba(1, 2, 3, a)". */
function withAlpha(colour: string, alpha: number): string {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(colour);
  return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})` : `rgba(255, 121, 0, ${alpha})`;
}
