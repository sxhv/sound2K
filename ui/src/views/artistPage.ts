// Artist page: banner, avatar, follow button, and their popular tracks,
// uploads, reposts and playlists.
import { canTry } from "../player/player";
import { formatCount, loadArtistSection, openPlaylist, toggleFollow } from "../browse";
import { showMenu } from "../components/popover";
import { icon } from "../lib/icons";
import { TrackListPanel } from "../components/trackListPanel";
import { artUrl, cssUrl } from "../lib/artwork";
import { button, h } from "../lib/dom";
import { plural } from "../lib/format";
import type { Player } from "../player/player";
import { SET_SECTIONS, type ArtistSection, type ArtistSort, type AppState, type AppStore, type ArtistPageState } from "../state";
import type { PlaylistSummary, Track } from "../types";
import { openOnSoundCloud } from "../library";
import { playlistArt } from "./playlistsView";
import { artistAvatar } from "./searchView";

const SECTIONS: readonly { id: ArtistSection; label: string }[] = [
  { id: "popular", label: "Popular" },
  { id: "tracks", label: "Recent" },
  { id: "albums", label: "Albums" },
  { id: "eps", label: "EPs & Singles" },
  { id: "playlists", label: "Playlists" },
  { id: "reposts", label: "Reposts" },
];

const SORTS: readonly { id: ArtistSort; label: string }[] = [
  { id: "default", label: "Default order" },
  { id: "plays", label: "Most played" },
  { id: "title", label: "Title (A–Z)" },
  { id: "longest", label: "Longest" },
  { id: "shortest", label: "Shortest" },
];

/** While searching or sorting, load up to this many tracks so the
 * results cover more than the first page. */
const LOAD_ALL_CAP = 1000;

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function matches(text: string, q: string): boolean {
  return text.toLocaleLowerCase().includes(q);
}

function sortTracks(list: Track[], sort: ArtistSort): Track[] {
  switch (sort) {
    case "plays":
      return list.sort((a, b) => (b.plays ?? -1) - (a.plays ?? -1));
    case "title":
      return list.sort((a, b) => collator.compare(a.title, b.title));
    case "longest":
      return list.sort((a, b) => b.durationMs - a.durationMs);
    case "shortest":
      return list.sort((a, b) => a.durationMs - b.durationMs);
    default:
      return list;
  }
}

function setLabel(p: PlaylistSummary): string {
  const kind = { album: "Album", ep: "EP", single: "Single", compilation: "Compilation" }[p.setType ?? ""] ?? "";
  return [kind, plural(p.trackCount, "track")].filter(Boolean).join(" · ");
}

export class ArtistPage {
  readonly el: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly avatarSlot: HTMLElement;
  private readonly name: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly followBtn: HTMLButtonElement;
  private readonly kind = h("span", { class: "pl-kind", text: "Artist" });
  private readonly webBtn: HTMLButtonElement;
  private readonly chips = new Map<ArtistSection, HTMLButtonElement>();
  private readonly panel: TrackListPanel;
  private readonly grid: HTMLElement;
  private readonly searchInput: HTMLInputElement;
  private readonly sortBtn: HTMLButtonElement;
  /** Memo for the searched / sorted track list. */
  private shown: { from: ArtistPageState | null; list: Track[] } = { from: null, list: [] };

  constructor(
    private readonly store: AppStore,
    player: Player,
  ) {
    const back = button({ label: "Back", icon: "back", class: "glass-btn icon-only", onClick: () => store.set({ page: "library" }) });
    this.banner = h("div", { class: "artist-banner", attrs: { "aria-hidden": "true" } });
    this.avatarSlot = h("div", { class: "artist-avatar" });
    this.name = h("h1", { class: "artist-name" });
    this.meta = h("p", { class: "artist-meta" });
    this.followBtn = button({ label: "Follow", text: "Follow", class: "glass-btn accent small follow-btn", onClick: () => void toggleFollow(store) });
    const play = button({
      label: "Play",
      icon: "play",
      text: "Play",
      class: "glass-btn small",
      onClick: () => {
        const list = this.panel.visibleTracks;
        const i = list.findIndex((t) => canTry(t));
        if (i >= 0) player.playFromList(list, i);
      },
    });
    const shuffle = button({ label: "Shuffle", icon: "shuffle", class: "glass-btn icon-only small", onClick: () => player.playShuffled(this.panel.visibleTracks) });
    this.webBtn = button({
      label: "Open on SoundCloud",
      icon: "expand",
      class: "glass-btn icon-only small",
      onClick: () => openOnSoundCloud(store.get().artist?.info?.permalinkUrl ?? null),
    });

    const chipRow = h("div", { class: "chip-row artist-sections", attrs: { role: "tablist" } });
    for (const sec of SECTIONS) {
      const chip = h("button", { class: "chip", text: sec.label, attrs: { type: "button", role: "tab" } });
      chip.addEventListener("click", () => void loadArtistSection(store, sec.id));
      this.chips.set(sec.id, chip);
      chipRow.append(chip);
    }

    // Search within this artist, and sort.
    this.searchInput = h("input", {
      class: "search-input",
      attrs: { type: "search", placeholder: "Search this artist", "aria-label": "Search this artist", spellcheck: "false" },
    });
    this.searchInput.addEventListener("input", () => {
      const a = store.get().artist;
      if (a) store.set({ artist: { ...a, query: this.searchInput.value } });
    });
    this.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.searchInput.value) {
        e.stopPropagation();
        this.searchInput.value = "";
        this.searchInput.dispatchEvent(new Event("input"));
      }
    });
    this.sortBtn = h("button", { class: "glass-btn small dropdown-btn artist-sort", attrs: { type: "button", "aria-haspopup": "menu" } });
    this.sortBtn.addEventListener("click", () => {
      const a = store.get().artist;
      if (!a) return;
      showMenu(
        this.sortBtn,
        SORTS.map((o) => ({
          label: a.sort === o.id ? `✓  ${o.label}` : o.label,
          action: () => {
            const cur = store.get().artist;
            if (cur) store.set({ artist: { ...cur, sort: o.id } });
          },
        })),
      );
    });
    const tools = h("div", { class: "artist-tools" }, [h("label", { class: "search glass-field artist-search" }, [icon("search"), this.searchInput]), this.sortBtn]);

    this.panel = new TrackListPanel(store, player, {
      label: "Artist tracks",
      source: (s) => this.shownTracks(s.artist),
      emptyText: (s) =>
        s.artist?.query && s.artist.tracks.length
          ? s.artist.loading
            ? "Searching…"
            : "No tracks match your search."
          : s.artist?.loading
            ? "Loading…"
            : s.artist?.error
              ? `Couldn't load: ${s.artist.error}`
              : "Nothing here yet.",
      filtersEnabled: false,
      globalSearch: false,
      sourceKey: (s) => `${s.artist?.id ?? s.artist?.profileUrl}|${s.artist?.section}`,
      onNearEnd: () => {
        const a = store.get().artist;
        if (a && !SET_SECTIONS.has(a.section)) void loadArtistSection(store, a.section, true);
      },
    });
    this.grid = h("div", { class: "playlist-grid", attrs: { role: "list" } });

    this.el = h("section", { class: "page artist-page", attrs: { "aria-label": "Artist" } }, [
      h("header", { class: "artist-hero" }, [
        this.banner,
        back,
        this.avatarSlot,
        h("div", { class: "artist-text" }, [
          this.kind,
          this.name,
          this.meta,
          h("div", { class: "pl-actions" }, [play, shuffle, this.followBtn, this.webBtn]),
        ]),
      ]),
      h("div", { class: "artist-bar" }, [chipRow, tools]),
      this.panel.el,
      this.grid,
    ]);
  }

  /** The tracks to show: searched and sorted (memoised). */
  private shownTracks(a: ArtistPageState | null): Track[] | null {
    if (!a) return null;
    const f = this.shown.from;
    if (f && f.tracks === a.tracks && f.query === a.query && f.sort === a.sort) return this.shown.list;
    const q = a.query.trim().toLocaleLowerCase();
    const list = q ? a.tracks.filter((t) => matches(t.title, q) || matches(t.artist, q)) : [...a.tracks];
    this.shown = { from: a, list: sortTracks(list, a.sort) };
    return this.shown.list;
  }

  jumpToCurrent(): boolean {
    return this.panel.jumpToCurrent();
  }

  update(s: AppState, prev: AppState | null): void {
    const a = s.artist;
    if (!a) return;
    const pa = prev?.artist;
    if (a !== pa) {
      const info = a.info;
      if (!pa || info !== pa.info || a.name !== pa.name) {
        this.name.textContent = info?.username ?? a.name;
        this.meta.textContent = info
          ? [info.city, `${formatCount(info.followers)} followers`, plural(info.trackCount, "track")].filter(Boolean).join(" · ")
          : a.error
            ? `Couldn't load this artist: ${a.error}`
            : "Loading…";
        if (!pa || info?.id !== pa.info?.id || info?.avatarUrl !== pa.info?.avatarUrl) {
          this.avatarSlot.replaceChildren(info ? artistAvatar(info, "art-artist") : h("div", { class: "avatar-art art-artist" }));
          // Their banner if they have one, otherwise a blurred avatar.
          const banner = artUrl(info?.bannerUrl, "original") ?? artUrl(info?.avatarUrl, "t300x300");
          this.banner.style.backgroundImage = banner ? cssUrl(banner) : "";
          this.banner.classList.toggle("is-avatar", !info?.bannerUrl);
        }
        // Your own profile: no Follow button.
        const mine = info !== null && s.account?.id === info.id;
        this.kind.textContent = mine ? "Your profile" : "Artist";
        const following = info?.following === true;
        this.followBtn.hidden = !info || mine;
        this.followBtn.textContent = following ? "Following" : "Follow";
        this.followBtn.classList.toggle("accent", !following);
        this.followBtn.setAttribute("aria-pressed", String(following));
        this.webBtn.hidden = !info?.permalinkUrl;
      }
      for (const [id, chip] of this.chips) {
        chip.classList.toggle("is-selected", id === a.section);
        chip.setAttribute("aria-selected", String(id === a.section));
      }
      const showGrid = SET_SECTIONS.has(a.section);
      this.grid.hidden = !showGrid;
      this.panel.el.hidden = showGrid;
      if (!pa || a.sort !== pa.sort) {
        const label = SORTS.find((o) => o.id === a.sort)?.label ?? "Sort";
        this.sortBtn.replaceChildren(icon("sort"), h("span", { text: a.sort === "default" ? "Sort" : label }));
        this.sortBtn.setAttribute("aria-label", `Sort: ${label}`);
        this.sortBtn.classList.toggle("is-active", a.sort !== "default");
      }
      if (this.searchInput.value !== a.query) this.searchInput.value = a.query;
      if (showGrid && (!pa || a.playlists !== pa.playlists || a.loading !== pa.loading || a.query !== pa.query || a.sort !== pa.sort)) {
        const q = a.query.trim().toLocaleLowerCase();
        let sets = q ? a.playlists.filter((p) => matches(p.title, q)) : [...a.playlists];
        if (a.sort === "title") sets.sort((x, y) => collator.compare(x.title, y.title));
        else if (a.sort === "longest") sets.sort((x, y) => y.trackCount - x.trackCount);
        else if (a.sort === "shortest") sets.sort((x, y) => x.trackCount - y.trackCount);
        const cards = sets.map((p) => {
          const card = h("button", { class: "playlist-card", attrs: { type: "button", role: "listitem", title: p.title } }, [
            playlistArt(p),
            h("span", { class: "playlist-name", text: p.title }),
            h("span", { class: "playlist-meta", text: setLabel(p) }),
          ]);
          card.addEventListener("click", () => openPlaylist(this.store, p));
          return card;
        });
        const empty = { albums: "No albums.", eps: "No EPs or singles.", playlists: "No playlists." }[a.section as "albums"] ?? "Nothing here.";
        const note = a.loading
          ? "Loading…"
          : a.error
            ? `Couldn't load: ${a.error}`
            : cards.length
              ? ""
              : q && a.playlists.length
                ? "Nothing matches your search."
                : empty;
        this.grid.replaceChildren(...cards, ...(note ? [h("p", { class: "grid-note", text: note })] : []));
      }
      // Searching or sorting: fetch the rest of the list (up to a cap) so
      // results aren't limited to the first page.
      const wantAll = (a.query.trim() !== "" || a.sort !== "default") && !showGrid;
      if (wantAll && a.next && !a.loading && !a.error && a.tracks.length < LOAD_ALL_CAP) {
        queueMicrotask(() => void loadArtistSection(this.store, a.section, true));
      }
    }
    if (!this.panel.el.hidden) this.panel.update(s, prev);
  }
}
