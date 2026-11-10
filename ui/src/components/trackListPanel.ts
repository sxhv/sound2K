// A searchable / filterable / sortable track list used by Liked Songs,
// playlist detail and Recently Played.
import { button, h } from "../lib/dom";
import { applyQuery } from "../lib/filterSort";
import type { Player } from "../player/player";
import { DEFAULT_FILTERS, type AppState, type AppStore } from "../state";
import type { Track } from "../types";
import { artistUrl, downloadTrack, openOnSoundCloud, toggleLike } from "../library";
import { showMenu, type MenuItem } from "./popover";
import { ROW_HEIGHT, artwork, buildTrackRow, decorateRow, rowState, type RowHandlers } from "./trackRow";
import { icon } from "../lib/icons";
import { VirtualList } from "./virtualList";
import { catSvg } from "./mascot";
import { showAddToPlaylist } from "../playlistEdit";
import { canRepost, openArtistOf, repostOnSoundCloud } from "../browse";

const EMPTY: readonly Track[] = [];

export interface PanelOptions {
  label: string;
  source(s: AppState): readonly Track[] | null;
  emptyText(s: AppState): string;
  /** Sort + filter controls apply (search always applies). */
  filtersEnabled: boolean;
  /** Set false when the list has its own search box (artist pages). */
  globalSearch?: boolean;
  /** Identifies which list is shown; while it stays the same, updates
   * (paging, reordering) keep the scroll position. */
  sourceKey?(s: AppState): string;
  /** Called when scrolled near the end (load the next page). */
  onNearEnd?(): void;
  /** Drag-to-reorder (your own playlists). Only offered while the list is
   * shown in its real order (no search, sort or filters). */
  reorder?: {
    enabled(s: AppState): boolean;
    move(track: Track, toIndex: number): void;
  };
  /** Extra ⋯ menu items (e.g. "Remove from this playlist"). */
  extraMenu?(t: Track): MenuItem[];
}

export class TrackListPanel {
  readonly el: HTMLElement;
  private readonly list: VirtualList<Track>;
  private readonly empty: HTMLElement;
  private visible: Track[] = [];
  private lastSource: readonly Track[] | null = null;
  /** Rows show drag handles. */
  private dragOk = false;
  private dragId: string | null = null;
  /** Floating "Now playing" pill shown when the playing track is off-screen. */
  private readonly jumpBtn: HTMLButtonElement;

  constructor(
    private readonly store: AppStore,
    player: Player,
    private readonly opts: PanelOptions,
  ) {
    const handlers: RowHandlers = {
      select: (t) => store.set({ selectedId: t.id }),
      play: (_t, i) => player.playFromList(this.visible, i),
      menu: (t, anchor, i) =>
        showMenu(anchor, [
          ...trackMenu(store, player, t, () => player.playFromList(this.visible, i), anchor),
          ...(opts.extraMenu?.(t) ?? []),
        ]),
      toggleLike: (t) => void toggleLike(store, t),
      artist: (t) => openArtistOf(store, t),
    };
    this.list = new VirtualList<Track>(
      ROW_HEIGHT,
      (t, i) => {
        const row = buildTrackRow(t, i, handlers);
        if (this.dragOk) {
          const grip = h("button", { class: "icon-btn drag-handle", attrs: { type: "button", "aria-label": "Drag to reorder", title: "Drag to reorder" } }, [icon("grip")]);
          grip.addEventListener("pointerdown", (e) => this.startDrag(e, t, i, row));
          grip.addEventListener("click", (e) => e.stopPropagation());
          row.prepend(grip);
          row.classList.add("is-draggable");
        }
        if (t.id === this.dragId) row.classList.add("is-drag-source");
        return row;
      },
      (el, t) => decorateRow(el, t, rowState(this.store.get())),
      opts.label,
    );
    this.empty = h("div", { class: "empty-state" });
    this.empty.hidden = true;
    this.jumpBtn = button({ label: "Jump to the playing song (Ctrl+J)", icon: "locate", text: "Now playing", class: "jump-btn", onClick: () => this.jumpToCurrent() });
    this.jumpBtn.hidden = true;
    this.list.el.addEventListener(
      "scroll",
      () => {
        this.updateJump();
        const el = this.list.el;
        if (opts.onNearEnd && el.scrollTop + el.clientHeight > el.scrollHeight - 400) opts.onNearEnd();
      },
      { passive: true },
    );
    this.el = h("div", { class: "track-panel" }, [this.list.el, this.empty, this.jumpBtn]);
  }

  /** Pointer drag from a row's grip: a floating copy follows the mouse, a
   * line shows where it will land, and the list scrolls near its edges. */
  private startDrag(e: PointerEvent, track: Track, index: number, row: HTMLElement): void {
    if (e.button !== 0 || !this.opts.reorder) return;
    e.preventDefault();
    e.stopPropagation();
    const list = this.list.el;
    const n = this.visible.length;
    let x = e.clientX;
    let y = e.clientY;
    let target = index;
    let frame = 0;

    const ghost = h("div", { class: "drag-ghost" }, [artwork(track, "art-row"), h("span", { text: track.title })]);
    const line = h("div", { class: "drop-line" });
    document.body.append(ghost);
    this.el.append(line);
    this.el.classList.add("is-dragging");
    this.dragId = track.id;
    row.classList.add("is-drag-source");

    const place = (): void => {
      const rect = list.getBoundingClientRect();
      const edge = 56;
      if (y < rect.top + edge) list.scrollTop -= Math.ceil((rect.top + edge - y) / 3);
      else if (y > rect.bottom - edge) list.scrollTop += Math.ceil((y - (rect.bottom - edge)) / 3);
      target = Math.max(0, Math.min(n, Math.round((y - rect.top + list.scrollTop) / ROW_HEIGHT)));
      const top = list.offsetTop + target * ROW_HEIGHT - list.scrollTop;
      line.style.top = `${Math.max(list.offsetTop, Math.min(list.offsetTop + list.clientHeight, top)) - 1}px`;
      ghost.style.transform = `translate(${x + 14}px, ${y - 22}px)`;
      frame = requestAnimationFrame(place);
    };
    const onMove = (ev: PointerEvent): void => {
      x = ev.clientX;
      y = ev.clientY;
    };
    const finish = (drop: boolean): void => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      ghost.remove();
      line.remove();
      this.el.classList.remove("is-dragging");
      this.dragId = null;
      this.el.querySelectorAll(".is-drag-source").forEach((r) => r.classList.remove("is-drag-source"));
      const final = target > index ? target - 1 : target;
      if (drop && final !== index) this.opts.reorder?.move(track, final);
    };
    const onUp = (): void => finish(true);
    const onCancel = (): void => finish(false);
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        finish(false);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    frame = requestAnimationFrame(place);
  }

  get visibleTracks(): readonly Track[] {
    return this.visible;
  }

  private currentIndex(): number {
    const current = this.store.get().player.current;
    return current ? this.visible.findIndex((t) => t.id === current.id) : -1;
  }

  /** Scroll to the playing track; false if it isn't in this list. */
  jumpToCurrent(): boolean {
    const i = this.currentIndex();
    if (i < 0) return false;
    this.list.scrollToIndex(i, (row) => {
      row.classList.remove("is-flash");
      void row.offsetWidth;
      row.classList.add("is-flash");
    });
    return true;
  }

  private jumpFrame = 0;
  private updateJump(): void {
    if (this.jumpFrame) return;
    this.jumpFrame = requestAnimationFrame(() => {
      this.jumpFrame = 0;
      const i = this.currentIndex();
      const [first, last] = this.list.visibleRange();
      const off = i >= 0 && !this.list.el.hidden && (i < first || i > last);
      this.jumpBtn.hidden = !off;
      this.jumpBtn.classList.toggle("is-above", off && i < first);
    });
  }

  update(s: AppState, prev: AppState | null): void {
    const source = this.opts.source(s) ?? EMPTY;
    const sourceChanged = source !== this.lastSource;
    const queryChanged =
      prev === null || s.search !== prev.search || s.sort !== prev.sort || s.filters !== prev.filters;

    if (sourceChanged || queryChanged) {
      this.lastSource = source;
      this.visible = applyQuery(
        source,
        this.opts.filtersEnabled
          ? { search: s.search, sort: s.sort, filters: s.filters }
          : { search: this.opts.globalSearch === false ? "" : s.search, sort: "recently-liked", filters: DEFAULT_FILTERS },
      );
      const sortOrFilterChanged = prev !== null && (s.sort !== prev.sort || s.filters !== prev.filters);
      this.dragOk =
        this.opts.reorder?.enabled(s) === true &&
        this.visible.length === source.length &&
        this.visible.every((t, i) => t.id === source[i]?.id);
      this.el.classList.toggle("can-reorder", this.dragOk);
      // Same list updated (more pages loaded, a reorder…): keep the scroll
      // position. A different list starts at the top.
      const key = this.opts.sourceKey?.(s);
      const sameList = prev !== null && key !== undefined && key === this.opts.sourceKey?.(prev);
      this.list.setItems(this.visible, (sourceChanged && !sameList) || sortOrFilterChanged);

      const isEmpty = this.visible.length === 0;
      this.empty.hidden = !isEmpty;
      this.list.el.hidden = isEmpty;
      if (isEmpty) {
        const text = source.length === 0 ? this.opts.emptyText(s) : "No tracks match your search or filters.";
        const cat = document.createElement("div");
        cat.className = "mascot mascot-empty is-sleeping";
        cat.append(catSvg());
        this.empty.replaceChildren(cat, h("p", { text }));
      }
    } else if (
      prev !== null &&
      (s.player.current !== prev.player.current ||
        s.player.playing !== prev.player.playing ||
        s.selectedId !== prev.selectedId ||
        s.likedIds !== prev.likedIds ||
        s.account !== prev.account)
    ) {
      this.list.refresh();
    }
    if (!prev || sourceChanged || queryChanged || s.player.current !== prev.player.current) this.updateJump();
  }
}

/** Standard overflow-menu items for a track. */
export function trackMenu(store: AppStore, player: Player, t: Track, play: () => void, anchor?: HTMLElement): MenuItem[] {
  const liked = store.get().likedIds.has(t.id);
  return [
    { label: "Play", action: play, disabled: !t.playable },
    { label: "Play next", action: () => player.playNext(t), disabled: !t.playable },
    { label: "Add to queue", action: () => player.enqueue(t), disabled: !t.playable },
    { label: liked ? "Unlike" : "Like", action: () => void toggleLike(store, t) },
    ...(canRepost(store.get(), t) ? [{ label: "Repost on SoundCloud…", action: () => repostOnSoundCloud(t) }] : []),
    ...(anchor && t.id.startsWith("sc:") ? [{ label: "Add to playlist…", action: () => showAddToPlaylist(store, anchor, t) }] : []),
    ...(t.downloadable ? [{ label: "Download", action: () => downloadTrack(store, t) }] : []),
    { label: "Open on SoundCloud", action: () => openOnSoundCloud(t.permalinkUrl), disabled: !t.permalinkUrl },
    { label: "Go to artist", action: () => openArtistOf(store, t), disabled: !t.artistId && !artistUrl(t) },
  ];
}
