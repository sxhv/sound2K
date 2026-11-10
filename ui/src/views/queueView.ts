import { showMenu } from "../components/popover";
import { toggleLike } from "../library";
import { toggleRepost } from "../browse";
import { ROW_HEIGHT, artwork, buildTrackRow, decorateRow, rowState, type RowHandlers } from "../components/trackRow";
import { VirtualList } from "../components/virtualList";
import { button, h } from "../lib/dom";
import { formatDuration, plural } from "../lib/format";
import type { Player } from "../player/player";
import type { AppState, AppStore } from "../state";
import type { Track } from "../types";

export class QueueView {
  readonly el: HTMLElement;
  private readonly list: VirtualList<Track>;
  private readonly empty: HTMLElement;
  private readonly count: HTMLElement;
  private readonly clearBtn: HTMLButtonElement;
  private readonly nowPlaying: HTMLElement;

  /** `embedded`: shown inside the queue slide-out rather than as a tab. */
  constructor(store: AppStore, player: Player, embedded = false) {
    const handlers: RowHandlers = {
      select: (t) => store.set({ selectedId: t.id }),
      play: (_t, i) => player.playQueued(i),
      menu: (_t, anchor, i) =>
        showMenu(anchor, [
          { label: "Play now", action: () => player.playQueued(i) },
          { label: "Move to top", action: () => player.moveInQueue(i, -i), disabled: i === 0 },
          { label: "Move to bottom", action: () => player.moveInQueue(i, store.get().queue.length - 1 - i), disabled: i === store.get().queue.length - 1 },
          { label: "Remove from queue", action: () => player.removeFromQueue(i) },
        ]),
      toggleLike: (t) => void toggleLike(store, t),
      toggleRepost: (t) => void toggleRepost(store, t),
    };

    const controls = (i: number): HTMLElement => {
      const stop = (e: Event): void => e.stopPropagation();
      const up = button({ label: "Move up", icon: "up", onClick: (e) => { stop(e); player.moveInQueue(i, -1); } });
      const down = button({ label: "Move down", icon: "down", onClick: (e) => { stop(e); player.moveInQueue(i, 1); } });
      const remove = button({ label: "Remove from queue", icon: "close", onClick: (e) => { stop(e); player.removeFromQueue(i); } });
      const queueLength = store.get().queue.length;
      up.disabled = i === 0;
      down.disabled = i === queueLength - 1;
      const box = h("div", { class: "queue-controls" }, [up, down, remove]);
      box.addEventListener("dblclick", stop);
      return box;
    };

    this.list = new VirtualList<Track>(
      ROW_HEIGHT,
      (t, i) => buildTrackRow(t, i, handlers, [controls(i)]),
      (el, t) => decorateRow(el, t, rowState(store.get())),
      "Up next",
    );
    this.empty = h("div", { class: "empty-state", text: "The queue is empty. Use “Add to queue” on any track, or press Play on a list." });
    this.count = h("span", { class: "view-count" });
    this.clearBtn = button({ label: "Clear queue", text: "Clear queue", class: "glass-btn small", onClick: () => player.clearQueue() });
    this.nowPlaying = h("div", { class: "now-playing" });

    const attrs: Record<string, string> = embedded
      ? { "aria-label": "Queue" }
      : { role: "tabpanel", id: "panel-queue", "aria-labelledby": "tab-queue" };
    this.el = h("section", { class: embedded ? "view queue-embedded" : "view", attrs }, [
      this.nowPlaying,
      h("div", { class: "view-header" }, [h("h2", { text: "Up next" }), this.count, h("div", { class: "spacer" }), this.clearBtn]),
      h("div", { class: "track-panel" }, [this.list.el, this.empty]),
    ]);
  }

  update(s: AppState, prev: AppState | null): void {
    if (!prev || s.queue !== prev.queue) {
      this.list.setItems(s.queue, false);
      const empty = s.queue.length === 0;
      this.empty.hidden = !empty;
      this.list.el.hidden = empty;
      this.clearBtn.disabled = empty;
      this.count.textContent = empty ? "" : plural(s.queue.length, "track");
    } else if (
      s.player.current !== prev.player.current ||
      s.player.playing !== prev.player.playing ||
      s.selectedId !== prev.selectedId ||
      s.likedIds !== prev.likedIds ||
      s.repostedIds !== prev.repostedIds
    ) {
      this.list.refresh();
    }

    if (!prev || s.player.current !== prev.player.current) {
      const t = s.player.current;
      this.nowPlaying.hidden = t === null;
      if (t) {
        this.nowPlaying.replaceChildren(
          h("span", { class: "now-label", text: "Now playing" }),
          h("div", { class: "now-row" }, [
            artwork(t, "art-row"),
            h("div", { class: "track-meta" }, [h("span", { class: "track-title", text: t.title }), h("span", { class: "track-artist", text: t.artist })]),
            h("span", { class: "track-duration", text: formatDuration(t.durationMs) }),
          ]),
        );
      }
    }
    if (!prev || s.player.playing !== prev.player.playing || s.player.current !== prev.player.current) {
      this.nowPlaying.classList.toggle("is-playing", s.player.playing);
    }
  }
}
