// The Sound2K cat: a headphone-wearing cat (from the user's logo) drawn as
// an SVG so its parts can move.
//
//  - playing: >ω< face, bobs and sways to the bass
//  - paused / nothing playing: sleepy – – eyes and floating "z"s
//  - loading: looks around (o o eyes)
//  - you like a song: hearts pop out
//  - click it: it hops and throws a few notes
import type { AppState } from "../state";
import type { Visualizer } from "./visualizer";

const INK = "#1b0f0a";

// Static markup (no user data), so building it from a string is safe.
const CAT_SVG = `
<svg class="cat" viewBox="-10 -14 246 196" aria-hidden="true" focusable="false">
  <g class="cat-rig">
    <path class="cat-band" d="M24 86 C24 30 70 9 113 9 C156 9 202 30 202 86" fill="none" stroke="${INK}" stroke-width="15" stroke-linecap="round"/>
    <path class="cat-band" d="M24 86 C24 30 70 9 113 9 C156 9 202 30 202 86" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
    <g class="cat-head">
      <path d="M88 50 Q112 42 137 50 C150 38 168 20 179 20 C191 20 194 50 185 72 C197 100 193 140 162 152 C140 160 84 160 62 152 C32 140 28 100 40 72 C31 50 34 20 46 20 C57 20 75 38 88 50 Z" fill="#fff" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
      <g class="cat-eyes cat-eyes-happy" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M60 92 L88 107 L60 121"/>
        <path d="M166 92 L138 107 L166 121"/>
      </g>
      <g class="cat-eyes cat-eyes-sleep" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round">
        <path d="M62 108 Q74 115 87 108"/>
        <path d="M139 108 Q152 115 164 108"/>
      </g>
      <g class="cat-eyes cat-eyes-look" fill="${INK}">
        <circle class="cat-pupil" cx="74" cy="104" r="8"/>
        <circle class="cat-pupil" cx="152" cy="104" r="8"/>
      </g>
      <path class="cat-mouth" d="M98 116 Q99 127 106 126 Q112 125 113.5 119 Q115 125 121 126 Q128 127 129 116" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <g class="cat-cups" fill="#fff" stroke="${INK}" stroke-width="4">
      <rect x="8" y="88" width="17" height="40" rx="8.5"/>
      <rect x="21" y="78" width="21" height="58" rx="10.5"/>
      <rect x="201" y="88" width="17" height="40" rx="8.5"/>
      <rect x="184" y="78" width="21" height="58" rx="10.5"/>
    </g>
  </g>
  <g class="cat-zzz" fill="#fff" font-weight="800" font-family="inherit">
    <text x="186" y="22" font-size="34">z</text>
    <text x="210" y="0" font-size="24">z</text>
  </g>
</svg>`;

const template = document.createElement("template");
template.innerHTML = CAT_SVG.trim();

export function catSvg(): SVGSVGElement {
  return template.content.firstElementChild!.cloneNode(true) as SVGSVGElement;
}

export class Mascot {
  readonly el: HTMLElement;
  private readonly rig: SVGGElement;
  private slow = 0;
  private bob = 0;
  private phase = 0;
  private lastLiked: boolean | null = null;
  private lastTrack: string | null = null;

  constructor(visualizer: Visualizer, sizeClass: string, title = "") {
    const svg = catSvg();
    this.rig = svg.querySelector(".cat-rig") as SVGGElement;
    this.el = document.createElement("div");
    this.el.className = `mascot ${sizeClass} is-sleeping`;
    if (title) this.el.title = title;
    this.el.append(svg);
    this.el.addEventListener("click", () => this.hop());
    visualizer.onBeat((bass) => this.dance(bass));
  }

  private dance(bass: number): void {
    if (!this.el.classList.contains("is-playing") || this.el.offsetParent === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // A "kick" is the bass jumping above its recent average.
    this.slow = this.slow * 0.9 + bass * 0.1;
    const kick = Math.max(0, bass - this.slow);
    this.bob = Math.max(this.bob * 0.72, Math.min(1, kick * 5));
    this.phase += 0.05 + bass * 0.08;
    const sway = Math.sin(this.phase) * (2 + bass * 5);
    this.rig.style.transform = `translateY(${(-this.bob * 9).toFixed(2)}px) rotate(${sway.toFixed(2)}deg) scale(${(1 + this.bob * 0.035).toFixed(3)}, ${(1 - this.bob * 0.04).toFixed(3)})`;
  }

  private hop(): void {
    this.el.classList.remove("is-hopping");
    void this.el.offsetWidth;
    this.el.classList.add("is-hopping");
    this.burst("notes");
  }

  /** Little particles (hearts or notes) that float up and fade. */
  private burst(kind: "hearts" | "notes"): void {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const glyphs = kind === "hearts" ? ["♥", "♥", "♥"] : ["♪", "♫", "♪"];
    glyphs.forEach((g, i) => {
      const p = document.createElement("span");
      p.className = `mascot-particle is-${kind}`;
      p.textContent = g;
      p.style.setProperty("--dx", `${(i - 1) * 22 + (Math.random() * 10 - 5)}px`);
      p.style.setProperty("--delay", `${i * 70}ms`);
      this.el.append(p);
      window.setTimeout(() => p.remove(), 1400);
    });
  }

  update(s: AppState): void {
    const p = s.player;
    const playing = p.playing && p.current !== null && !p.loading;
    this.el.classList.toggle("is-playing", playing);
    this.el.classList.toggle("is-loading", p.loading);
    this.el.classList.toggle("is-sleeping", !playing && !p.loading);
    if (!playing) {
      this.rig.style.transform = "";
      this.bob = 0;
    }
    // Hearts when the current song gets liked.
    const id = p.current?.id ?? null;
    const liked = id !== null && s.likedIds.has(id);
    if (id === this.lastTrack && this.lastLiked === false && liked) this.burst("hearts");
    this.lastTrack = id;
    this.lastLiked = liked;
  }
}
