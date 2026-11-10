// A glow around the window edges, in the song's colour, that pulses on drum
// hits. Hits are found from the bass level the visualizer already reads:
// a hit is the bass jumping clearly above its recent average. Only the
// overlay's opacity changes each frame, so it's cheap to draw.
import type { AppState } from "../state";
import type { Visualizer } from "./visualizer";

const MIN_GAP_MS = 180; // at most ~5 hits a second
const DECAY = 0.84; // per frame (~30 fps)

export class BeatAura {
  readonly el: HTMLElement;
  private readonly flash: HTMLElement;
  private avg = 0;
  private prevBass = 0;
  private level = 0;
  private lastHit = 0;
  private enabled = true;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  constructor(visualizer: Visualizer) {
    this.flash = document.createElement("div");
    this.flash.className = "beat-aura-flash";
    this.el = document.createElement("div");
    this.el.className = "beat-aura";
    this.el.setAttribute("aria-hidden", "true");
    this.el.append(this.flash);
    visualizer.onBeat((bass) => this.onBass(bass));
  }

  private onBass(bass: number): void {
    if (!this.enabled || this.reducedMotion.matches) return;
    const now = performance.now();
    const rise = bass - this.prevBass;
    this.prevBass = bass;
    this.avg = this.avg * 0.93 + bass * 0.07;
    if (bass > 0.12 && rise > 0.025 && bass > this.avg * 1.18 + 0.02 && now - this.lastHit > MIN_GAP_MS) {
      this.lastHit = now;
      // Harder hits glow brighter.
      this.level = Math.max(this.level, Math.min(1, 0.4 + (bass - this.avg) * 3.2));
    } else {
      this.level *= DECAY;
    }
    this.paint();
  }

  private paint(): void {
    const v = this.level < 0.02 ? 0 : this.level;
    this.flash.style.opacity = v.toFixed(3);
  }

  update(s: AppState, prev: AppState | null): void {
    if (!prev || s.aura !== prev.aura) {
      this.enabled = s.aura;
      this.el.hidden = !s.aura;
    }
    const playing = s.player.playing && s.player.current !== null;
    if (!playing && this.level > 0) {
      this.level = 0;
      this.paint();
    }
  }
}
