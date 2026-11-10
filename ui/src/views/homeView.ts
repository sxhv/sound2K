// Home: new uploads and reposts from artists you follow.
import { loadFeed } from "../browse";
import { TrackListPanel } from "../components/trackListPanel";
import { button, h } from "../lib/dom";
import type { Player } from "../player/player";
import type { AppState, AppStore } from "../state";

export class HomeView {
  readonly el: HTMLElement;
  private readonly panel: TrackListPanel;
  private readonly status: HTMLElement;
  private readonly refresh: HTMLButtonElement;

  constructor(
    private readonly store: AppStore,
    player: Player,
  ) {
    this.panel = new TrackListPanel(store, player, {
      label: "Home feed",
      source: (s) => s.feed.tracks,
      emptyText: (s) =>
        !s.account
          ? "Sign in to see new tracks from artists you follow."
          : s.feed.loading || !s.feed.loaded
            ? "Loading your feed…"
            : s.feed.error
              ? `Couldn't load your feed: ${s.feed.error}`
              : "Nothing new yet. Follow some artists!",
      filtersEnabled: false,
      onNearEnd: () => void loadFeed(store, true),
      sourceKey: () => "feed",
    });
    const play = button({
      label: "Play feed",
      icon: "play",
      text: "Play",
      class: "glass-btn accent small",
      onClick: () => {
        const list = this.panel.visibleTracks;
        const i = list.findIndex((t) => t.playable);
        if (i >= 0) player.playFromList(list, i);
      },
    });
    this.refresh = button({ label: "Refresh", icon: "repeat", class: "glass-btn icon-only small", onClick: () => void loadFeed(store) });
    this.status = h("span", { class: "view-count" });
    this.el = h("section", { class: "view", attrs: { role: "tabpanel", id: "panel-home", "aria-labelledby": "tab-home" } }, [
      h("div", { class: "view-header" }, [h("h2", { text: "Home" }), this.status, h("div", { class: "spacer" }), this.refresh, play]),
      this.panel.el,
    ]);
  }

  jumpToCurrent(): boolean {
    return this.panel.jumpToCurrent();
  }

  update(s: AppState, prev: AppState | null): void {
    // Load the feed the first time the tab is opened (and after signing in).
    if (s.tab === "home" && s.page === "library" && s.account && !s.feed.loaded && !s.feed.loading) {
      queueMicrotask(() => void loadFeed(this.store));
    }
    if (!prev || s.feed !== prev.feed) {
      this.status.textContent = s.feed.loading ? "Loading…" : s.feed.tracks.length ? `${s.feed.tracks.length} tracks` : "";
      this.refresh.disabled = s.feed.loading || !s.account;
    }
    this.panel.update(s, prev);
  }
}
