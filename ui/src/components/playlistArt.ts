// Square playlist cover (with a colour placeholder while it loads).
import { artUrl } from "../lib/artwork";
import { h } from "../lib/dom";
import { placeholderGradient } from "../lib/format";
import type { PlaylistSummary } from "../types";

export function playlistArt(p: PlaylistSummary): HTMLElement {
  const art = h("div", { class: "art art-playlist", attrs: { "aria-hidden": "true" } });
  art.style.background = placeholderGradient(p.id);
  const src = artUrl(p.artworkUrl, "t300x300");
  if (src) {
    const img = h("img", { attrs: { src, alt: "", loading: "lazy", decoding: "async" } });
    img.addEventListener("error", () => img.remove());
    if (img.complete) img.classList.add("is-loaded");
    else img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
    art.append(img);
  }
  return art;
}
