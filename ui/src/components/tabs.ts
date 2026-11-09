import { h } from "../lib/dom";
import type { AppState, AppStore } from "../state";
import type { TabId } from "../types";

const TABS: readonly { id: TabId; label: string }[] = [
  { id: "liked", label: "Liked Songs" },
  { id: "playlists", label: "Playlists" },
  { id: "queue", label: "Queue" },
  { id: "recent", label: "Recently Played" },
];

export class Tabs {
  readonly el: HTMLElement;
  private readonly buttons = new Map<TabId, HTMLButtonElement>();
  private readonly queueBadge: HTMLElement;

  constructor(private readonly store: AppStore) {
    this.el = h("nav", { class: "tabs", attrs: { role: "tablist", "aria-label": "Library" } });
    this.queueBadge = h("span", { class: "tab-badge" });
    for (const tab of TABS) {
      const btn = h("button", {
        class: "tab",
        attrs: { type: "button", role: "tab", id: `tab-${tab.id}`, "aria-controls": `panel-${tab.id}` },
      }, [h("span", { text: tab.label })]);
      if (tab.id === "queue") btn.append(this.queueBadge);
      btn.addEventListener("click", () => this.select(tab.id));
      btn.addEventListener("keydown", (e) => this.onKey(e, tab.id));
      this.buttons.set(tab.id, btn);
      this.el.append(btn);
    }
  }

  private select(id: TabId): void {
    const s = this.store.get();
    if (s.page !== "library") {
      this.store.set({ page: "library", tab: id, search: "", selectedId: null });
    } else if (id === "playlists" && s.tab === "playlists" && s.openPlaylist) {
      // Clicking the active Playlists tab returns to the overview.
      this.store.set({ openPlaylist: null, search: "" });
    } else if (id !== s.tab) {
      this.store.set({ tab: id, search: "", selectedId: null });
    }
  }

  private onKey(e: KeyboardEvent, id: TabId): void {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === id);
    const nextIndex = (i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    const next = TABS[nextIndex];
    if (!next) return;
    this.select(next.id);
    this.buttons.get(next.id)?.focus();
  }

  update(s: AppState, prev: AppState | null): void {
    if (!prev || s.tab !== prev.tab || s.page !== prev.page) {
      for (const [id, btn] of this.buttons) {
        const active = id === s.tab && s.page === "library";
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-selected", String(active));
        btn.tabIndex = active ? 0 : -1;
      }
    }
    if (!prev || s.queue.length !== prev.queue.length) {
      this.queueBadge.textContent = s.queue.length > 999 ? "999+" : String(s.queue.length);
      this.queueBadge.hidden = s.queue.length === 0;
    }
  }
}
