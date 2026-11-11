// Home: a start page.
//   Continue listening banner → Jump back in → Quick picks → Mixes for you →
//   New from artists you follow → Because you played… → Artists you follow →
//   Recently liked → Your playlists
// "See all" (the row title) opens the full feed / recently played list.
import { canTry } from "../player/player";
import { api, errorMessage } from "../api";
import { formatCount, loadFeed, openArtist, openArtistOf, openPlaylist } from "../browse";
import { catSvg } from "../components/mascot";
import { playlistArt } from "../components/playlistArt";
import { toast } from "../components/toast";
import { TrackListPanel } from "../components/trackListPanel";
import { artwork } from "../components/trackRow";
import { artUrl, cssUrl } from "../lib/artwork";
import { button, h } from "../lib/dom";
import { formatDuration, placeholderGradient, plural } from "../lib/format";
import { icon } from "../lib/icons";
import type { Player } from "../player/player";
import type { AppState, AppStore } from "../state";
import type { Artist, PlaylistSummary, Track } from "../types";
import { artistAvatar } from "./searchView";

const ROW_MAX = 20;
const QUICK_PICKS = 18;
const MIX_COUNT = 6;

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

/** At most `per` tracks per artist, keeping order (variety for rows). */
export function capPerArtist<T>(items: readonly T[], artistOf: (x: T) => string, per: number, max: number): T[] {
  const counts = new Map<string, number>();
  const out: T[] = [];
  for (const x of items) {
    const a = artistOf(x).toLowerCase();
    const n = counts.get(a) ?? 0;
    if (n >= per) continue;
    counts.set(a, n + 1);
    out.push(x);
    if (out.length >= max) break;
  }
  return out;
}

/** A "mix" seeded by one of your most-liked artists. */
interface Mix {
  artist: string;
  tracks: Track[]; // their tracks in your likes (covers + seeds)
}

/** Your most-liked artists (by number of liked tracks), as mixes. */
export function topMixes(liked: readonly Track[], count: number): Mix[] {
  const by = new Map<string, Track[]>();
  for (const t of liked) {
    if (!t.playable || !t.artist || !t.id.startsWith("sc:")) continue;
    const key = t.artist;
    const list = by.get(key);
    if (list) list.push(t);
    else by.set(key, [t]);
  }
  return [...by.entries()]
    .filter(([, list]) => list.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, count)
    .map(([artist, tracks]) => ({ artist, tracks }));
}

/** Simple string hash → hue, for each mix's colour. */
function hueOf(s: string): number {
  let x = 0;
  for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return x % 360;
}

export class HomeView {
  readonly el: HTMLElement;
  private readonly overview: HTMLElement;
  private readonly hello: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly sections: HTMLElement;
  private readonly feedList: HTMLElement;
  private readonly panel: TrackListPanel;
  private readonly recentList: HTMLElement;
  private readonly recentPanel: TrackListPanel;
  /** "overview" = the start page; "feed" / "recent" = a full list. */
  private mode: "overview" | "feed" | "recent" = "overview";
  private rendered = false;

  // Banner parts (updated in place as the song plays).
  private bannerBg!: HTMLElement;
  private bannerArt!: HTMLElement;
  private bannerLabel!: HTMLElement;
  private bannerTitle!: HTMLElement;
  private bannerArtist!: HTMLElement;
  private bannerFill!: HTMLElement;
  private bannerTime!: HTMLElement;
  private bannerPlay!: HTMLButtonElement;
  private bannerTrack: Track | null = null;
  private bannerNext!: HTMLElement;

  // Per-visit picks, so rows don't reshuffle on every state change.
  private quickPicks: Track[] = [];
  private quickFrom: readonly Track[] | null = null;
  private similarSeed: Track | null = null;
  private similar: Track[] | null = null;
  private followings: Artist[] | null = null;
  private followingsFor: string | null = null;

  constructor(
    private readonly store: AppStore,
    private readonly player: Player,
  ) {
    const cat = h("div", { class: "mascot mascot-home is-playing" });
    cat.append(catSvg());
    this.hello = h("h1", { class: "home-hello" });
    this.banner = this.buildBanner();
    this.sections = h("div", { class: "home-sections" });
    this.overview = h("div", { class: "home-overview" }, [h("header", { class: "home-header" }, [cat, this.hello]), this.banner, this.sections]);

    // --- Full feed list ---
    this.panel = new TrackListPanel(store, player, {
      label: "New from artists you follow",
      source: (s) => s.feed.tracks,
      emptyText: (s) =>
        s.feed.loading || !s.feed.loaded ? "Loading your feed…" : s.feed.error ? `Couldn't load your feed: ${s.feed.error}` : "Nothing new yet.",
      filtersEnabled: false,
      onNearEnd: () => void loadFeed(store, true),
      sourceKey: () => "feed",
    });
    this.feedList = this.listPage("New from artists you follow", this.panel, [
      button({ label: "Play all", icon: "play", text: "Play", class: "glass-btn accent small", onClick: () => this.playList(this.store.get().feed.tracks, 0) }),
    ]);

    // --- Full recently played list ---
    this.recentPanel = new TrackListPanel(store, player, {
      label: "Recently played",
      source: (s) => s.recent,
      emptyText: () => "Nothing played yet.",
      filtersEnabled: false,
      sourceKey: () => "recent",
    });
    this.recentList = this.listPage("Recently played", this.recentPanel, [
      button({ label: "Clear history", text: "Clear history", class: "glass-btn small", onClick: () => store.set({ recent: [] }) }),
      button({ label: "Play all", icon: "play", text: "Play", class: "glass-btn accent small", onClick: () => this.playList(this.store.get().recent, 0) }),
    ]);

    this.el = h("section", { class: "view home-view", attrs: { role: "tabpanel", id: "panel-home", "aria-labelledby": "tab-home" } }, [
      this.overview,
      this.feedList,
      this.recentList,
    ]);
    this.setMode("overview");
  }

  private listPage(title: string, panel: TrackListPanel, actions: HTMLElement[]): HTMLElement {
    return h("div", { class: "home-feed-list" }, [
      h("div", { class: "view-header" }, [
        button({ label: "Back to Home", icon: "back", class: "glass-btn icon-only", onClick: () => this.setMode("overview") }),
        h("h2", { text: title }),
        h("div", { class: "spacer" }),
        ...actions,
      ]),
      panel.el,
    ]);
  }

  private setMode(mode: "overview" | "feed" | "recent"): void {
    this.mode = mode;
    this.overview.hidden = mode !== "overview";
    this.feedList.hidden = mode !== "feed";
    this.recentList.hidden = mode !== "recent";
    const s = this.store.get();
    if (mode === "feed") this.panel.update(s, null);
    if (mode === "recent") this.recentPanel.update(s, null);
    if (mode === "overview") {
      this.rendered = false;
      this.update(s, null);
    }
  }

  jumpToCurrent(): boolean {
    if (this.mode === "feed") return this.panel.jumpToCurrent();
    if (this.mode === "recent") return this.recentPanel.jumpToCurrent();
    return false;
  }

  private playList(list: readonly Track[], index: number): void {
    const i = list.findIndex((t, k) => k >= index && canTry(t));
    if (i >= 0) this.player.playFromList(list, i);
  }

  // --- Continue listening banner --------------------------------------------

  private buildBanner(): HTMLElement {
    this.bannerBg = h("div", { class: "hb-bg", attrs: { "aria-hidden": "true" } });
    this.bannerArt = h("div", { class: "hb-art" });
    this.bannerLabel = h("span", { class: "hb-label" });
    this.bannerTitle = h("div", { class: "hb-title" });
    this.bannerArtist = h("div", { class: "hb-artist" });
    this.bannerArtist.addEventListener("click", () => {
      if (this.bannerTrack) openArtistOf(this.store, this.bannerTrack);
    });
    this.bannerFill = h("div", { class: "hb-fill" });
    this.bannerTime = h("span", { class: "hb-time" });
    this.bannerPlay = button({
      label: "Resume",
      icon: "play",
      text: "Resume",
      class: "glass-btn accent hb-play",
      onClick: () => {
        const s = this.store.get();
        if (s.player.current) this.player.togglePlay();
        else this.playList(s.recent, 0);
      },
    });
    const open = button({
      label: "Open Now Playing",
      icon: "expand",
      class: "glass-btn icon-only",
      onClick: () => {
        if (this.store.get().player.current) this.store.set({ nowPlayingOpen: true });
      },
    });
    this.bannerNext = h("button", { class: "hb-next", attrs: { type: "button", title: "Open the queue" } });
    this.bannerNext.addEventListener("click", () => this.store.set({ queueOpen: true }));
    return h("section", { class: "home-banner" }, [
      this.bannerBg,
      this.bannerArt,
      h("div", { class: "hb-text" }, [
        this.bannerLabel,
        this.bannerTitle,
        this.bannerArtist,
        h("div", { class: "hb-progress" }, [h("div", { class: "hb-bar" }, [this.bannerFill]), this.bannerTime]),
        h("div", { class: "hb-actions" }, [this.bannerPlay, open]),
      ]),
      this.bannerNext,
    ]);
  }

  private updateBanner(s: AppState, prev: AppState | null): void {
    const p = s.player;
    const t = p.current ?? s.recent[0] ?? null;
    this.banner.hidden = t === null;
    if (!t) return;
    if (t !== this.bannerTrack) {
      this.bannerTrack = t;
      this.bannerArt.replaceChildren(artwork(t, "art-banner", "t500x500"));
      const bg = artUrl(t.artworkUrl, "t300x300");
      this.bannerBg.style.backgroundImage = bg ? cssUrl(bg) : placeholderGradient(t.id);
      this.bannerTitle.textContent = t.title;
      this.bannerArtist.textContent = t.artist;
    }
    if (!prev || s.queue !== prev.queue || p.current !== prev.player.current) {
      const next = p.current ? s.queue.slice(0, 4) : [];
      this.bannerNext.hidden = next.length === 0;
      this.bannerNext.replaceChildren(
        h("span", { class: "hb-next-label", text: "Up next" }),
        ...next.map((q) =>
          h("span", { class: "hb-next-row" }, [
            artwork(q, "art-quick"),
            h("span", { class: "quick-text" }, [h("span", { class: "quick-title", text: q.title }), h("span", { class: "quick-artist", text: q.artist })]),
          ]),
        ),
      );
    }
    if (!prev || p.playing !== prev.player.playing || p.current !== prev.player.current || p.positionMs !== prev.player.positionMs || s.recent !== prev.recent) {
      const isCurrent = p.current !== null;
      const playing = isCurrent && p.playing;
      this.bannerLabel.textContent = playing ? "Now playing" : "Continue listening";
      this.banner.classList.toggle("is-playing", playing);
      const label = playing ? "Pause" : isCurrent ? "Resume" : "Play";
      this.bannerPlay.replaceChildren(icon(playing ? "pause" : "play"), h("span", { text: label }));
      this.bannerPlay.setAttribute("aria-label", label);
      const pos = isCurrent ? p.positionMs : 0;
      const pct = t.durationMs > 0 ? Math.min(100, (pos / t.durationMs) * 100) : 0;
      this.bannerFill.style.width = `${pct}%`;
      this.bannerTime.textContent = isCurrent ? `${formatDuration(pos)} / ${formatDuration(t.durationMs)}` : formatDuration(t.durationMs);
    }
  }

  // --- Cards -----------------------------------------------------------------

  private trackCard(t: Track, list: readonly Track[], index: number, note?: string): HTMLElement {
    const playBtn = h("button", { class: "card-play", attrs: { type: "button", "aria-label": `Play ${t.title}`, title: "Play" } }, [icon("play")]);
    playBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.playList(list, index);
    });
    const art = h("div", { class: "card-art" }, [artwork(t, "art-card", "t300x300"), playBtn]);
    const sub = h("span", { class: `card-sub${note ? "" : " is-link"}`, text: note ?? t.artist });
    if (!note) {
      sub.addEventListener("click", (e) => {
        e.stopPropagation();
        openArtistOf(this.store, t);
      });
    }
    const card = h("div", { class: `home-card${t.playable ? "" : " is-unavailable"}`, attrs: { role: "listitem", title: `${t.title} · ${t.artist}`, "data-id": t.id } }, [
      art,
      h("span", { class: "card-title", text: t.title }),
      sub,
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

  private artistCard(a: Artist): HTMLElement {
    const card = h("button", { class: "home-card artist-circle", attrs: { type: "button", role: "listitem", title: a.username } }, [
      h("div", { class: "card-art" }, [artistAvatar(a, "art-circle")]),
      h("span", { class: "card-title", text: a.username }),
      h("span", { class: "card-sub", text: `${formatCount(a.followers)} followers` }),
    ]);
    card.addEventListener("click", () => openArtist(this.store, { id: a.id, profileUrl: a.permalinkUrl, name: a.username }));
    return card;
  }

  private mixCard(m: Mix): HTMLElement {
    const hue = hueOf(m.artist);
    const covers = m.tracks.filter((t) => artUrl(t.artworkUrl, "large")).slice(0, 4);
    const collage = h("div", { class: `mix-collage n${Math.min(covers.length, 4) >= 4 ? 4 : 1}` });
    for (const t of covers.length >= 4 ? covers : covers.slice(0, 1)) collage.append(artwork(t, "art-mix", "t300x300"));
    const art = h("div", { class: "mix-art" }, [
      collage,
      h("div", { class: "mix-tint" }),
      h("span", { class: "mix-pill", text: "MIX" }),
      h("span", { class: "mix-name", text: m.artist }),
    ]);
    art.style.setProperty("--mix-hue", String(hue));
    const playBtn = h("button", { class: "card-play", attrs: { type: "button", "aria-label": `Play ${m.artist} Mix`, title: "Play" } }, [icon("play")]);
    playBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.startMix(m);
    });
    const card = h("div", { class: "home-card mix-card", attrs: { role: "listitem", title: `${m.artist} Mix` } }, [
      h("div", { class: "card-art" }, [art, playBtn]),
      h("span", { class: "card-title", text: `${m.artist} Mix` }),
      h("span", { class: "card-sub", text: "Station · similar tracks" }),
    ]);
    card.addEventListener("click", () => void this.startMix(m));
    return card;
  }

  /** A mix = one of their tracks you liked, then similar tracks (autoplay
   * keeps it going after that). */
  private async startMix(m: Mix): Promise<void> {
    const seed = shuffled(m.tracks, 1)[0];
    if (!seed) return;
    toast(`Starting ${m.artist} Mix…`);
    try {
      const related = (await api.relatedTracks(seed.id)).filter((t) => t.playable);
      const others = shuffled(m.tracks.filter((t) => t.id !== seed.id), 3);
      // Mix their liked tracks in among the similar ones.
      const list = [seed, ...related];
      others.forEach((t, k) => list.splice(Math.min(list.length, 3 + k * 4), 0, t));
      this.player.playFromList(list, 0);
    } catch (e) {
      toast(`Couldn't start the mix: ${errorMessage(e)}`, "error");
    }
  }

  private quickTile(t: Track, list: readonly Track[], index: number): HTMLElement {
    const tile = h("button", { class: `quick-tile${t.playable ? "" : " is-unavailable"}`, attrs: { type: "button", role: "listitem", title: `${t.title} · ${t.artist}`, "data-id": t.id } }, [
      artwork(t, "art-quick"),
      h("span", { class: "quick-text" }, [h("span", { class: "quick-title", text: t.title }), h("span", { class: "quick-artist", text: t.artist })]),
      h("span", { class: "quick-play", attrs: { "aria-hidden": "true" } }, [icon("play")]),
    ]);
    tile.addEventListener("click", () => this.playList(list, index));
    return tile;
  }

  private shimmer(n: number, round = false): HTMLElement[] {
    return Array.from({ length: n }, () =>
      h("div", { class: `home-card is-skeleton${round ? " artist-circle" : ""}`, attrs: { "aria-hidden": "true" } }, [
        h("div", { class: "card-art" }, [h("div", { class: "skeleton-art" })]),
        h("span", { class: "skeleton-line" }),
        h("span", { class: "skeleton-line short" }),
      ]),
    );
  }

  private section(title: string, body: HTMLElement[], opts: { subtitle?: string; seeAll?: () => void; layout?: "row" | "quick" } = {}): HTMLElement {
    const row = h("div", { class: opts.layout === "quick" ? "home-row quick-grid" : "home-row", attrs: { role: "list" } }, body);
    const scrollBy = (dir: number): void => row.scrollBy({ left: dir * row.clientWidth * 0.85, behavior: "smooth" });
    const heading = opts.seeAll
      ? h("button", { class: "home-section-title is-link", attrs: { type: "button", title: "See all" } }, [h("span", { text: title }), icon("chevron")])
      : h("h2", { class: "home-section-title", text: title });
    if (opts.seeAll) heading.addEventListener("click", opts.seeAll);
    const head = h("div", { class: "home-section-head" }, [
      h("div", { class: "home-section-titles" }, [heading, ...(opts.subtitle ? [h("span", { class: "home-section-sub", text: opts.subtitle })] : [])]),
      h("div", { class: "spacer" }),
      h("div", { class: "row-arrows" }, [
        button({ label: "Scroll left", icon: "back", class: "row-arrow", onClick: () => scrollBy(-1) }),
        button({ label: "Scroll right", icon: "back", class: "row-arrow is-right", onClick: () => scrollBy(1) }),
      ]),
    ]);
    return h("section", { class: "home-section", attrs: { "data-key": title } }, [head, row]);
  }

  private placeholder(text: string): HTMLElement {
    return h("p", { class: "home-placeholder", text });
  }

  // --- Render ------------------------------------------------------------------

  private render(s: AppState): void {
    const name = s.account?.username;
    this.hello.textContent = name ? `${greeting()}, ${name}` : greeting();
    const out: HTMLElement[] = [];

    // Jump back in (skip the song already in the banner)
    const recent = s.recent.slice(0, ROW_MAX);
    if (recent.length > 1) {
      out.push(this.section("Jump back in", recent.map((t, i) => this.trackCard(t, recent, i)), { seeAll: () => this.setMode("recent") }));
    }

    // Quick picks: a compact grid of random likes
    if (this.quickPicks.length) {
      const list = this.quickPicks;
      out.push(this.section("Quick picks", list.map((t, i) => this.quickTile(t, list, i)), { layout: "quick", subtitle: "From your likes" }));
    }

    // Mixes for you
    const mixes = topMixes(s.allLiked, MIX_COUNT);
    if (mixes.length) {
      out.push(this.section("Mixes for you", mixes.map((m) => this.mixCard(m)), { subtitle: "Stations from your most-liked artists" }));
    }

    // New from artists you follow (at most two per artist here)
    if (s.account) {
      const items = capPerArtist(s.feed.items, (it) => it.track.artist, 2, ROW_MAX);
      const tracks = items.map((x) => x.track);
      const body = items.length
        ? items.map((it, i) => this.trackCard(it.track, tracks, i, it.repostedBy ? `↻ ${it.repostedBy}` : undefined))
        : s.feed.loading || !s.feed.loaded
          ? this.shimmer(8)
          : [this.placeholder(s.feed.error ? `Couldn't load: ${s.feed.error}` : "Nothing new yet. Follow some artists!")];
      out.push(this.section("New from artists you follow", body, { seeAll: items.length ? () => this.setMode("feed") : undefined }));
    }

    // Because you played …
    if (this.similarSeed) {
      const list = (this.similar ?? []).slice(0, ROW_MAX);
      const body = this.similar === null ? this.shimmer(8) : list.map((t, i) => this.trackCard(t, list, i));
      if (body.length) out.push(this.section(`Because you played ${this.similarSeed.title}`, body, { subtitle: this.similarSeed.artist }));
    }

    // Artists you follow (round)
    if (s.account || this.followings?.length) {
      const body = this.followings === null ? this.shimmer(8, true) : this.followings.map((a) => this.artistCard(a));
      if (body.length) out.push(this.section("Artists you follow", body));
    }

    // Recently liked
    const newest = s.allLiked.slice(0, ROW_MAX);
    if (newest.length) out.push(this.section("Recently liked", newest.map((t, i) => this.trackCard(t, newest, i))));

    // Your playlists
    if (s.playlists.length) out.push(this.section("Your playlists", s.playlists.slice(0, ROW_MAX).map((p) => this.playlistCard(p))));

    if (out.length === 0 && this.banner.hidden) {
      out.push(this.placeholder(s.loading ? "Loading your library…" : "Play something and it'll show up here."));
    }

    // Keep each row's sideways scroll position across re-renders.
    const scrolled = new Map<string, number>();
    for (const sec of this.sections.querySelectorAll<HTMLElement>(".home-section")) {
      const row = sec.querySelector<HTMLElement>(".home-row");
      if (row && sec.dataset.key) scrolled.set(sec.dataset.key, row.scrollLeft);
    }
    this.sections.classList.toggle("no-anim", scrolled.size > 0);
    this.sections.replaceChildren(...out);
    for (const sec of this.sections.querySelectorAll<HTMLElement>(".home-section")) {
      const left = scrolled.get(sec.dataset.key ?? "");
      const row = sec.querySelector<HTMLElement>(".home-row");
      if (row && left) row.scrollLeft = left;
    }
  }

  update(s: AppState, prev: AppState | null): void {
    const visible = s.tab === "home" && s.page === "library";
    if (visible && s.account && !s.feed.loaded && !s.feed.loading) queueMicrotask(() => void loadFeed(this.store));

    // Artists you follow (SoundCloud + Sound2K): once per account, and
    // again after you follow / unfollow someone.
    const me = `${s.account?.id ?? 0}:${s.followsVersion}`;
    if (visible && this.followingsFor !== me) {
      this.followingsFor = me;
      this.followings = null;
      api
        .getFollowings()
        .then((list) => {
          if (this.followingsFor !== me) return;
          this.followings = list;
          this.rendered = false;
          this.update(this.store.get(), null);
        })
        .catch(() => {
          this.followings = [];
          this.rendered = false;
          this.update(this.store.get(), null);
        });
    }

    // Quick picks: a fresh random handful whenever the library reloads.
    // (Reshuffle when the library reloads, not on every like.)
    if (s.liked !== this.quickFrom) {
      this.quickFrom = s.liked;
      this.quickPicks = shuffled(
        s.allLiked.filter((t) => t.playable),
        QUICK_PICKS,
      );
    }

    // "Because you played": similar to the most recent SoundCloud track.
    const seed = s.recent.find((t) => t.id.startsWith("sc:")) ?? null;
    if (seed && seed.id !== this.similarSeed?.id) {
      this.similarSeed = seed;
      this.similar = null;
      api
        .relatedTracks(seed.id)
        .then((list) => {
          if (this.similarSeed?.id !== seed.id) return;
          this.similar = list.filter((t) => t.playable);
          this.rendered = false;
          this.update(this.store.get(), null);
        })
        .catch(() => {
          if (this.similarSeed?.id === seed.id) this.similar = [];
        });
    }

    const inputsChanged =
      !prev || s.recent !== prev.recent || s.feed !== prev.feed || s.playlists !== prev.playlists || s.account !== prev.account || s.allLiked !== prev.allLiked || s.loading !== prev.loading;
    if (inputsChanged) this.rendered = false;
    if (visible && this.mode === "overview") {
      this.updateBanner(s, prev);
      if (!this.rendered) {
        this.rendered = true;
        this.render(s);
        this.markPlaying(s, null);
      } else {
        this.markPlaying(s, prev);
      }
    }
    if (this.mode === "feed") this.panel.update(s, prev);
    if (this.mode === "recent") this.recentPanel.update(s, prev);
  }

  /** Highlight the playing song's card / tile (class toggles only). */
  private markPlaying(s: AppState, prev: AppState | null): void {
    if (prev && s.player.current === prev.player.current && s.player.playing === prev.player.playing) return;
    const id = s.player.current?.id;
    for (const el of this.sections.querySelectorAll<HTMLElement>("[data-id]")) {
      el.classList.toggle("is-current", el.dataset.id === id);
    }
  }
}
