import { h } from "../lib/dom";
import { formatDuration, placeholderGradient } from "../lib/format";
import { icon } from "../lib/icons";
import { artUrl, type ArtSize } from "../lib/artwork";
import type { AppState } from "../state";
import type { Track } from "../types";

/** Must match `.track-row` height + margin in components.css. */
export const ROW_HEIGHT = 52;

export interface RowHandlers {
  select(track: Track): void;
  play(track: Track, index: number): void;
  menu(track: Track, anchor: HTMLElement, index: number): void;
  toggleLike(track: Track): void;
  /** Open the artist page (artist name click). */
  artist?(track: Track): void;
}

export interface RowState {
  currentId: string | null;
  playing: boolean;
  selectedId: string | null;
  likedIds: ReadonlySet<string>;
}

export function rowState(s: AppState): RowState {
  return {
    currentId: s.player.current?.id ?? null,
    playing: s.player.playing,
    selectedId: s.selectedId,
    likedIds: s.likedIds,
  };
}

/** Square artwork with a colour placeholder and a (hidden) equalizer.
 * `size` picks a sharper image for big artwork. */
export function artwork(track: Track | null, sizeClass: string, size: ArtSize = "large"): HTMLElement {
  const box = h("div", { class: `art ${sizeClass}` });
  if (track) {
    box.style.background = placeholderGradient(track.id);
    const src = artUrl(track.artworkUrl, size);
    if (src) {
      const img = h("img", { attrs: { src, alt: "", loading: "lazy", decoding: "async" } });
      img.addEventListener("error", () => img.remove());
      // Fade in when it arrives (already-cached images show at once, so
      // scrolling a list doesn't flicker).
      if (img.complete) img.classList.add("is-loaded");
      else img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
      box.append(img);
    }
  }
  box.append(h("div", { class: "eq", attrs: { "aria-hidden": "true" } }, [h("i"), h("i"), h("i")]));
  return box;
}

/** Replace the artwork in `slot` with a cross-fade. */
export function swapArt(slot: HTMLElement, next: HTMLElement): void {
  slot.classList.add("art-swap");
  for (const old of Array.from(slot.children) as HTMLElement[]) {
    if (old.classList.contains("is-leaving")) continue;
    old.classList.add("is-leaving");
    window.setTimeout(() => old.remove(), 450);
  }
  slot.append(next);
}

export function buildTrackRow(
  track: Track,
  index: number,
  handlers: RowHandlers,
  extras: readonly HTMLElement[] = [],
): HTMLElement {
  const row = h("div", { class: "track-row", attrs: { role: "listitem", tabindex: "0", "data-id": track.id } });
  if (!track.playable) row.classList.add("is-unavailable");

  const titleLine = h("div", { class: "track-title-line" }, [
    h("span", { class: "track-title", text: track.title, attrs: { title: track.title } }),
  ]);
  if (!track.playable) titleLine.append(h("span", { class: "badge", text: "Unavailable" }));

  const artistEl = h("span", { class: "track-artist", text: track.artist });
  if (handlers.artist && track.artist) {
    artistEl.classList.add("is-link");
    artistEl.title = `Go to ${track.artist}`;
    artistEl.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.artist?.(track);
    });
    artistEl.addEventListener("dblclick", (e) => e.stopPropagation());
  }
  const meta = h("div", { class: "track-meta" }, [titleLine, artistEl]);

  const like = h("button", { class: "icon-btn track-like", attrs: { type: "button" } }, [icon("heart")]);
  like.addEventListener("click", (e) => {
    e.stopPropagation();
    handlers.toggleLike(track);
  });
  like.addEventListener("dblclick", (e) => e.stopPropagation());

  const more = h(
    "button",
    { class: "icon-btn row-more", attrs: { type: "button", "aria-label": "More options", title: "More", "aria-haspopup": "menu" } },
    [icon("more")],
  );
  more.addEventListener("click", (e) => {
    e.stopPropagation();
    handlers.menu(track, more, index);
  });
  more.addEventListener("dblclick", (e) => e.stopPropagation());

  row.addEventListener("click", () => handlers.select(track));
  row.addEventListener("dblclick", () => handlers.play(track, index));
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handlers.play(track, index);
    }
  });

  row.append(
    artwork(track, "art-row"),
    meta,
    ...extras,
    like,
    h("span", { class: "track-duration", text: formatDuration(track.durationMs) }),
    more,
  );
  return row;
}

export function decorateRow(row: HTMLElement, track: Track, s: RowState): void {
  const isCurrent = s.currentId === track.id;
  const isSelected = s.selectedId === track.id;
  row.classList.toggle("is-current", isCurrent);
  row.classList.toggle("is-playing", isCurrent && s.playing);
  row.classList.toggle("is-selected", isSelected);
  row.setAttribute("aria-current", isCurrent ? "true" : "false");
  const liked = s.likedIds.has(track.id);
  row.classList.toggle("is-liked", liked);
  const like = row.querySelector<HTMLElement>(".track-like");
  if (like) {
    const label = liked ? "Unlike" : "Like";
    like.setAttribute("aria-label", label);
    like.setAttribute("aria-pressed", String(liked));
    like.title = label;
  }
}
