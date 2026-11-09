// 10-band equalizer panel (opened from Settings).
import { h } from "../lib/dom";
import { EQ_FREQUENCIES, EQ_PRESETS } from "../lib/eqPresets";
import type { AppStore } from "../state";

const MAX_DB = 12;

function formatDb(v: number): string {
  return `${v > 0 ? "+" : ""}${Math.round(v)}`;
}

export function buildEqualizerPanel(store: AppStore): HTMLElement {
  const s = store.get();

  const enable = h("input", { attrs: { type: "checkbox" } });
  enable.checked = s.eqEnabled;
  enable.addEventListener("change", () => store.set({ eqEnabled: enable.checked }));

  const preset = h("select", { class: "glass-field eq-preset", attrs: { "aria-label": "Preset" } });
  for (const [id, p] of Object.entries(EQ_PRESETS)) {
    preset.append(h("option", { text: p.label, attrs: { value: id } }));
  }
  preset.append(h("option", { text: "Custom", attrs: { value: "custom" } }));
  preset.value = s.eqPreset in EQ_PRESETS ? s.eqPreset : "custom";

  const sliders: HTMLInputElement[] = [];
  const values: HTMLElement[] = [];
  const bands = h("div", { class: "eq-bands" });
  EQ_FREQUENCIES.forEach((freq, i) => {
    const value = h("span", { class: "eq-value", text: formatDb(s.eqGains[i] ?? 0) });
    const slider = h("input", {
      class: "eq-slider",
      attrs: { type: "range", min: String(-MAX_DB), max: String(MAX_DB), step: "1", "aria-label": `${freq} Hz` },
    });
    slider.value = String(s.eqGains[i] ?? 0);
    slider.addEventListener("input", () => {
      const gains = [...store.get().eqGains];
      gains[i] = Number(slider.value);
      value.textContent = formatDb(gains[i] ?? 0);
      preset.value = "custom";
      enable.checked = true;
      store.set({ eqGains: gains, eqPreset: "custom", eqEnabled: true });
    });
    sliders.push(slider);
    values.push(value);
    bands.append(h("div", { class: "eq-band" }, [value, slider, h("span", { class: "eq-freq", text: freq })]));
  });

  const applyGains = (gains: number[]): void => {
    gains.forEach((g, i) => {
      const slider = sliders[i];
      const value = values[i];
      if (slider) slider.value = String(g);
      if (value) value.textContent = formatDb(g);
    });
  };

  preset.addEventListener("change", () => {
    const chosen = EQ_PRESETS[preset.value];
    if (!chosen) return;
    applyGains(chosen.gains);
    enable.checked = true;
    store.set({ eqGains: [...chosen.gains], eqPreset: preset.value, eqEnabled: true });
  });

  const reset = h("button", { class: "glass-btn small", text: "Reset", attrs: { type: "button" } });
  reset.addEventListener("click", () => {
    const flat = EQ_PRESETS.flat?.gains ?? new Array(10).fill(0);
    applyGains(flat);
    preset.value = "flat";
    store.set({ eqGains: [...flat], eqPreset: "flat" });
  });

  return h("div", { class: "eq-panel", attrs: { role: "dialog", "aria-label": "Equalizer" } }, [
    h("div", { class: "eq-header" }, [
      h("h3", { text: "Equalizer" }),
      h("label", { class: "check eq-enable" }, [enable, h("span", { text: "On" })]),
    ]),
    h("div", { class: "eq-controls" }, [preset, reset]),
    bands,
    h("p", { class: "muted small", text: "dB per band. Changes apply instantly." }),
  ]);
}
