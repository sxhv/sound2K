// Compact always-available player shown in mini mode.
import { listen } from "@tauri-apps/api/event";
import { button, h } from "../lib/dom";
import { icon } from "../lib/icons";
import type { Player } from "../player/player";
import type { AppState, AppStore } from "../state";
import { toggleLike } from "../library";
import { setMarquee } from "../lib/marquee";
import { ArtBackdrop } from "./artBackdrop";
import { artwork, swapArt } from "./trackRow";

export class MiniPlayer {
  readonly el: HTMLElement;
  private readonly artSlot: HTMLElement;
  private readonly title: HTMLElement;
  private readonly artist: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly pinBtn: HTMLButtonElement;
  private readonly progress: HTMLElement;
  private readonly likeBtn: HTMLButtonElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly shuffleBtn: HTMLButtonElement;
  private readonly repeatBtn: HTMLButtonElement;
  private readonly volume: HTMLInputElement;
  private readonly lockBadge: HTMLElement;
  private readonly backdrop = new ArtBackdrop("mini-backdrop");

  constructor(store: AppStore, player: Player, visualizer: HTMLCanvasElement) {
    const drag = { "data-tauri-drag-region": "" };
    this.artSlot = h("div", { class: "mini-art", attrs: drag }, [artwork(null, "art-mini")]);
    this.title = h("div", { class: "mini-title", text: "Nothing playing", attrs: drag });
    this.artist = h("div", { class: "mini-artist", text: "", attrs: drag });
    this.progress = h("div", { class: "mini-progress-fill" });

    this.playBtn = button({ label: "Play (Space)", icon: "play", class: "play-orb mini-play", onClick: () => player.togglePlay() });
    this.pinBtn = button({
      label: "Keep on top",
      icon: "pin",
      class: "icon-btn toggle mini-small",
      onClick: () => store.set({ pinned: !store.get().pinned }),
    });
    this.likeBtn = button({
      label: "Like",
      icon: "heart",
      class: "icon-btn toggle mini-small mini-like",
      onClick: () => {
        const t = store.get().player.current;
        if (t) void toggleLike(store, t);
      },
    });
    this.muteBtn = button({ label: "Mute", icon: "volume", class: "icon-btn mini-mute", onClick: () => player.toggleMute() });
    this.shuffleBtn = button({ label: "Shuffle", icon: "shuffle", class: "icon-btn toggle mini-toggle", onClick: () => player.toggleShuffle() });
    this.repeatBtn = button({ label: "Repeat: off", icon: "repeat", class: "icon-btn toggle mini-toggle", onClick: () => player.cycleRepeat() });
    this.volume = h("input", {
      class: "range volume mini-volume",
      attrs: { type: "range", min: "0", max: "100", step: "1", "aria-label": "Volume" },
    });
    this.volume.addEventListener("input", () => {
      this.volume.style.setProperty("--pct", `${this.volume.value}%`);
      player.setVolume(Number(this.volume.value) / 100);
    });
    const expand = button({
      label: "Back to full player",
      icon: "expand",
      class: "icon-btn mini-small",
      onClick: () => store.set({ mini: false }),
    });

    // Shown while Ctrl+Alt+L click-through is on (clicks pass to the game).
    this.lockBadge = h("div", { class: "mini-lock", text: "Locked · Ctrl+Alt+L to unlock", attrs: { role: "status" } });
    this.lockBadge.hidden = true;
    void listen<boolean>("click-through", (e) => {
      this.lockBadge.hidden = !e.payload;
      this.el.classList.toggle("is-locked", e.payload);
    }).catch(() => undefined);

    this.el = h("section", { class: "mini-player glass-panel", attrs: { "aria-label": "Mini player", ...drag } }, [
      this.backdrop.el,
      visualizer,
      this.lockBadge,
      this.artSlot,
      h("div", { class: "mini-main", attrs: drag }, [
        h("div", { class: "mini-meta", attrs: drag }, [this.title, this.artist]),
        h("div", { class: "mini-progress", attrs: { "aria-hidden": "true" } }, [this.progress]),
        h("div", { class: "mini-volume-row" }, [this.muteBtn, this.volume, this.shuffleBtn, this.repeatBtn]),
      ]),
      h("div", { class: "mini-controls" }, [
        button({ label: "Previous", icon: "prev", class: "glass-btn round mini-round", onClick: () => player.prev() }),
        this.playBtn,
        button({ label: "Next", icon: "next", class: "glass-btn round mini-round", onClick: () => player.next() }),
      ]),
      h("div", { class: "mini-side" }, [this.likeBtn, this.pinBtn, expand]),
    ]);
  }

  update(s: AppState, prev: AppState | null): void {
    const p = s.player;
    const pp = prev?.player;
    if (!pp || p.current !== pp.current || p.loading !== pp.loading) {
      if (!pp || p.current !== pp.current) {
        if (pp) swapArt(this.artSlot, artwork(p.current, "art-mini"));
      else this.artSlot.replaceChildren(artwork(p.current, "art-mini"));
        setMarquee(this.title, p.current ? p.current.title : "Nothing playing");
        this.title.title = p.current?.title ?? "";
      }
      this.artist.textContent = p.loading ? "Loading…" : p.current?.artist ?? "";
    }
    if (!pp || p.current !== pp.current || s.artBackgrounds !== prev?.artBackgrounds) {
      this.backdrop.set(p.current, s.artBackgrounds);
    }
    if (!pp || p.playing !== pp.playing || p.current !== pp.current || p.loading !== pp.loading) {
      const playing = p.playing && p.current !== null;
      if (!pp || playing !== (pp.playing && pp.current !== null)) this.playBtn.replaceChildren(icon(playing ? "pause" : "play"));
      this.playBtn.setAttribute("aria-label", playing ? "Pause (Space)" : "Play (Space)");
      this.playBtn.classList.toggle("is-loading", p.loading);
      this.artSlot.classList.toggle("is-playing", playing);
    }
    if (!pp || p.positionMs !== pp.positionMs || p.current !== pp.current) {
      const pct = p.current && p.current.durationMs > 0 ? (p.positionMs / p.current.durationMs) * 100 : 0;
      this.progress.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    }
    if (!pp || p.shuffle !== pp.shuffle) {
      this.shuffleBtn.classList.toggle("is-on", p.shuffle);
      this.shuffleBtn.setAttribute("aria-pressed", String(p.shuffle));
      this.shuffleBtn.title = p.shuffle ? "Shuffle: on" : "Shuffle: off";
    }
    if (!pp || p.repeat !== pp.repeat) {
      this.repeatBtn.replaceChildren(icon(p.repeat === "one" ? "repeatOne" : "repeat"));
      this.repeatBtn.classList.toggle("is-on", p.repeat !== "off");
      this.repeatBtn.setAttribute("aria-pressed", String(p.repeat !== "off"));
      const label = p.repeat === "off" ? "Repeat: off" : p.repeat === "all" ? "Repeat: playlist" : "Repeat: this song";
      this.repeatBtn.setAttribute("aria-label", label);
      this.repeatBtn.title = label;
    }
    if (!pp || p.current !== pp.current || s.likedIds !== prev?.likedIds) {
      const liked = p.current !== null && s.likedIds.has(p.current.id);
      this.likeBtn.classList.toggle("is-on", liked);
      this.likeBtn.setAttribute("aria-pressed", String(liked));
      this.likeBtn.title = liked ? "Unlike" : "Like";
      this.likeBtn.disabled = p.current === null;
    }
    if (!pp || p.volume !== pp.volume || p.muted !== pp.muted) {
      const v = Math.round((p.muted ? 0 : p.volume) * 100);
      this.volume.value = String(v);
      this.volume.style.setProperty("--pct", `${v}%`);
      this.muteBtn.replaceChildren(icon(p.muted || p.volume === 0 ? "mute" : "volume"));
      this.muteBtn.title = p.muted ? "Unmute" : "Mute";
    }
    if (!prev || s.pinned !== prev.pinned) {
      this.pinBtn.classList.toggle("is-on", s.pinned);
      this.pinBtn.setAttribute("aria-pressed", String(s.pinned));
      this.pinBtn.title = s.pinned
        ? "Keep on top: on (won't steal focus from games; Ctrl+Alt+L locks clicks)"
        : "Keep on top: off";
    }
  }
}
