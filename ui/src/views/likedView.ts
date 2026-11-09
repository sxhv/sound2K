import { TrackListPanel } from "../components/trackListPanel";
import { button, h } from "../lib/dom";
import { plural } from "../lib/format";
import type { Player } from "../player/player";
import type { AppState, AppStore } from "../state";

export class LikedView {
  readonly el: HTMLElement;
  private readonly panel: TrackListPanel;
  private readonly count: HTMLElement;

  constructor(store: AppStore, player: Player) {
    this.panel = new TrackListPanel(store, player, {
      label: "Liked songs",
      source: (s) => s.liked,
      emptyText: (s) => (s.loading ? "Loading your liked tracks…" : s.error ?? "No liked tracks yet."),
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
        const i = list.findIndex((t) => t.playable);
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
    this.el = h("section", { class: "view", attrs: { role: "tabpanel", id: "panel-liked", "aria-labelledby": "tab-liked" } }, [
      h("div", { class: "view-header" }, [h("h2", { text: "Liked Songs" }), this.count, h("div", { class: "spacer" }), playAll, shuffleAll]),
      this.panel.el,
    ]);
  }

  jumpToCurrent(): boolean {
    return this.panel.jumpToCurrent();
  }

  update(s: AppState, prev: AppState | null): void {
    this.panel.update(s, prev);
    const total = s.liked.length;
    const shown = this.panel.visibleTracks.length;
    this.count.textContent =
      s.loading ? "" : shown === total ? plural(total, "track") : `${shown.toLocaleString()} of ${plural(total, "track")}`;
  }
}
