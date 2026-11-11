import { TrackListPanel } from "../components/trackListPanel";
import { canTry } from "../player/player";
import { button, h } from "../lib/dom";
import { plural } from "../lib/format";
import type { Player } from "../player/player";
import { likedList, type AppState, type AppStore, type LikedSource } from "../state";

export class LikedView {
  readonly el: HTMLElement;
  private readonly panel: TrackListPanel;
  private readonly count: HTMLElement;
  private readonly sources = new Map<LikedSource, HTMLButtonElement>();

  constructor(
    private readonly store: AppStore,
    player: Player,
  ) {
    this.panel = new TrackListPanel(store, player, {
      label: "Liked songs",
      source: (s) => likedList(s),
      sourceKey: (s) => s.likedSource,
      emptyText: (s) =>
        s.loading
          ? "Loading your liked tracks…"
          : s.likedSource === "sound2k"
            ? "Nothing liked in Sound2K yet. Tap the heart on any song."
            : s.likedSource === "soundcloud"
              ? s.account
                ? s.error ?? "No likes on SoundCloud yet."
                : "Sign in to see your SoundCloud likes."
              : s.error ?? "No liked tracks yet.",
      filtersEnabled: true,
    });
    this.count = h("span", { class: "view-count" });
    const playAll = button({
      label: "Play all shown",
      icon: "play",
      text: "Play",
      class: "glass-btn accent small",
      onClick: () => {
        const list = this.panel.visibleTracks;
        const i = list.findIndex((t) => canTry(t));
        if (i >= 0) player.playFromList(list, i);
      },
    });
    const shuffleAll = button({
      label: "Shuffle all shown",
      icon: "shuffle",
      text: "Shuffle",
      class: "glass-btn small",
      onClick: () => player.playShuffled(this.panel.visibleTracks),
    });
    // All · Sound2K · SoundCloud
    const switcher = h("div", { class: "segmented liked-sources", attrs: { role: "tablist", "aria-label": "Which likes" } });
    for (const [id, label, tip] of [
      ["all", "All", "Everything you've liked"],
      ["sound2k", "Sound2K", "Liked in Sound2K (saved on this PC)"],
      ["soundcloud", "SoundCloud", "Liked on SoundCloud (read-only here)"],
    ] as const) {
      const b = h("button", { class: "segment", text: label, attrs: { type: "button", role: "tab", title: tip } });
      b.addEventListener("click", () => this.store.set({ likedSource: id }));
      this.sources.set(id, b);
      switcher.append(b);
    }
    this.el = h("section", { class: "view", attrs: { role: "tabpanel", id: "panel-liked", "aria-labelledby": "tab-liked" } }, [
      h("div", { class: "view-header" }, [h("h2", { text: "Liked Songs" }), this.count, switcher, h("div", { class: "spacer" }), playAll, shuffleAll]),
      this.panel.el,
    ]);
  }

  jumpToCurrent(): boolean {
    return this.panel.jumpToCurrent();
  }

  update(s: AppState, prev: AppState | null): void {
    if (!prev || s.likedSource !== prev.likedSource || s.localLiked !== prev.localLiked || s.liked !== prev.liked) {
      const counts: Record<LikedSource, number> = { all: s.allLiked.length, sound2k: s.localLiked.length, soundcloud: s.liked.length };
      for (const [id, b] of this.sources) {
        const on = id === s.likedSource;
        b.classList.toggle("is-selected", on);
        b.setAttribute("aria-selected", String(on));
        b.dataset.count = counts[id] > 0 ? counts[id].toLocaleString() : "";
      }
    }
    this.panel.update(s, prev);
    const total = likedList(s).length;
    const shown = this.panel.visibleTracks.length;
    this.count.textContent =
      s.loading ? "" : shown === total ? plural(total, "track") : `${shown.toLocaleString()} of ${plural(total, "track")}`;
  }
}
