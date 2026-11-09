import { TrackListPanel } from "../components/trackListPanel";
import { button, h } from "../lib/dom";
import { plural } from "../lib/format";
import type { Player } from "../player/player";
import type { AppState, AppStore } from "../state";

export class RecentView {
  readonly el: HTMLElement;
  private readonly panel: TrackListPanel;
  private readonly count: HTMLElement;
  private readonly clearBtn: HTMLButtonElement;

  constructor(store: AppStore, player: Player) {
    this.panel = new TrackListPanel(store, player, {
      label: "Recently played",
      source: (s) => s.recent,
      emptyText: () => "Nothing played yet. Tracks you play will show up here.",
      filtersEnabled: false,
    });
    this.count = h("span", { class: "view-count" });
    this.clearBtn = button({ label: "Clear history", text: "Clear history", class: "glass-btn small", onClick: () => store.set({ recent: [] }) });
    this.el = h("section", { class: "view", attrs: { role: "tabpanel", id: "panel-recent", "aria-labelledby": "tab-recent" } }, [
      h("div", { class: "view-header" }, [h("h2", { text: "Recently Played" }), this.count, h("div", { class: "spacer" }), this.clearBtn]),
      this.panel.el,
    ]);
  }

  jumpToCurrent(): boolean {
    return this.panel.jumpToCurrent();
  }

  update(s: AppState, prev: AppState | null): void {
    this.panel.update(s, prev);
    if (!prev || s.recent !== prev.recent) {
      this.count.textContent = s.recent.length ? plural(s.recent.length, "track") : "";
      this.clearBtn.disabled = s.recent.length === 0;
    }
  }
}
