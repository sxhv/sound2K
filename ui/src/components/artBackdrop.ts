// A blurred copy of the current artwork used as a background, cross-fading
// between tracks (Apple Music style). Used by the main window, the
// mini-player and the Now Playing view.
import { artUrl, cssUrl } from "../lib/artwork";
import { h } from "../lib/dom";
import { placeholderGradient } from "../lib/format";
import type { Track } from "../types";

const FADE_MS = 900;

export class ArtBackdrop {
  readonly el: HTMLElement;
  private key: string | null = null;

  constructor(extraClass = "") {
    this.el = h("div", { class: `art-backdrop ${extraClass}`.trim(), attrs: { "aria-hidden": "true" } });
  }

  /** Show `track`'s artwork (or nothing). Same track → no change. */
  set(track: Track | null, enabled: boolean): void {
    const key = enabled && track ? `${track.id}|${track.artworkUrl ?? ""}` : null;
    if (key === this.key) return;
    this.key = key;

    const old = Array.from(this.el.children) as HTMLElement[];
    for (const layer of old) {
      layer.classList.remove("is-visible");
      window.setTimeout(() => layer.remove(), FADE_MS + 50);
    }
    if (!key || !track) return;

    const layer = h("div", { class: "art-backdrop-layer" });
    // A small image is enough: it is blurred heavily anyway.
    const src = artUrl(track.artworkUrl, "t67x67");
    layer.style.backgroundImage = src ? cssUrl(src) : placeholderGradient(track.id);
    this.el.append(layer);
    // Next frame, so the opacity transition runs.
    requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add("is-visible")));
  }
}
