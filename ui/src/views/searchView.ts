// Search all of SoundCloud: tracks, artists and playlists.
import { formatCount, moreSearch, openArtist, openPlaylist, runSearch } from "../browse";
import { catSvg } from "../components/mascot";
import { TrackListPanel } from "../components/trackListPanel";
import { artUrl } from "../lib/artwork";
import { h } from "../lib/dom";
import { placeholderGradient, plural } from "../lib/format";
import { icon } from "../lib/icons";
import type { Player } from "../player/player";
import type { AppState, AppStore, SearchKind } from "../state";
import type { Artist } from "../types";
import { playlistArt } from "./playlistsView";

const KINDS: readonly { id: SearchKind; label: string }[] = [
  { id: "tracks", label: "Tracks" },
  { id: "artists", label: "Artists" },
  { id: "playlists", label: "Playlists" },
];

export function artistAvatar(a: { id: number; avatarUrl: string | null }, cls: string): HTMLElement {
  const box = h("div", { class: `avatar-art ${cls}` });
  box.style.background = placeholderGradient(String(a.id));
  const src = artUrl(a.avatarUrl, "t300x300");
  if (src) {
    const img = h("img", { attrs: { src, alt: "", loading: "lazy", decoding: "async" } });
    img.addEventListener("error", () => img.remove());
    box.append(img);
  }
  return box;
}

export class SearchView {
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly chips = new Map<SearchKind, HTMLButtonElement>();
  private readonly panel: TrackListPanel;
  private readonly grid: HTMLElement;
  private readonly message: HTMLElement;
  private debounce = 0;

  constructor(
    private readonly store: AppStore,
    player: Player,
  ) {
    this.input = h("input", {
      class: "sc-search-input",
      attrs: { type: "search", placeholder: "Search SoundCloud: songs, artists, playlists", "aria-label": "Search SoundCloud", spellcheck: "false" },
    });
    this.input.addEventListener("input", () => {
      window.clearTimeout(this.debounce);
      this.debounce = window.setTimeout(() => void runSearch(store, this.input.value, store.get().scSearch.kind), 450);
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        window.clearTimeout(this.debounce);
        void runSearch(store, this.input.value, store.get().scSearch.kind);
      }
    });

    const chipRow = h("div", { class: "chip-row", attrs: { role: "radiogroup", "aria-label": "Result type" } });
    for (const k of KINDS) {
      const chip = h("button", { class: "chip", text: k.label, attrs: { type: "button", role: "radio" } });
      chip.addEventListener("click", () => void runSearch(store, store.get().scSearch.q, k.id));
      this.chips.set(k.id, chip);
      chipRow.append(chip);
    }

    this.panel = new TrackListPanel(store, player, {
      label: "Search results",
      source: (s) => s.scSearch.tracks,
      emptyText: (s) =>
        s.scSearch.loading ? "Searching…" : s.scSearch.error ? `Search failed: ${s.scSearch.error}` : "No tracks found.",
      filtersEnabled: false,
      onNearEnd: () => void moreSearch(store),
      sourceKey: (s) => `${s.scSearch.q}|${s.scSearch.kind}`,
    });
    this.grid = h("div", { class: "playlist-grid search-grid", attrs: { role: "list" } });
    this.grid.addEventListener("scroll", () => {
      const g = this.grid;
      if (g.scrollTop + g.clientHeight > g.scrollHeight - 300) void moreSearch(store);
    });
    this.message = h("div", { class: "empty-state search-empty" });

    this.el = h("section", { class: "view search-view", attrs: { role: "tabpanel", id: "panel-search", "aria-labelledby": "tab-search" } }, [
      h("div", { class: "sc-search-bar" }, [icon("search"), this.input]),
      chipRow,
      this.message,
      this.panel.el,
      this.grid,
    ]);
  }

  focus(): void {
    this.input.focus();
    this.input.select();
  }

  jumpToCurrent(): boolean {
    return this.store.get().scSearch.kind === "tracks" && this.panel.jumpToCurrent();
  }

  private artistCard(a: Artist): HTMLElement {
    const card = h("button", { class: "playlist-card artist-card", attrs: { type: "button", role: "listitem", title: a.username } }, [
      artistAvatar(a, "art-playlist"),
      h("span", { class: "playlist-name", text: a.username }),
      h("span", { class: "playlist-meta", text: `${formatCount(a.followers)} followers` }),
    ]);
    card.addEventListener("click", () => openArtist(this.store, { id: a.id, profileUrl: a.permalinkUrl, name: a.username }));
    return card;
  }

  update(s: AppState, prev: AppState | null): void {
    const q = s.scSearch;
    const pq = prev?.scSearch;
    if (s.tab === "search" && prev?.tab !== "search") requestAnimationFrame(() => this.input.focus());
    if (q === pq) {
      if (!this.panel.el.hidden) this.panel.update(s, prev);
      return;
    }
    if (document.activeElement !== this.input && this.input.value !== q.q) this.input.value = q.q;
    for (const [id, chip] of this.chips) {
      chip.classList.toggle("is-selected", id === q.kind);
      chip.setAttribute("aria-checked", String(id === q.kind));
    }

    // Start screen: a sleepy cat until you search.
    const start = !q.done;
    this.message.hidden = !start;
    if (start && !this.message.firstChild) {
      const cat = h("div", { class: "mascot mascot-empty is-sleeping" });
      cat.append(catSvg());
      this.message.replaceChildren(cat, h("p", { text: "Search all of SoundCloud." }));
    }
    const showTracks = !start && q.kind === "tracks";
    this.panel.el.hidden = !showTracks;
    this.grid.hidden = start || q.kind === "tracks";
    if (showTracks) this.panel.update(s, prev);

    if (!start && q.kind !== "tracks" && (!pq || q.artists !== pq.artists || q.playlists !== pq.playlists || q.kind !== pq.kind || q.loading !== pq.loading || q.error !== pq.error)) {
      const cards =
        q.kind === "artists"
          ? q.artists.map((a) => this.artistCard(a))
          : q.playlists.map((p) => {
              const card = h("button", { class: "playlist-card", attrs: { type: "button", role: "listitem", title: p.title } }, [
                playlistArt(p),
                h("span", { class: "playlist-name", text: p.title }),
                h("span", { class: "playlist-meta", text: `${p.owner} · ${plural(p.trackCount, "track")}` }),
              ]);
              card.addEventListener("click", () => openPlaylist(this.store, p));
              return card;
            });
      const note = q.loading
        ? "Searching…"
        : q.error
          ? `Search failed: ${q.error}`
          : cards.length === 0
            ? `No ${q.kind} found.`
            : "";
      this.grid.replaceChildren(...cards, ...(note ? [h("p", { class: "grid-note", text: note })] : []));
    }
  }
}
