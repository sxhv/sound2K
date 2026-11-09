// Equalizer page (opened from the top bar): preset chips, a live response
// curve and ten big band sliders.
import { button, h } from "../lib/dom";
import { EQ_FREQUENCIES, EQ_PRESETS } from "../lib/eqPresets";
import type { AppState, AppStore } from "../state";

const MAX_DB = 12;
const SVG_NS = "http://www.w3.org/2000/svg";

function formatDb(v: number): string {
  return `${v > 0 ? "+" : ""}${Math.round(v)} dB`;
}

/** Smooth path through the band points (Catmull-Rom → cubic Bézier). */
export function curvePath(gains: readonly number[], width: number, height: number): string {
  const n = gains.length;
  if (n === 0) return "";
  const pts = gains.map((g, i) => [((i + 0.5) / n) * width, height / 2 - (g / MAX_DB) * (height / 2 - 6)] as const);
  const first = pts[0] as readonly [number, number];
  let d = `M0 ${first[1].toFixed(1)} L${first[0].toFixed(1)} ${first[1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)] as readonly [number, number];
    const p1 = pts[i] as readonly [number, number];
    const p2 = pts[i + 1] as readonly [number, number];
    const p3 = pts[Math.min(n - 1, i + 2)] as readonly [number, number];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const last = pts[n - 1] as readonly [number, number];
  return `${d} L${width} ${last[1].toFixed(1)}`;
}

export class EqualizerPage {
  readonly el: HTMLElement;
  private readonly onSwitch: HTMLInputElement;
  private readonly chips = new Map<string, HTMLButtonElement>();
  private readonly sliders: HTMLInputElement[] = [];
  private readonly values: HTMLElement[] = [];
  private readonly line: SVGPathElement;
  private readonly area: SVGPathElement;

  constructor(private readonly store: AppStore) {
    this.onSwitch = h("input", { class: "switch", attrs: { type: "checkbox", role: "switch", "aria-label": "Equalizer on" } });
    this.onSwitch.addEventListener("change", () => store.set({ eqEnabled: this.onSwitch.checked }));

    const chipRow = h("div", { class: "chip-row", attrs: { role: "radiogroup", "aria-label": "Presets" } });
    for (const [id, p] of Object.entries(EQ_PRESETS)) {
      const chip = h("button", { class: "chip", text: p.label, attrs: { type: "button", role: "radio" } });
      chip.addEventListener("click", () => store.set({ eqGains: [...p.gains], eqPreset: id, eqEnabled: true }));
      this.chips.set(id, chip);
      chipRow.append(chip);
    }
    const custom = h("button", { class: "chip", text: "Custom", attrs: { type: "button", role: "radio", disabled: "" } });
    this.chips.set("custom", custom);
    chipRow.append(custom);

    // Response curve (viewBox 1000×200, stretched to fit).
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "eq-curve");
    svg.setAttribute("viewBox", "0 0 1000 200");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    const mid = document.createElementNS(SVG_NS, "line");
    mid.setAttribute("x1", "0");
    mid.setAttribute("x2", "1000");
    mid.setAttribute("y1", "100");
    mid.setAttribute("y2", "100");
    mid.setAttribute("class", "eq-curve-mid");
    this.area = document.createElementNS(SVG_NS, "path");
    this.area.setAttribute("class", "eq-curve-area");
    this.line = document.createElementNS(SVG_NS, "path");
    this.line.setAttribute("class", "eq-curve-line");
    svg.append(mid, this.area, this.line);

    const bands = h("div", { class: "eq-page-bands" });
    EQ_FREQUENCIES.forEach((freq, i) => {
      const value = h("span", { class: "eq-value" });
      const slider = h("input", {
        class: "eq-slider eq-slider-big",
        attrs: { type: "range", min: String(-MAX_DB), max: String(MAX_DB), step: "1", "aria-label": `${freq} Hz` },
      });
      slider.addEventListener("input", () => {
        const gains = [...this.store.get().eqGains];
        gains[i] = Number(slider.value);
        this.store.set({ eqGains: gains, eqPreset: "custom", eqEnabled: true });
      });
      slider.addEventListener("dblclick", () => {
        const gains = [...this.store.get().eqGains];
        gains[i] = 0;
        this.store.set({ eqGains: gains, eqPreset: "custom" });
      });
      this.sliders.push(slider);
      this.values.push(value);
      bands.append(h("div", { class: "eq-band" }, [value, slider, h("span", { class: "eq-freq", text: freq })]));
    });

    const reset = button({
      label: "Reset",
      text: "Reset",
      class: "glass-btn small",
      onClick: () => store.set({ eqGains: [...(EQ_PRESETS.flat?.gains ?? new Array(10).fill(0))], eqPreset: "flat" }),
    });

    this.el = h("section", { class: "page eq-page", attrs: { "aria-label": "Equalizer" } }, [
      h("header", { class: "page-header" }, [
        h("h1", { text: "Equalizer" }),
        h("label", { class: "switch-label" }, [this.onSwitch]),
        h("div", { class: "spacer" }),
        reset,
      ]),
      chipRow,
      h("div", { class: "eq-stage glass-panel" }, [svg, bands]),
    ]);
  }

  update(s: AppState, prev: AppState | null): void {
    if (prev && s.eqGains === prev.eqGains && s.eqEnabled === prev.eqEnabled && s.eqPreset === prev.eqPreset) return;
    this.onSwitch.checked = s.eqEnabled;
    this.el.classList.toggle("is-off", !s.eqEnabled);
    const active = s.eqPreset in EQ_PRESETS ? s.eqPreset : "custom";
    for (const [id, chip] of this.chips) {
      chip.classList.toggle("is-selected", id === active);
      chip.setAttribute("aria-checked", String(id === active));
    }
    s.eqGains.forEach((g, i) => {
      const slider = this.sliders[i];
      if (slider && document.activeElement !== slider) slider.value = String(g);
      const value = this.values[i];
      if (value) value.textContent = formatDb(g);
    });
    const d = curvePath(s.eqGains, 1000, 200);
    this.line.setAttribute("d", d);
    this.area.setAttribute("d", `${d} L1000 100 L0 100 Z`);
  }
}
