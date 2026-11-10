// The persistent glossy playback dock at the bottom of the window.
import { button, h } from "../lib/dom";
import { formatDuration } from "../lib/format";
import { icon } from "../lib/icons";
import type { Player } from "../player/player";
import type { AppState, AppStore } from "../state";
import { openOnSoundCloud, toggleLike } from "../library";
import { setMarquee } from "../lib/marquee";
import { openArtistOf } from "../browse";
import { artwork, swapArt } from "./trackRow";

function setFill(range: HTMLInputElement): void {
  const max = Number(range.max) || 1;
  const pct = Math.min(100, Math.max(0, (Number(range.value) / max) * 100));
  range.style.setProperty("--pct", `${pct}%`);
}

export class Dock {
  readonly el: HTMLElement;
  private readonly artSlot: HTMLElement;
  private readonly title: HTMLElement;
  private readonly artist: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly shuffleBtn: HTMLButtonElement;
  private readonly repeatBtn: HTMLButtonElement;
  private readonly seek: HTMLInputElement;
  private readonly elapsed: HTMLElement;
  private readonly total: HTMLElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly volume: HTMLInputElement;
  private readonly likeBtn: HTMLButtonElement;
  private readonly queueBtn: HTMLButtonElement;
  private dragging = false;

  constructor(store: AppStore, player: Player, visualizer: HTMLCanvasElement) {
    // The artwork opens the full Now Playing view.
    this.artSlot = h("button", { class: "dock-art", attrs: { type: "button", "aria-label": "Open Now Playing", title: "Now Playing" } }, [artwork(null, "art-dock")]);
    this.artSlot.addEventListener("click", () => {
      if (store.get().player.current) store.set({ nowPlayingOpen: !store.get().nowPlayingOpen });
    });
    this.title = h("div", { class: "dock-title", text: "Nothing playing", attrs: { role: "link" } });
    // Clicking the title opens the track on SoundCloud (credits the uploader).
    this.title.addEventListener("click", () => openOnSoundCloud(store.get().player.current?.permalinkUrl ?? null));
    this.likeBtn = button({
      label: "Like",
      icon: "heart",
      class: "icon-btn dock-like",
      onClick: () => {
        const t = store.get().player.current;
        if (t) void toggleLike(store, t);
      },
    });
    this.artist = h("div", { class: "dock-artist", text: "Pick a track to start" });
    this.artist.addEventListener("click", () => {
      const t = store.get().player.current;
      if (t?.artist) openArtistOf(store, t);
    });

    this.shuffleBtn = button({ label: "Shuffle", icon: "shuffle", class: "icon-btn toggle", onClick: () => player.toggleShuffle() });
    this.prevBtn = button({ label: "Previous (Ctrl+←)", icon: "prev", class: "glass-btn round", onClick: () => player.prev() });
    this.playBtn = button({ label: "Play (Space)", icon: "play", class: "play-orb", onClick: () => player.togglePlay() });
    this.nextBtn = button({ label: "Next (Ctrl+→)", icon: "next", class: "glass-btn round", onClick: () => player.next() });
    this.repeatBtn = button({ label: "Repeat: off", icon: "repeat", class: "icon-btn toggle", onClick: () => player.cycleRepeat() });

    this.seek = h("input", { class: "range seek", attrs: { type: "range", min: "0", max: "1", step: "1000", value: "0", "aria-label": "Seek" } });
    this.seek.disabled = true;
    this.seek.addEventListener("input", () => {
      this.dragging = true;
      this.elapsed.textContent = formatDuration(Number(this.seek.value));
      setFill(this.seek);
    });
    this.seek.addEventListener("change", () => {
      this.dragging = false;
      player.seek(Number(this.seek.value));
    });
    this.elapsed = h("span", { class: "time", text: "0:00" });
    this.total = h("span", { class: "time", text: "0:00" });

    this.muteBtn = button({ label: "Mute", icon: "volume", onClick: () => player.toggleMute() });
    this.volume = h("input", { class: "range volume", attrs: { type: "range", min: "0", max: "100", step: "1", "aria-label": "Volume" } });
    this.volume.addEventListener("input", () => {
      setFill(this.volume);
      player.setVolume(Number(this.volume.value) / 100);
    });
    this.queueBtn = button({ label: "Up next", icon: "queue", class: "icon-btn toggle", onClick: () => store.set({ queueOpen: !store.get().queueOpen }) });

    this.el = h("footer", { class: "dock glass-panel" }, [
      visualizer,
      h("div", { class: "dock-track" }, [this.artSlot, h("div", { class: "dock-meta" }, [this.title, this.artist]), this.likeBtn]),
      h("div", { class: "dock-center" }, [
        h("div", { class: "dock-controls" }, [this.shuffleBtn, this.prevBtn, this.playBtn, this.nextBtn, this.repeatBtn]),
        h("div", { class: "dock-seek" }, [this.elapsed, this.seek, this.total]),
      ]),
      h("div", { class: "dock-right" }, [
        this.muteBtn,
        this.volume,
        this.queueBtn,
        button({ label: "Mini player", icon: "mini", onClick: () => store.set({ mini: true }) }),
      ]),
    ]);
  }

  update(s: AppState, prev: AppState | null): void {
    const p = s.player;
    const pp = prev?.player;

    if (!pp || p.current !== pp.current || s.likedIds !== prev?.likedIds) {
      const liked = p.current !== null && s.likedIds.has(p.current.id);
      this.likeBtn.hidden = p.current === null;
      this.likeBtn.classList.toggle("is-on", liked);
      this.likeBtn.setAttribute("aria-pressed", String(liked));
      this.likeBtn.setAttribute("aria-label", liked ? "Unlike" : "Like");
      this.likeBtn.title = liked ? "Unlike" : "Like";
      this.title.classList.toggle("is-link", Boolean(p.current?.permalinkUrl));
      this.title.title = p.current?.permalinkUrl ? `${p.current.title} (open on SoundCloud)` : p.current?.title ?? "";
    }

    if (!pp || p.current !== pp.current) {
      const t = p.current;
      if (pp) swapArt(this.artSlot, artwork(t, "art-dock"));
      else this.artSlot.replaceChildren(artwork(t, "art-dock"));
      setMarquee(this.title, t ? t.title : "Nothing playing");
      this.artist.textContent = t ? t.artist : "Pick a track to start";
      this.seek.max = String(t ? t.durationMs : 1);
      this.seek.disabled = !t;
      this.total.textContent = formatDuration(t ? t.durationMs : 0);
    }

    if (!pp || p.playing !== pp.playing || p.current !== pp.current) {
      const playing = p.playing && p.current !== null;
      // Only swap the icon when play/pause actually flips (it animates in).
      if (!pp || playing !== (pp.playing && pp.current !== null)) this.playBtn.replaceChildren(icon(playing ? "pause" : "play"));
      const label = playing ? "Pause (Space)" : "Play (Space)";
      this.playBtn.setAttribute("aria-label", label);
      this.playBtn.title = label;
      this.artSlot.classList.toggle("is-playing", playing);
      this.el.classList.toggle("is-playing", playing);
    }

    if (!this.dragging && (!pp || p.positionMs !== pp.positionMs || p.current !== pp.current)) {
      this.seek.value = String(Math.floor(p.positionMs));
      this.elapsed.textContent = formatDuration(p.positionMs);
      setFill(this.seek);
    }

    if (!pp || p.loading !== pp.loading || p.current !== pp.current) {
      this.playBtn.classList.toggle("is-loading", p.loading);
      this.artist.classList.toggle("is-loading", p.loading);
      if (p.loading) this.artist.textContent = "Loading…";
      else this.artist.textContent = p.current ? p.current.artist : "Pick a track to start";
    }

    if (!pp || p.shuffle !== pp.shuffle) {
      this.shuffleBtn.classList.toggle("is-on", p.shuffle);
      this.shuffleBtn.setAttribute("aria-pressed", String(p.shuffle));
    }

    if (!pp || p.repeat !== pp.repeat) {
      this.repeatBtn.replaceChildren(icon(p.repeat === "one" ? "repeatOne" : "repeat"));
      this.repeatBtn.classList.toggle("is-on", p.repeat !== "off");
      this.repeatBtn.setAttribute("aria-pressed", String(p.repeat !== "off"));
      const label = `Repeat: ${p.repeat === "off" ? "off" : p.repeat === "all" ? "all" : "one"}`;
      this.repeatBtn.setAttribute("aria-label", label);
      this.repeatBtn.title = label;
    }

    if (!pp || p.volume !== pp.volume || p.muted !== pp.muted) {
      const silent = p.muted || p.volume === 0;
      this.muteBtn.replaceChildren(icon(silent ? "mute" : "volume"));
      this.muteBtn.setAttribute("aria-label", p.muted ? "Unmute" : "Mute");
      this.muteBtn.title = p.muted ? "Unmute" : "Mute";
      this.volume.value = String(Math.round((p.muted ? 0 : p.volume) * 100));
      setFill(this.volume);
    }

    if (!prev || s.queue.length !== prev.queue.length) {
      const n = s.queue.length;
      this.queueBtn.dataset.count = n > 999 ? "999+" : String(n);
      this.queueBtn.classList.toggle("has-count", n > 0);
      this.queueBtn.title = n ? `Up next (${n})` : "Up next";
    }
    if (!prev || s.queueOpen !== prev.queueOpen) {
      this.queueBtn.classList.toggle("is-on", s.queueOpen);
      this.queueBtn.setAttribute("aria-pressed", String(s.queueOpen));
    }

    const hasTrack = p.current !== null;
    this.prevBtn.disabled = !hasTrack;
    this.nextBtn.disabled = !hasTrack;
  }
}
