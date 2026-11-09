// Builds the window layout and routes state changes to each component.
import { ArtBackdrop } from "./components/artBackdrop";
import { Dock } from "./components/dock";
import { NowPlaying } from "./components/nowPlaying";
import { QueueDrawer } from "./components/queueDrawer";
import { accentPalette, artColour } from "./lib/artwork";
import { Mascot } from "./components/mascot";
import { EqualizerPage } from "./views/equalizerPage";
import { SoundPage } from "./views/soundPage";
import { Tabs } from "./components/tabs";
import { Toolbar } from "./components/toolbar";
import { api } from "./api";
import { MiniPlayer } from "./components/miniPlayer";
import { Visualizer } from "./components/visualizer";
import { closePopover } from "./components/popover";
import { toast } from "./components/toast";
import { TopBar } from "./components/topBar";
import { errorMessage } from "./lib/errors";
import { windowControls } from "./lib/windowControls";
import { signIn, signOut, syncLibrary } from "./library";
import { h } from "./lib/dom";
import type { Player } from "./player/player";
import type { AppState, AppStore } from "./state";
import type { TabId } from "./types";
import { LikedView } from "./views/likedView";
import { PlaylistsView } from "./views/playlistsView";
import { QueueView } from "./views/queueView";
import { RecentView } from "./views/recentView";

interface View {
  readonly el: HTMLElement;
  update(s: AppState, prev: AppState | null): void;
  /** Scroll to the playing track if it's in this view's list. */
  jumpToCurrent?(): boolean;
}

export interface AppHandle {
  focusSearch(): void;
  jumpToPlaying(): void;
}

export function mountApp(root: HTMLElement, store: AppStore, player: Player, version: string): AppHandle {
  const visualizer = new Visualizer(store, (bars) => api.spectrum(bars));
  const tabs = new Tabs(store);
  const toolbar = new Toolbar(store);
  const views: Record<TabId, View> = {
    liked: new LikedView(store, player),
    playlists: new PlaylistsView(store, player),
    queue: new QueueView(store, player),
    recent: new RecentView(store, player),
  };
  const dock = new Dock(store, player, visualizer.createCanvas("visualizer-dock"));
  const content = h("main", { class: "content" }, Object.values(views).map((v) => v.el));

  const topBar = new TopBar(store, version, {
    signIn: () => void signIn(store, player),
    signOut: () => void signOut(store, player),
    sync: () => void syncLibrary(store),
  });

  const mini = new MiniPlayer(store, player, visualizer.createCanvas("visualizer-mini"));

  const backdrop = new ArtBackdrop("app-backdrop");
  const nowPlaying = new NowPlaying(store, player);
  const drawer = new QueueDrawer(store, player);

  // The cat: dances in the title bar, and keeps you company in Now Playing.
  const titleCat = new Mascot(visualizer, "mascot-title", "♪");
  topBar.el.querySelector(".app-title")?.append(titleCat.el);
  const npCat = new Mascot(visualizer, "mascot-np");
  nowPlaying.el.append(npCat.el);
  const miniCat = new Mascot(visualizer, "mascot-mini");
  mini.el.append(miniCat.el);

  const eqPage = new EqualizerPage(store);
  const soundPage = new SoundPage(store);
  const pages = h("div", { class: "pages" }, [eqPage.el, soundPage.el]);

  root.replaceChildren(backdrop.el, topBar.el, tabs.el, toolbar.el, content, pages, dock.el, nowPlaying.el, drawer.el, mini.el);

  // Overlays sit below the custom title bar, so the window buttons stay usable.
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--topbar-h", `${topBar.el.offsetHeight}px`);
  }).observe(topBar.el);

  // Ctrl+J: jump to the playing song in the current list (or Liked Songs).
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey && (e.key === "j" || e.key === "J"))) return;
    e.preventDefault();
    jumpToPlaying();
  });

  // Esc closes Now Playing / the queue panel (menus handle Esc themselves).
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || document.querySelector(".popover")) return;
    const s = store.get();
    if (s.queueOpen) store.set({ queueOpen: false });
    else if (s.nowPlayingOpen) store.set({ nowPlayingOpen: false });
  });

  // Accent colours (buttons, glows, sliders, visualizer) follow the current
  // artwork; Sound2K orange when there's no colourful cover.
  let colourFor: string | null = null;
  const rootStyle = document.documentElement.style;
  const resetAccent = (): void => {
    for (const name of ["--accent", "--accent-light", "--accent-dark"]) rootStyle.removeProperty(name);
  };
  const applyColour = (s: AppState): void => {
    const t = s.player.current;
    const key = s.artBackgrounds && t ? t.id : null;
    if (key === colourFor) return;
    colourFor = key;
    if (!key || !t) {
      resetAccent();
      return;
    }
    void artColour(t.artworkUrl, (src) => api.artworkColour(src)).then((rgb) => {
      if (colourFor !== key) return;
      if (!rgb) return resetAccent();
      const p = accentPalette(rgb);
      rootStyle.setProperty("--accent", p.accent);
      rootStyle.setProperty("--accent-light", p.light);
      rootStyle.setProperty("--accent-dark", p.dark);
    });
  };

  // Mini ⇄ full: fade the contents out, let Rust glide the window to its
  // new size, swap the layout, then pop the new layout in.
  let modeSwitch = 0;
  const html = document.documentElement;
  const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));
  async function switchMode(mini: boolean, pinned: boolean): Promise<void> {
    const token = ++modeSwitch;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    html.classList.remove("mode-in");
    if (!reduce) {
      html.classList.add("mode-out");
      await wait(150);
    }
    if (token !== modeSwitch) return;
    try {
      await windowControls.setMode(mini, pinned);
    } catch (err) {
      toast(`Couldn't resize the window: ${errorMessage(err)}`, "error");
    }
    if (token !== modeSwitch) return;
    html.classList.toggle("is-mini", mini);
    html.classList.remove("mode-out");
    if (!reduce) {
      void html.offsetWidth;
      html.classList.add("mode-in");
      await wait(450);
      if (token === modeSwitch) html.classList.remove("mode-in");
    }
  }

  const render = (s: AppState, prev: AppState | null): void => {
    if (!prev || s.theme !== prev.theme) document.documentElement.dataset.theme = s.theme;
    if (!prev) {
      document.documentElement.classList.toggle("is-mini", s.mini);
    } else if (s.mini !== prev.mini) {
      closePopover();
      void switchMode(s.mini, s.pinned);
    } else if (s.pinned !== prev.pinned) {
      windowControls.setMode(s.mini, s.pinned).catch((err: unknown) => toast(`Couldn't resize the window: ${errorMessage(err)}`, "error"));
    }
    if (!prev || s.player.current !== prev.player.current || s.artBackgrounds !== prev.artBackgrounds) {
      backdrop.set(s.player.current, s.artBackgrounds);
      applyColour(s);
    }
    // Close overlays when they no longer make sense (deferred: we're inside a render).
    if ((s.nowPlayingOpen && (s.mini || s.player.current === null)) || (s.queueOpen && s.mini)) {
      queueMicrotask(() => store.set({ nowPlayingOpen: false, queueOpen: false }));
    }
    mini.update(s, prev);
    visualizer.update(s, prev);
    if (!prev || s.tab !== prev.tab) {
      for (const [id, view] of Object.entries(views)) view.el.hidden = id !== s.tab;
    }
    topBar.update(s, prev);
    tabs.update(s, prev);
    toolbar.update(s, prev);
    for (const view of Object.values(views)) view.update(s, prev);
    if (!prev || s.page !== prev.page) {
      const library = s.page === "library";
      // Toolbar and library views stay in the DOM (keeping scroll positions).
      root.classList.toggle("is-page", !library);
      pages.hidden = library;
      eqPage.el.hidden = s.page !== "equalizer";
      soundPage.el.hidden = s.page !== "sound";
    }
    if (!prev || s.mascot !== prev.mascot) html.classList.toggle("no-mascot", !s.mascot);
    if (!prev || s.player !== prev.player || s.likedIds !== prev.likedIds) {
      titleCat.update(s);
      npCat.update(s);
      miniCat.update(s);
    }
    eqPage.update(s, prev);
    soundPage.update(s, prev);
    dock.update(s, prev);
    nowPlaying.update(s, prev);
    drawer.update(s, prev);
  };
  store.subscribe(render);
  render(store.get(), null);

  function jumpToPlaying(): void {
    const s = store.get();
    const current = s.player.current;
    if (!current) return;
    if (s.nowPlayingOpen || s.page !== "library") store.set({ nowPlayingOpen: false, page: "library" });
    if (views[s.tab].jumpToCurrent?.()) return;
    if (s.likedIds.has(current.id)) {
      store.set({ tab: "liked", search: "", page: "library" });
      requestAnimationFrame(() => views.liked.jumpToCurrent?.());
    }
  }

  return { focusSearch: () => toolbar.focusSearch(), jumpToPlaying };
}
