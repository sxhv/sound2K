// Sound page (opened from the top bar): crossfade and volume levelling,
// each with a small live illustration.
import { h } from "../lib/dom";
import type { AppState, AppStore } from "../state";

const MAX_FADE = 12;
const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export class SoundPage {
  readonly el: HTMLElement;
  private readonly fade: HTMLInputElement;
  private readonly fadeValue: HTMLElement;
  private readonly fadeOut: SVGPathElement;
  private readonly fadeIn: SVGPathElement;
  private readonly level: HTMLInputElement;
  private readonly levelCard: HTMLElement;

  constructor(store: AppStore) {
    // --- Crossfade ---
    this.fade = h("input", {
      class: "range setting-range",
      attrs: { type: "range", min: "0", max: String(MAX_FADE), step: "1", "aria-label": "Crossfade seconds" },
    });
    this.fade.addEventListener("input", () => store.set({ crossfadeSecs: Number(this.fade.value) }));
    this.fadeValue = h("span", { class: "big-value" });

    const fadeSvg = svgEl("svg", { class: "fade-diagram", viewBox: "0 0 400 90", preserveAspectRatio: "none", "aria-hidden": "true" });
    this.fadeOut = svgEl("path", { class: "fade-a" });
    this.fadeIn = svgEl("path", { class: "fade-b" });
    fadeSvg.append(this.fadeOut, this.fadeIn);

    // --- Volume levelling ---
    this.level = h("input", { class: "switch", attrs: { type: "checkbox", role: "switch", "aria-label": "Volume levelling" } });
    this.level.addEventListener("change", () => store.set({ normalize: this.level.checked }));
    const bars = h("div", { class: "level-bars", attrs: { "aria-hidden": "true" } });
    [0.35, 0.9, 0.55, 1, 0.3, 0.75, 0.45, 0.95].forEach((v, i) => {
      const bar = h("i");
      bar.style.setProperty("--raw", String(v));
      bar.style.setProperty("--i", String(i));
      bars.append(bar);
    });

    this.levelCard = h("div", { class: "sound-card glass-panel" }, [
      h("div", { class: "sound-card-head" }, [h("h2", { text: "Volume levelling" }), h("div", { class: "spacer" }), this.level]),
      bars,
    ]);

    this.el = h("section", { class: "page sound-page", attrs: { "aria-label": "Sound" } }, [
      h("header", { class: "page-header" }, [h("h1", { text: "Sound" })]),
      h("div", { class: "sound-card glass-panel" }, [
        h("div", { class: "sound-card-head" }, [h("h2", { text: "Crossfade" }), h("div", { class: "spacer" }), this.fadeValue]),
        fadeSvg,
        this.fade,
      ]),
      this.levelCard,
    ]);
  }

  update(s: AppState, prev: AppState | null): void {
    if (!prev || s.crossfadeSecs !== prev.crossfadeSecs) {
      const secs = s.crossfadeSecs;
      if (document.activeElement !== this.fade) this.fade.value = String(secs);
      this.fade.style.setProperty("--pct", `${(secs / MAX_FADE) * 100}%`);
      this.fadeValue.textContent = secs === 0 ? "Off" : `${secs} s`;
      // Two songs as volume envelopes; the overlap grows with the fade.
      const overlap = (secs / MAX_FADE) * 140;
      const mid = 200;
      const a0 = mid - overlap / 2;
      const a1 = mid + overlap / 2;
      this.fadeOut.setAttribute("d", `M0 88 L0 14 L${a0} 14 C${a0 + overlap * 0.5} 14 ${a1 - overlap * 0.3} 88 ${a1} 88 Z`);
      this.fadeIn.setAttribute("d", `M${a0} 88 C${a0 + overlap * 0.3} 88 ${a1 - overlap * 0.5} 14 ${a1} 14 L400 14 L400 88 Z`);
    }
    if (!prev || s.normalize !== prev.normalize) {
      this.level.checked = s.normalize;
      this.levelCard.classList.toggle("is-on", s.normalize);
    }
  }
}
