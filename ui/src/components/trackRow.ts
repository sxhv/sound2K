import { h } from "../lib/dom";
import { formatCount, formatDuration, placeholderGradient } from "../lib/format";
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
  /** Repost / remove repost (SoundCloud tracks, signed in). */
  toggleRepost?(track: Track): void;
  /** Open the artist page (artist name click). */
  artist?(track: Track): void;
}

export interface RowState {
  currentId: string | null;
  playing: boolean;
  selectedId: string | null;
  likedIds: ReadonlySet<string>;
  repostedIds: ReadonlySet<string>;
  /** Signed-in user's id (null = signed out: no repost buttons). */
  accountId: number | null;
}

export function rowState(s: AppState): RowState {
  return {
    currentId: s.player.current?.id ?? null,
    playing: s.player.playing,
    selectedId: s.selectedId,
    likedIds: s.likedIds,
    repostedIds: s.repostedIds,
    accountId: s.account?.id ?? null,
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

  const repost = h("button", { class: "icon-btn track-repost", attrs: { type: "button", "aria-label": "Repost", title: "Repost" } }, [icon("repost")]);
  repost.hidden = !handlers.toggleRepost || !track.id.startsWith("sc:");
  repost.addEventListener("click", (e) => {
    e.stopPropagation();
    handlers.toggleRepost?.(track);
  });
  repost.addEventListener("dblclick", (e) => e.stopPropagation());

  // Play count, as shown on SoundCloud.
  const plays = h("span", { class: "track-plays" });
  if (typeof track.plays === "number") {
    plays.append(icon("play"), h("span", { text: formatCount(track.plays) }));
    plays.title = `${track.plays.toLocaleString()} plays`;
  }

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
    plays,
    repost,
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
  const repost = row.querySelector<HTMLElement>(".track-repost");
  if (repost && repost.dataset.base !== "hidden") {
    if (repost.dataset.base === undefined) repost.dataset.base = repost.hidden ? "hidden" : "shown";
    const own = s.accountId === null || track.artistId === s.accountId;
    repost.hidden = repost.dataset.base === "hidden" || own;
    const on = s.repostedIds.has(track.id);
    row.classList.toggle("is-reposted", on);
    const label = on ? "Remove repost" : "Repost";
    repost.setAttribute("aria-label", label);
    repost.setAttribute("aria-pressed", String(on));
    repost.title = label;
  }
  const like = row.querySelector<HTMLElement>(".track-like");
  if (like) {
    const label = liked ? "Unlike" : "Like";
    like.setAttribute("aria-label", label);
    like.setAttribute("aria-pressed", String(liked));
    like.title = label;
  }
}
