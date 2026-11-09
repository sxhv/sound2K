// "Up next" slide-out panel on the right (opened from the dock or the
// Now Playing view). Same contents as the Queue tab.
import { button, h } from "../lib/dom";
import type { Player } from "../player/player";
import type { AppState, AppStore } from "../state";
import { QueueView } from "../views/queueView";

export class QueueDrawer {
  readonly el: HTMLElement;
  private readonly view: QueueView;

  constructor(store: AppStore, player: Player) {
    this.view = new QueueView(store, player, true);
    const close = button({ label: "Close (Esc)", icon: "close", class: "icon-btn", onClick: () => store.set({ queueOpen: false }) });
    this.el = h("aside", { class: "queue-drawer glass-panel", attrs: { "aria-label": "Up next" } }, [
      h("div", { class: "drawer-header" }, [h("h2", { text: "Queue" }), h("div", { class: "spacer" }), close]),
      this.view.el,
    ]);
    this.el.inert = true;
  }

  update(s: AppState, prev: AppState | null): void {
    if (!prev || s.queueOpen !== prev.queueOpen) {
      this.el.classList.toggle("is-open", s.queueOpen);
      this.el.inert = !s.queueOpen;
    }
    // Skip list work while closed (it catches up when opened).
    if (s.queueOpen) this.view.update(s, prev && prev.queueOpen ? prev : null);
  }
}
