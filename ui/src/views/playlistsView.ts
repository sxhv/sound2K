import { openPlaylist } from "../browse";
import { playlistArt } from "../components/playlistArt";
export { playlistArt };
import { TrackListPanel } from "../components/trackListPanel";
import { button, h } from "../lib/dom";
import { icon } from "../lib/icons";
import { showMenu } from "../components/popover";
import { canEdit, copyToSound2K, createPlaylist, deletePlaylist, isLocalPlaylist, moveInPlaylist, moveTrackTo, removeFromPlaylist, renamePlaylist } from "../playlistEdit";
import { searchPlaylists } from "../lib/filterSort";
import { artUrl, cssUrl } from "../lib/artwork";
import { formatTotal, placeholderGradient, plural } from "../lib/format";
import type { Player } from "../player/player";
import type { AppState, AppStore } from "../state";
import type { PlaylistSummary } from "../types";


export class PlaylistsView {
  readonly el: HTMLElement;
  private readonly overview: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly overviewEmpty: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly detailArt: HTMLElement;
  private readonly detailTitle: HTMLElement;
  private readonly detailMeta: HTMLElement;
  private readonly hero: HTMLElement;
  private readonly editBtn: HTMLButtonElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly kind = h("span", { class: "pl-kind", text: "Playlist" });
  private readonly heroBg: HTMLElement;
  private readonly panel: TrackListPanel;

  constructor(
    private readonly store: AppStore,
    player: Player,
  ) {
    this.grid = h("div", { class: "playlist-grid", attrs: { role: "list", "aria-label": "Playlists" } });
    this.overviewEmpty = h("div", { class: "empty-state" });
    this.overview = h("div", { class: "playlist-overview" }, [
      h("div", { class: "view-header" }, [h("h2", { text: "Playlists" })]),
      this.grid,
      this.overviewEmpty,
    ]);

    this.panel = new TrackListPanel(store, player, {
      label: "Playlist tracks",
      source: (s) => s.openPlaylist?.tracks ?? null,
      emptyText: (s) => (s.openPlaylist?.loading ? "Loading playlist…" : "This playlist is empty."),
      filtersEnabled: true,
      sourceKey: (s) => s.openPlaylist?.summary.id ?? "",
      // Your own playlists: drag the grip to reorder.
      reorder: {
        enabled: (s) => s.openPlaylist !== null && !s.openPlaylist.loading && canEdit(store, s.openPlaylist.summary),
        move: (t, to) => {
          const open = store.get().openPlaylist;
          if (open) void moveTrackTo(store, open.summary, t, to);
        },
      },
      // Your own playlists: remove / reorder from the ⋯ menu.
      extraMenu: (t) => {
        const open = store.get().openPlaylist;
        if (!open || !canEdit(store, open.summary)) return [];
        const i = open.tracks.findIndex((x) => x.id === t.id);
        return [
          { label: "Move up", action: () => void moveInPlaylist(store, open.summary, t, "up"), disabled: i <= 0 },
          { label: "Move down", action: () => void moveInPlaylist(store, open.summary, t, "down"), disabled: i < 0 || i >= open.tracks.length - 1 },
          { label: "Remove from this playlist", action: () => void removeFromPlaylist(store, open.summary, t) },
        ];
      },
    });
    this.detailArt = h("div", { class: "detail-art" });
    this.detailTitle = h("h2", { class: "detail-title" });
    this.detailMeta = h("span", { class: "view-count" });
    const back = button({ label: "Back to playlists", icon: "back", class: "glass-btn icon-only", onClick: () => store.set({ openPlaylist: null, search: "", selectedId: null }) });
    const tracks = (): typeof this.panel.visibleTracks => this.panel.visibleTracks;
    const play = button({
      label: "Play playlist",
      icon: "play",
      text: "Play",
      class: "glass-btn accent small",
      onClick: () => {
        const list = tracks();
        const i = list.findIndex((t) => t.playable);
        if (i >= 0) player.playFromList(list, i);
      },
    });
    const shuffle = button({ label: "Shuffle playlist", icon: "shuffle", text: "Shuffle", class: "glass-btn small", onClick: () => player.playShuffled(tracks()) });
    const queueAll = button({ label: "Add all to queue", icon: "queue", text: "Queue", class: "glass-btn small", onClick: () => player.enqueueAll(tracks()) });
    // Shown only for your own playlists.
    this.editBtn = button({
      label: "Edit playlist",
      icon: "more",
      class: "glass-btn icon-only small",
      onClick: () => {
        const open = store.get().openPlaylist;
        if (!open) return;
        showMenu(this.editBtn, [
          { label: "Rename…", action: () => void renamePlaylist(store, open.summary) },
          { label: "Delete playlist…", action: () => void deletePlaylist(store, open.summary) },
        ]);
      },
    });

    // SoundCloud playlists are read-only: copy one to Sound2K to edit it.
    this.copyBtn = button({
      label: "Copy to Sound2K (to edit it)",
      icon: "plus",
      text: "Copy to Sound2K",
      class: "glass-btn small",
      onClick: () => {
        const open = store.get().openPlaylist;
        if (open && !open.loading) void copyToSound2K(store, open.summary, open.tracks);
      },
    });

    // Apple-style header: big cover on a blurred copy of itself. It
    // shrinks to a compact bar once the track list is scrolled.
    this.heroBg = h("div", { class: "pl-hero-bg", attrs: { "aria-hidden": "true" } });
    this.hero = h("div", { class: "pl-hero" }, [
      this.heroBg,
      back,
      this.detailArt,
      h("div", { class: "detail-text" }, [
        this.kind,
        this.detailTitle,
        this.detailMeta,
        h("div", { class: "pl-actions" }, [play, shuffle, queueAll, this.copyBtn, this.editBtn]),
      ]),
    ]);
    this.detail = h("div", { class: "playlist-detail" }, [this.hero, this.panel.el]);
    this.panel.el.addEventListener(
      "scroll",
      (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains("vlist")) this.hero.classList.toggle("is-compact", target.scrollTop > 24);
      },
      { capture: true, passive: true },
    );

    this.el = h("section", { class: "view", attrs: { role: "tabpanel", id: "panel-playlists", "aria-labelledby": "tab-playlists" } }, [this.overview, this.detail]);
  }

  private open(p: PlaylistSummary): void {
    openPlaylist(this.store, p);
  }


  private renderOverview(s: AppState): void {
    const list = searchPlaylists(s.playlists, s.search);
    const newCard = h("button", { class: "playlist-card new-playlist-card", attrs: { type: "button", role: "listitem", title: "New playlist" } }, [
      h("div", { class: "art art-playlist new-playlist-art", attrs: { "aria-hidden": "true" } }, [icon("plus")]),
      h("span", { class: "playlist-name", text: "New playlist" }),
    ]);
    newCard.addEventListener("click", () => {
      void createPlaylist(this.store).then((p) => {
        if (p) this.open(p);
      });
    });
    this.grid.replaceChildren(
      ...(!s.search ? [newCard] : []),
      ...list.map((p, i) => {
        const card = h("button", { class: "playlist-card", attrs: { type: "button", role: "listitem", title: `Open ${p.title}` } }, [
          playlistArt(p),
          h("span", { class: "playlist-name", text: p.title }),
          h("span", { class: "playlist-meta", text: `${isLocalPlaylist(p) ? "Sound2K" : p.owner} · ${plural(p.trackCount, "track")}` }),
        ]);
        card.style.setProperty("--i", String(Math.min(i, 18)));
        card.addEventListener("click", () => this.open(p));
        return card;
      }),
    );
    const empty = list.length === 0 && s.search !== "";
    this.overviewEmpty.hidden = !empty;
    this.grid.hidden = empty;
    if (empty) {
      this.overviewEmpty.textContent = s.loading
        ? "Loading playlists…"
        : s.playlists.length === 0
          ? "No playlists yet."
          : "No playlists match your search.";
    }
  }

  jumpToCurrent(): boolean {
    return !this.detail.hidden && this.panel.jumpToCurrent();
  }

  update(s: AppState, prev: AppState | null): void {
    const open = s.openPlaylist;
    this.overview.hidden = open !== null;
    this.detail.hidden = open === null;

    if (!open) {
      if (!prev || s.playlists !== prev.playlists || s.search !== prev.search || prev.openPlaylist !== null || s.loading !== prev.loading || s.account !== prev.account) {
        this.renderOverview(s);
      }
      return;
    }

    if (!prev || open.summary !== prev.openPlaylist?.summary) {
      this.detailArt.replaceChildren(playlistArt(open.summary));
      this.detailTitle.textContent = open.summary.title;
      this.editBtn.hidden = !canEdit(this.store, open.summary);
      this.copyBtn.hidden = isLocalPlaylist(open.summary);
      this.kind.textContent = isLocalPlaylist(open.summary) ? "Sound2K playlist" : "Playlist";
      this.detailTitle.title = open.summary.title;
      const bg = artUrl(open.summary.artworkUrl, "t67x67");
      this.heroBg.style.backgroundImage = bg ? cssUrl(bg) : placeholderGradient(open.summary.id);
      this.hero.classList.remove("is-compact");
    }
    this.panel.update(s, prev);
    const shown = this.panel.visibleTracks.length;
    const total = open.tracks.length;
    this.detailMeta.textContent = open.loading
      ? "Loading…"
      : `${open.summary.owner} · ${shown === total ? plural(total, "track") : `${shown} of ${plural(total, "track")}`}` +
        (total > 0 ? ` · ${formatTotal(open.tracks.reduce((sum, t) => sum + t.durationMs, 0))}` : "");
  }
}
