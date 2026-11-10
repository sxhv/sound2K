// Home: a start page with rows of big cover cards (Jump back in, new from
// artists you follow, similar to what you played, your playlists,
// rediscover your likes). "See all" on the feed row opens the full list.
import { api } from "../api";
import { loadFeed, openArtistOf, openPlaylist } from "../browse";
import { catSvg } from "../components/mascot";
import { playlistArt } from "../components/playlistArt";
import { TrackListPanel } from "../components/trackListPanel";
import { artwork } from "../components/trackRow";
import { button, h } from "../lib/dom";
import { plural } from "../lib/format";
import { icon } from "../lib/icons";
import type { Player } from "../player/player";
import type { AppState, AppStore } from "../state";
import type { PlaylistSummary, Track } from "../types";

const ROW_MAX = 16;

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function shuffled<T>(list: readonly T[], n: number): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy.slice(0, n);
}

export class HomeView {
  readonly el: HTMLElement;
  private readonly overview: HTMLElement;
  private readonly feedList: HTMLElement;
  private readonly panel: TrackListPanel;
  private readonly hello: HTMLElement;
  private readonly sections: HTMLElement;
  private showingFeed = false;

  // Per-visit picks, so rows don't reshuffle on every state change.
  private rediscover: Track[] = [];
  private rediscoverFrom: readonly Track[] | null = null;
  private similarSeed: Track | null = null;
  private similar: Track[] = [];
  private rendered = false;

  constructor(
    private readonly store: AppStore,
    private readonly player: Player,
  ) {
    // --- Overview ---
    const cat = h("div", { class: "mascot mascot-home is-playing" });
    cat.append(catSvg());
    this.hello = h("h1", { class: "home-hello" });
    this.sections = h("div", { class: "home-sections" });
    this.overview = h("div", { class: "home-overview" }, [h("header", { class: "home-header" }, [cat, this.hello]), this.sections]);

    // --- Full feed list ("See all") ---
    this.panel = new TrackListPanel(store, player, {
      label: "New from artists you follow",
      source: (s) => s.feed.tracks,
      emptyText: (s) =>
        s.feed.loading || !s.feed.loaded ? "Loading your feed…" : s.feed.error ? `Couldn't load your feed: ${s.feed.error}` : "Nothing new yet.",
      filtersEnabled: false,
      onNearEnd: () => void loadFeed(store, true),
      sourceKey: () => "feed",
    });
    const back = button({
      label: "Back to Home",
      icon: "back",
      class: "glass-btn icon-only",
      onClick: () => {
        this.showingFeed = false;
        this.syncMode();
      },
    });
    const play = button({
      label: "Play all",
      icon: "play",
      text: "Play",
      class: "glass-btn accent small",
      onClick: () => this.playList(this.store.get().feed.tracks, 0),
    });
    this.feedList = h("div", { class: "home-feed-list" }, [
      h("div", { class: "view-header" }, [back, h("h2", { text: "New from artists you follow" }), h("div", { class: "spacer" }), play]),
      this.panel.el,
    ]);

    this.el = h("section", { class: "view home-view", attrs: { role: "tabpanel", id: "panel-home", "aria-labelledby": "tab-home" } }, [
      this.overview,
      this.feedList,
    ]);
    this.syncMode();
  }

  private syncMode(): void {
    this.overview.hidden = this.showingFeed;
    this.feedList.hidden = !this.showingFeed;
    if (this.showingFeed) this.panel.update(this.store.get(), null);
  }

  jumpToCurrent(): boolean {
    return this.showingFeed && this.panel.jumpToCurrent();
  }

  private playList(list: readonly Track[], index: number): void {
    const i = list.findIndex((t, k) => k >= index && t.playable);
    if (i >= 0) this.player.playFromList(list, i);
  }

  // --- Cards ----------------------------------------------------------------

  private trackCard(t: Track, list: readonly Track[], index: number, note?: string): HTMLElement {
    const playBtn = h("button", { class: "card-play", attrs: { type: "button", "aria-label": `Play ${t.title}`, title: "Play" } }, [icon("play")]);
    playBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.playList(list, index);
    });
    const art = h("div", { class: "card-art" }, [artwork(t, "art-card", "t300x300"), playBtn]);
    const artist = h("span", { class: "card-sub is-link", text: note ?? t.artist });
    if (!note) {
      artist.addEventListener("click", (e) => {
        e.stopPropagation();
        openArtistOf(this.store, t);
      });
    }
    const card = h("div", { class: `home-card${t.playable ? "" : " is-unavailable"}`, attrs: { role: "listitem", title: `${t.title} · ${t.artist}`, "data-id": t.id } }, [
      art,
      h("span", { class: "card-title", text: t.title }),
      artist,
    ]);
    card.addEventListener("dblclick", () => this.playList(list, index));
    return card;
  }

  private playlistCard(p: PlaylistSummary): HTMLElement {
    const card = h("button", { class: "home-card", attrs: { type: "button", role: "listitem", title: p.title } }, [
      h("div", { class: "card-art" }, [playlistArt(p)]),
      h("span", { class: "card-title", text: p.title }),
      h("span", { class: "card-sub", text: plural(p.trackCount, "track") }),
    ]);
    card.addEventListener("click", () => openPlaylist(this.store, p));
    return card;
  }

  private section(title: string, cards: HTMLElement[], opts: { subtitle?: string; seeAll?: () => void; play?: () => void } = {}): HTMLElement {
    const row = h("div", { class: "home-row", attrs: { role: "list" } }, cards);
    const scrollBy = (dir: number): void => row.scrollBy({ left: dir * row.clientWidth * 0.85, behavior: "smooth" });
    const head = h("div", { class: "home-section-head" }, [
      h("div", { class: "home-section-titles" }, [
        h("h2", { text: title }),
        ...(opts.subtitle ? [h("span", { class: "home-section-sub", text: opts.subtitle })] : []),
      ]),
      h("div", { class: "spacer" }),
      ...(opts.play ? [button({ label: "Play all", icon: "play", class: "glass-btn icon-only small", onClick: opts.play })] : []),
      ...(opts.seeAll ? [button({ label: "See all", text: "See all", class: "link-btn", onClick: opts.seeAll })] : []),
      button({ label: "Scroll left", icon: "back", class: "glass-btn icon-only small row-arrow", onClick: () => scrollBy(-1) }),
      button({ label: "Scroll right", icon: "back", class: "glass-btn icon-only small row-arrow is-right", onClick: () => scrollBy(1) }),
    ]);
    return h("section", { class: "home-section", attrs: { "data-key": title } }, [head, row]);
  }

  private placeholder(text: string): HTMLElement {
    return h("p", { class: "home-placeholder", text });
  }

  // --- Render -----------------------------------------------------------------

  private render(s: AppState): void {
    const name = s.account?.username;
    this.hello.textContent = name ? `${greeting()}, ${name}` : greeting();
    const out: HTMLElement[] = [];

    // Jump back in
    const recent = s.recent.slice(0, ROW_MAX);
    if (recent.length) {
      out.push(this.section("Jump back in", recent.map((t, i) => this.trackCard(t, recent, i)), { play: () => this.playList(recent, 0) }));
    }

    // New from artists you follow
    if (s.account) {
      const items = s.feed.items.slice(0, ROW_MAX);
      const cards = items.map((it, i) =>
        this.trackCard(it.track, items.map((x) => x.track), i, it.repostedBy ? `↻ ${it.repostedBy}` : undefined),
      );
      out.push(
        this.section("New from artists you follow", cards.length ? cards : [this.placeholder(s.feed.loading || !s.feed.loaded ? "Loading…" : s.feed.error ? `Couldn't load: ${s.feed.error}` : "Nothing new yet. Follow some artists!")], {
          seeAll: cards.length
            ? () => {
                this.showingFeed = true;
                this.syncMode();
              }
            : undefined,
          play: cards.length ? () => this.playList(s.feed.tracks, 0) : undefined,
        }),
      );
    }

    // Because you played …
    if (this.similarSeed && this.similar.length) {
      const list = this.similar.slice(0, ROW_MAX);
      out.push(
        this.section(`Because you played ${this.similarSeed.title}`, list.map((t, i) => this.trackCard(t, list, i)), {
          subtitle: this.similarSeed.artist,
          play: () => this.playList(list, 0),
        }),
      );
    }

    // Your playlists
    if (s.playlists.length) {
      out.push(this.section("Your playlists", s.playlists.slice(0, ROW_MAX).map((p) => this.playlistCard(p))));
    }

    // Rediscover your likes
    if (this.rediscover.length) {
      const list = this.rediscover;
      out.push(
        this.section("Rediscover your likes", list.map((t, i) => this.trackCard(t, list, i)), {
          play: () => this.playList(list, 0),
        }),
      );
    }

    if (out.length === 0) {
      out.push(this.placeholder(s.loading ? "Loading your library…" : "Play something and it'll show up here."));
    }
    // Keep each row's sideways scroll position across re-renders.
    const scrolled = new Map<string, number>();
    for (const sec of this.sections.querySelectorAll<HTMLElement>(".home-section")) {
      const row = sec.querySelector<HTMLElement>(".home-row");
      if (row && sec.dataset.key) scrolled.set(sec.dataset.key, row.scrollLeft);
    }
    const restoring = scrolled.size > 0;
    this.sections.classList.toggle("no-anim", restoring);
    this.sections.replaceChildren(...out);
    for (const sec of this.sections.querySelectorAll<HTMLElement>(".home-section")) {
      const left = scrolled.get(sec.dataset.key ?? "");
      const row = sec.querySelector<HTMLElement>(".home-row");
      if (row && left) row.scrollLeft = left;
    }
  }

  update(s: AppState, prev: AppState | null): void {
    const visible = s.tab === "home" && s.page === "library";
    // Load the feed the first time Home is opened (and after signing in).
    if (visible && s.account && !s.feed.loaded && !s.feed.loading) queueMicrotask(() => void loadFeed(this.store));

    // A fresh random pick of likes when the library changes.
    if (s.liked !== this.rediscoverFrom) {
      this.rediscoverFrom = s.liked;
      this.rediscover = shuffled(
        s.liked.filter((t) => t.playable),
        ROW_MAX,
      );
    }
    // "Because you played": similar to the most recent track.
    const seed = s.recent.find((t) => t.id.startsWith("sc:")) ?? null;
    if (seed && seed.id !== this.similarSeed?.id) {
      this.similarSeed = seed;
      this.similar = [];
      api
        .relatedTracks(seed.id)
        .then((list) => {
          if (this.similarSeed?.id !== seed.id) return;
          this.similar = list.filter((t) => t.playable);
          this.rendered = false; // show the new row
          this.update(this.store.get(), null);
        })
        .catch(() => undefined);
    }

    // Re-render the overview only when its inputs change (and it's on screen).
    const inputsChanged =
      !prev || s.recent !== prev.recent || s.feed !== prev.feed || s.playlists !== prev.playlists || s.account !== prev.account || s.liked !== prev.liked || s.loading !== prev.loading;
    if (inputsChanged) this.rendered = false;
    if (visible && !this.showingFeed && !this.rendered) {
      this.rendered = true;
      this.render(s);
      this.markPlaying(s, null);
    }
    if (this.showingFeed) this.panel.update(s, prev);
    this.markPlaying(s, prev);
  }

  /** Highlight the card of the playing song (cheap: class toggles only). */
  private markPlaying(s: AppState, prev: AppState | null): void {
    if (prev && s.player.current === prev.player.current && s.player.playing === prev.player.playing) return;
    const id = s.player.current?.id;
    for (const card of this.sections.querySelectorAll<HTMLElement>(".home-card")) {
      card.classList.toggle("is-current", card.dataset.id === id);
    }
  }
}
