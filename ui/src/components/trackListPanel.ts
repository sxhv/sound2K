// A searchable / filterable / sortable track list used by Liked Songs,
// playlist detail and Recently Played.
import { button, h } from "../lib/dom";
import { applyQuery } from "../lib/filterSort";
import type { Player } from "../player/player";
import { DEFAULT_FILTERS, type AppState, type AppStore } from "../state";
import type { Track } from "../types";
import { artistUrl, downloadTrack, openOnSoundCloud, toggleLike } from "../library";
import { showMenu, type MenuItem } from "./popover";
import { ROW_HEIGHT, buildTrackRow, decorateRow, rowState, type RowHandlers } from "./trackRow";
import { VirtualList } from "./virtualList";
import { catSvg } from "./mascot";
import { showAddToPlaylist } from "../playlistEdit";
import { openArtistOf } from "../browse";

const EMPTY: readonly Track[] = [];

export interface PanelOptions {
  label: string;
  source(s: AppState): readonly Track[] | null;
  emptyText(s: AppState): string;
  /** Sort + filter controls apply (search always applies). */
  filtersEnabled: boolean;
  /** Called when scrolled near the end (load the next page). */
  onNearEnd?(): void;
  /** Extra ⋯ menu items (e.g. "Remove from this playlist"). */
  extraMenu?(t: Track): MenuItem[];
}

export class TrackListPanel {
  readonly el: HTMLElement;
  private readonly list: VirtualList<Track>;
  private readonly empty: HTMLElement;
  private visible: Track[] = [];
  private lastSource: readonly Track[] | null = null;
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
      (t, i) => buildTrackRow(t, i, handlers),
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
          : { search: s.search, sort: "recently-liked", filters: DEFAULT_FILTERS },
      );
      const sortOrFilterChanged = prev !== null && (s.sort !== prev.sort || s.filters !== prev.filters);
      this.list.setItems(this.visible, sourceChanged || sortOrFilterChanged);

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
        s.likedIds !== prev.likedIds)
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
    ...(anchor && t.id.startsWith("sc:") ? [{ label: "Add to playlist…", action: () => showAddToPlaylist(store, anchor, t) }] : []),
    ...(t.downloadable ? [{ label: "Download", action: () => downloadTrack(store, t) }] : []),
    { label: "Open on SoundCloud", action: () => openOnSoundCloud(t.permalinkUrl), disabled: !t.permalinkUrl },
    { label: "Go to artist", action: () => openArtistOf(store, t), disabled: !t.artistId && !artistUrl(t) },
  ];
}
