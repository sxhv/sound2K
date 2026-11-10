// Artist page: banner, avatar, follow button, and their popular tracks,
// uploads, reposts and playlists.
import { formatCount, loadArtistSection, openPlaylist, toggleFollow } from "../browse";
import { TrackListPanel } from "../components/trackListPanel";
import { artUrl, cssUrl } from "../lib/artwork";
import { button, h } from "../lib/dom";
import { plural } from "../lib/format";
import type { Player } from "../player/player";
import type { ArtistSection, AppState, AppStore } from "../state";
import { openOnSoundCloud } from "../library";
import { playlistArt } from "./playlistsView";
import { artistAvatar } from "./searchView";

const SECTIONS: readonly { id: ArtistSection; label: string }[] = [
  { id: "popular", label: "Popular" },
  { id: "tracks", label: "Tracks" },
  { id: "reposts", label: "Reposts" },
  { id: "playlists", label: "Playlists" },
];

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
        const i = list.findIndex((t) => t.playable);
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

    this.panel = new TrackListPanel(store, player, {
      label: "Artist tracks",
      source: (s) => s.artist?.tracks ?? null,
      emptyText: (s) =>
        s.artist?.loading ? "Loading…" : s.artist?.error ? `Couldn't load: ${s.artist.error}` : "Nothing here yet.",
      filtersEnabled: false,
      sourceKey: (s) => `${s.artist?.id ?? s.artist?.profileUrl}|${s.artist?.section}`,
      onNearEnd: () => {
        const a = store.get().artist;
        if (a && a.section !== "playlists") void loadArtistSection(store, a.section, true);
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
      chipRow,
      this.panel.el,
      this.grid,
    ]);
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
      const showGrid = a.section === "playlists";
      this.grid.hidden = !showGrid;
      this.panel.el.hidden = showGrid;
      if (showGrid && (!pa || a.playlists !== pa.playlists || a.loading !== pa.loading)) {
        const cards = a.playlists.map((p) => {
          const card = h("button", { class: "playlist-card", attrs: { type: "button", role: "listitem", title: p.title } }, [
            playlistArt(p),
            h("span", { class: "playlist-name", text: p.title }),
            h("span", { class: "playlist-meta", text: plural(p.trackCount, "track") }),
          ]);
          card.addEventListener("click", () => openPlaylist(this.store, p));
          return card;
        });
        const note = a.loading ? "Loading…" : a.error ? `Couldn't load: ${a.error}` : cards.length ? "" : "No playlists.";
        this.grid.replaceChildren(...cards, ...(note ? [h("p", { class: "grid-note", text: note })] : []));
      }
    }
    if (!this.panel.el.hidden) this.panel.update(s, prev);
  }
}
