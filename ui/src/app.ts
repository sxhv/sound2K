// Builds the window layout and routes state changes to each component.
import { ArtBackdrop } from "./components/artBackdrop";
import { Dock } from "./components/dock";
import { NowPlaying } from "./components/nowPlaying";
import { QueueDrawer } from "./components/queueDrawer";
import { accentPalette, artColour } from "./lib/artwork";
import { Mascot } from "./components/mascot";
import { EqualizerPage } from "./views/equalizerPage";
import { SoundPage } from "./views/soundPage";
import { ArtistPage } from "./views/artistPage";
import { HomeView } from "./views/homeView";
import { SearchView } from "./views/searchView";
import { Tabs } from "./components/tabs";
import { Toolbar } from "./components/toolbar";
import { api } from "./api";
import { MiniPlayer } from "./components/miniPlayer";
import { Visualizer } from "./components/visualizer";
import { BeatAura } from "./components/beatAura";
import { attachThemeBehaviour, createThemeFx } from "./components/themeFx";
import { closePopover } from "./components/popover";
import { toast } from "./components/toast";
import { TopBar } from "./components/topBar";
import { errorMessage } from "./lib/errors";
import { windowControls } from "./lib/windowControls";
import { signIn, signOut, syncLibrary } from "./library";
import { h } from "./lib/dom";
import type { Player } from "./player/player";
import { closeToolPage, type AppState, type AppStore } from "./state";
import type { TabId } from "./types";
import { LikedView } from "./views/likedView";
import { PlaylistsView } from "./views/playlistsView";

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

/** Matte themes (no glass effects). */
const FLAT_THEMES: ReadonlySet<string> = new Set(["dark-orange", "oled", "winamp"]);

export function mountApp(root: HTMLElement, store: AppStore, player: Player, version: string): AppHandle {
  const visualizer = new Visualizer(store, (bars) => api.spectrum(bars));
  const tabs = new Tabs(store);
  const toolbar = new Toolbar(store);
  const searchView = new SearchView(store, player);
  const views: Record<TabId, View> = {
    home: new HomeView(store, player),
    search: searchView,
    liked: new LikedView(store, player),
    playlists: new PlaylistsView(store, player),
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
  const artistPage = new ArtistPage(store, player);
  const pages = h("div", { class: "pages" }, [eqPage.el, soundPage.el, artistPage.el]);
  // Glow around the window edges on drum hits (on top of everything, click-through).
  const aura = new BeatAura(visualizer);
  attachThemeBehaviour(visualizer);

  root.replaceChildren(backdrop.el, createThemeFx(), topBar.el, tabs.el, toolbar.el, content, pages, dock.el, nowPlaying.el, drawer.el, mini.el, aura.el);

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
    else if (s.page === "equalizer" || s.page === "sound") store.set(closeToolPage(s));
  });

  // Accent colours (buttons, glows, sliders, visualizer): the current
  // artwork's colour, the theme's own colour, or one you picked.
  let colourFor: string | null = null;
  const rootStyle = document.documentElement.style;
  const resetAccent = (): void => {
    for (const name of ["--accent", "--accent-light", "--accent-dark"]) rootStyle.removeProperty(name);
  };
  const applyColour = (s: AppState): void => {
    if (s.accentMode === "custom" && /^#[0-9a-f]{6}$/i.test(s.accentColor)) {
      const key = `custom:${s.accentColor}`;
      if (key === colourFor) return;
      colourFor = key;
      rootStyle.setProperty("--accent", s.accentColor);
      rootStyle.setProperty("--accent-light", `color-mix(in srgb, ${s.accentColor} 70%, #fff)`);
      rootStyle.setProperty("--accent-dark", `color-mix(in srgb, ${s.accentColor} 72%, #000)`);
      return;
    }
    const t = s.player.current;
    const key = s.accentMode === "song" && s.artBackgrounds && t ? t.id : null;
    if (key === colourFor) return;
    colourFor = key;
    if (!key || !t) {
      resetAccent(); // the theme's colour
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
    if (!prev || s.theme !== prev.theme) {
      document.documentElement.dataset.theme = s.theme;
      document.documentElement.dataset.style = FLAT_THEMES.has(s.theme) ? "flat" : "glass";
    }
    if (!prev || s.glass !== prev.glass) rootStyle.setProperty("--glass-k", String(s.glass));
    if (!prev) {
      document.documentElement.classList.toggle("is-mini", s.mini);
    } else if (s.mini !== prev.mini) {
      closePopover();
      void switchMode(s.mini, s.pinned);
    } else if (s.pinned !== prev.pinned) {
      windowControls.setMode(s.mini, s.pinned).catch((err: unknown) => toast(`Couldn't resize the window: ${errorMessage(err)}`, "error"));
    }
    if (
      !prev ||
      s.player.current !== prev.player.current ||
      s.artBackgrounds !== prev.artBackgrounds ||
      s.theme !== prev.theme ||
      s.accentMode !== prev.accentMode ||
      s.accentColor !== prev.accentColor
    ) {
      // The Song theme always shows the artwork behind the window.
      backdrop.set(s.player.current, s.artBackgrounds || s.theme === "song");
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
      artistPage.el.hidden = s.page !== "artist";
      pages.classList.toggle("is-artist", s.page === "artist");
    }
    if (!prev || s.mascot !== prev.mascot) html.classList.toggle("no-mascot", !s.mascot);
    if (!prev || s.player !== prev.player || s.likedIds !== prev.likedIds) {
      titleCat.update(s);
      npCat.update(s);
      miniCat.update(s);
    }
    eqPage.update(s, prev);
    if (s.page === "artist") artistPage.update(s, prev);
    soundPage.update(s, prev);
    dock.update(s, prev);
    nowPlaying.update(s, prev);
    drawer.update(s, prev);
    aura.update(s, prev);
  };
  store.subscribe(render);
  render(store.get(), null);

  function jumpToPlaying(): void {
    const s = store.get();
    const current = s.player.current;
    if (!current) return;
    if (s.page === "artist" && !s.nowPlayingOpen && artistPage.jumpToCurrent()) return;
    if (s.nowPlayingOpen || s.page !== "library") store.set({ nowPlayingOpen: false, page: "library" });
    if (views[s.tab].jumpToCurrent?.()) return;
    if (s.likedIds.has(current.id)) {
      store.set({ tab: "liked", search: "", page: "library" });
      requestAnimationFrame(() => views.liked.jumpToCurrent?.());
    }
  }

  return {
    focusSearch: () => (store.get().tab === "search" && store.get().page === "library" ? searchView.focus() : toolbar.focusSearch()),
    jumpToPlaying,
  };
}
