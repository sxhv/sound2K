// A glow around the window edges, in the song's colour, that moves with the
// music. Two layers, so it doesn't feel mechanical:
//   rim   — a sharp edge light that snaps on at each drum hit and falls off
//           fast along a curve (hard hits pop, soft ones barely flicker);
//   bloom — a wide soft glow that swells and sinks with the song's bass
//           energy (loud drops glow, quiet parts settle), plus a kick on hits.
// Hits come from the bass level the visualizer already reads: a hit is the
// bass jumping clearly above its recent average. Only opacity changes each
// frame, so it's cheap to draw.
import type { AppState } from "../state";
import type { Visualizer } from "./visualizer";

const MIN_GAP_MS = 200; // at most ~5 hits a second

export class BeatAura {
  readonly el: HTMLElement;
  private readonly rimEl: HTMLElement;
  private readonly bloomEl: HTMLElement;
  private avg = 0;
  private prevBass = 0;
  private lastHit = 0;
  private rim = 0; // 0..1, set by hits
  private env = 0; // smoothed bass energy
  private kick = 0; // extra bloom from hits
  private bloom = 0; // displayed bloom
  private enabled = true;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  constructor(visualizer: Visualizer) {
    this.bloomEl = document.createElement("div");
    this.bloomEl.className = "beat-aura-bloom";
    this.rimEl = document.createElement("div");
    this.rimEl.className = "beat-aura-rim";
    this.el = document.createElement("div");
    this.el.className = "beat-aura";
    this.el.setAttribute("aria-hidden", "true");
    this.el.append(this.bloomEl, this.rimEl);
    visualizer.onBeat((bass) => this.onBass(bass));
  }

  private onBass(bass: number): void {
    if (!this.enabled || this.reducedMotion.matches) return;
    const now = performance.now();
    const rise = bass - this.prevBass;
    this.prevBass = bass;
    this.avg = this.avg * 0.93 + bass * 0.07;

    // Drum hit: how far above the recent average decides how hard it pops.
    if (bass > 0.12 && rise > 0.025 && bass > this.avg * 1.15 + 0.02 && now - this.lastHit > MIN_GAP_MS) {
      this.lastHit = now;
      const strength = Math.min(1, (bass - this.avg) * 3.4 + 0.25);
      this.rim = Math.max(this.rim, strength);
      this.kick = Math.max(this.kick, strength * 0.55);
    } else {
      this.rim *= 0.8; // quick fall-off
    }
    this.kick *= 0.9;

    // Bass energy: rises fairly fast, falls slowly.
    this.env += (bass - this.env) * (bass > this.env ? 0.3 : 0.05);
    const energy = clamp((this.env - 0.18) / 0.55);
    const target = Math.min(1, energy * energy * 0.5 + this.kick);
    this.bloom += (target - this.bloom) * (target > this.bloom ? 0.5 : 0.12);

    this.paint();
  }

  private paint(): void {
    // Curves rather than straight lines: small values shrink, peaks stay.
    const rim = this.rim < 0.02 ? 0 : Math.pow(this.rim, 1.7);
    const bloom = this.bloom < 0.02 ? 0 : smooth(this.bloom);
    this.rimEl.style.opacity = rim.toFixed(3);
    this.bloomEl.style.opacity = bloom.toFixed(3);
  }

  update(s: AppState, prev: AppState | null): void {
    if (!prev || s.aura !== prev.aura) {
      this.enabled = s.aura;
      this.el.hidden = !s.aura;
    }
    const playing = s.player.playing && s.player.current !== null;
    if (!playing && (this.rim > 0 || this.bloom > 0)) {
      this.rim = this.kick = this.bloom = this.env = 0;
      this.paint();
    }
  }
}

function clamp(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Smoothstep: eases in and out. */
function smooth(x: number): number {
  const t = clamp(x);
  return t * t * (3 - 2 * t);
}
