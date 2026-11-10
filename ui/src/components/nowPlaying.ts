// Full-window "Now Playing" view (opens from the dock artwork): big
// artwork on a blurred backdrop, scrolling title, seek bar and controls.
import { button, h } from "../lib/dom";
import { formatDuration } from "../lib/format";
import { icon } from "../lib/icons";
import { setMarquee } from "../lib/marquee";
import type { Player } from "../player/player";
import type { AppState, AppStore } from "../state";
import { downloadTrack, openOnSoundCloud, toggleLike } from "../library";
import { ArtBackdrop } from "./artBackdrop";
import { openArtistOf } from "../browse";
import { artwork, swapArt } from "./trackRow";

function setFill(range: HTMLInputElement): void {
  const max = Number(range.max) || 1;
  range.style.setProperty("--pct", `${Math.min(100, Math.max(0, (Number(range.value) / max) * 100))}%`);
}

export class NowPlaying {
  readonly el: HTMLElement;
  private readonly backdrop = new ArtBackdrop("np-backdrop");
  private readonly artSlot: HTMLElement;
  private readonly title: HTMLElement;
  private readonly artist: HTMLElement;
  private readonly likeBtn: HTMLButtonElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly shuffleBtn: HTMLButtonElement;
  private readonly repeatBtn: HTMLButtonElement;
  private readonly seek: HTMLInputElement;
  private readonly elapsed: HTMLElement;
  private readonly remaining: HTMLElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly volume: HTMLInputElement;
  private readonly queueBtn: HTMLButtonElement;
  private readonly downloadBtn: HTMLButtonElement;
  private dragging = false;

  constructor(store: AppStore, player: Player) {
    const close = button({
      label: "Close Now Playing (Esc)",
      icon: "chevron",
      class: "glass-btn icon-only np-close",
      onClick: () => store.set({ nowPlayingOpen: false }),
    });
    this.artSlot = h("div", { class: "np-art" }, [artwork(null, "art-np", "t500x500")]);
    this.title = h("div", { class: "np-title" });
    this.title.addEventListener("click", () => openOnSoundCloud(store.get().player.current?.permalinkUrl ?? null));
    this.artist = h("div", { class: "np-artist" });
    this.artist.addEventListener("click", () => {
      const t = store.get().player.current;
      if (t?.artist) openArtistOf(store, t);
    });
    this.likeBtn = button({
      label: "Like",
      icon: "heart",
      class: "icon-btn np-like",
      onClick: () => {
        const t = store.get().player.current;
        if (t) void toggleLike(store, t);
      },
    });

    this.seek = h("input", { class: "range seek np-seek", attrs: { type: "range", min: "0", max: "1", step: "1000", value: "0", "aria-label": "Seek" } });
    this.seek.addEventListener("input", () => {
      this.dragging = true;
      this.elapsed.textContent = formatDuration(Number(this.seek.value));
      setFill(this.seek);
    });
    this.seek.addEventListener("change", () => {
      this.dragging = false;
      player.seek(Number(this.seek.value));
    });
    this.elapsed = h("span", { class: "time" });
    this.remaining = h("span", { class: "time" });

    this.shuffleBtn = button({ label: "Shuffle", icon: "shuffle", class: "icon-btn toggle", onClick: () => player.toggleShuffle() });
    this.playBtn = button({ label: "Play (Space)", icon: "play", class: "play-orb np-play", onClick: () => player.togglePlay() });
    this.repeatBtn = button({ label: "Repeat", icon: "repeat", class: "icon-btn toggle", onClick: () => player.cycleRepeat() });

    this.muteBtn = button({ label: "Mute", icon: "volume", onClick: () => player.toggleMute() });
    this.volume = h("input", { class: "range volume", attrs: { type: "range", min: "0", max: "100", step: "1", "aria-label": "Volume" } });
    this.volume.addEventListener("input", () => {
      setFill(this.volume);
      player.setVolume(Number(this.volume.value) / 100);
    });
    this.downloadBtn = button({
      label: "Download (the artist allows it)",
      icon: "download",
      class: "icon-btn",
      onClick: () => {
        const t = store.get().player.current;
        if (t) downloadTrack(store, t);
      },
    });
    this.queueBtn = button({ label: "Up next", icon: "queue", class: "icon-btn toggle", onClick: () => store.set({ queueOpen: !store.get().queueOpen }) });

    const info = h("div", { class: "np-info" }, [
      h("div", { class: "np-titles" }, [this.title, this.artist]),
      this.likeBtn,
    ]);
    const controls = h("div", { class: "np-controls" }, [
      this.shuffleBtn,
      button({ label: "Previous", icon: "prev", class: "glass-btn round np-round", onClick: () => player.prev() }),
      this.playBtn,
      button({ label: "Next", icon: "next", class: "glass-btn round np-round", onClick: () => player.next() }),
      this.repeatBtn,
    ]);

    this.el = h("section", { class: "now-playing-view", attrs: { "aria-label": "Now playing", role: "dialog" } }, [
      this.backdrop.el,
      close,
      h("div", { class: "np-body" }, [
        this.artSlot,
        h("div", { class: "np-panel" }, [
          info,
          h("div", { class: "np-seek-row" }, [this.seek, h("div", { class: "np-times" }, [this.elapsed, this.remaining])]),
          controls,
          h("div", { class: "np-volume-row" }, [this.muteBtn, this.volume, this.downloadBtn, this.queueBtn]),
        ]),
      ]),
    ]);
    this.el.inert = true;
  }

  update(s: AppState, prev: AppState | null): void {
    if (!prev || s.nowPlayingOpen !== prev.nowPlayingOpen) {
      this.el.classList.toggle("is-open", s.nowPlayingOpen);
      this.el.inert = !s.nowPlayingOpen;
    }
    const p = s.player;
    const pp = prev?.player;
    const t = p.current;

    if (!pp || t !== pp.current || s.artBackgrounds !== prev?.artBackgrounds) {
      this.backdrop.set(t, true);
    }
    if (!pp || t !== pp.current) {
      if (pp) swapArt(this.artSlot, artwork(t, "art-np", "t500x500"));
      else this.artSlot.replaceChildren(artwork(t, "art-np", "t500x500"));
      setMarquee(this.title, t ? t.title : "Nothing playing");
      this.title.classList.toggle("is-link", Boolean(t?.permalinkUrl));
      this.title.title = t?.permalinkUrl ? "Open on SoundCloud" : "";
      this.downloadBtn.hidden = !t?.downloadable;
      this.seek.max = String(t ? t.durationMs : 1);
      this.seek.disabled = !t;
    }
    if (!pp || t !== pp.current || p.loading !== pp.loading) {
      this.artist.textContent = p.loading ? "Loading…" : t?.artist ?? "Pick a track to start";
    }
    if (!pp || t !== pp.current || s.likedIds !== prev?.likedIds) {
      const liked = t !== null && s.likedIds.has(t.id);
      this.likeBtn.hidden = t === null;
      this.likeBtn.classList.toggle("is-on", liked);
      this.likeBtn.setAttribute("aria-pressed", String(liked));
      this.likeBtn.title = liked ? "Unlike" : "Like";
    }
    if (!pp || p.playing !== pp.playing || t !== pp.current || p.loading !== pp.loading) {
      const playing = p.playing && t !== null;
      if (!pp || playing !== (pp.playing && pp.current !== null)) {
        this.playBtn.replaceChildren(icon(playing ? "pause" : "play"));
      }
      this.playBtn.setAttribute("aria-label", playing ? "Pause (Space)" : "Play (Space)");
      this.playBtn.classList.toggle("is-loading", p.loading);
      // Apple-style: the artwork shrinks back a little while paused.
      this.el.classList.toggle("is-playing", playing);
    }
    if (!this.dragging && (!pp || p.positionMs !== pp.positionMs || t !== pp.current)) {
      this.seek.value = String(Math.floor(p.positionMs));
      setFill(this.seek);
      this.elapsed.textContent = formatDuration(p.positionMs);
      this.remaining.textContent = `-${formatDuration(Math.max(0, (t?.durationMs ?? 0) - p.positionMs))}`;
    }
    if (!pp || p.shuffle !== pp.shuffle) {
      this.shuffleBtn.classList.toggle("is-on", p.shuffle);
      this.shuffleBtn.setAttribute("aria-pressed", String(p.shuffle));
    }
    if (!pp || p.repeat !== pp.repeat) {
      this.repeatBtn.replaceChildren(icon(p.repeat === "one" ? "repeatOne" : "repeat"));
      this.repeatBtn.classList.toggle("is-on", p.repeat !== "off");
      this.repeatBtn.title = `Repeat: ${p.repeat}`;
    }
    if (!pp || p.volume !== pp.volume || p.muted !== pp.muted) {
      this.muteBtn.replaceChildren(icon(p.muted || p.volume === 0 ? "mute" : "volume"));
      this.volume.value = String(Math.round((p.muted ? 0 : p.volume) * 100));
      setFill(this.volume);
    }
    if (!prev || s.queueOpen !== prev.queueOpen) {
      this.queueBtn.classList.toggle("is-on", s.queueOpen);
      this.queueBtn.setAttribute("aria-pressed", String(s.queueOpen));
    }
  }
}
