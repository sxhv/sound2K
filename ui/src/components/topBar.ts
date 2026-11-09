import { button, h } from "../lib/dom";
import { windowControls } from "../lib/windowControls";
import { icon } from "../lib/icons";
import type { AppState, AppStore } from "../state";
import type { Theme } from "../types";
import { api, errorMessage } from "../api";
import { formatBytes } from "../lib/format";
import { toast } from "./toast";
import { checkForUpdate, installUpdate, openUpdate } from "../updates";
import { closePopover, isPopoverOpenFor, openPopover } from "./popover";

const THEMES: readonly { id: Theme; label: string }[] = [
  { id: "orange-glass", label: "Glass" },
  { id: "dark-orange", label: "Dark" },
];

export interface AccountActions {
  signIn(): void;
  signOut(): void;
  sync(): void;
}

export class TopBar {
  readonly el: HTMLElement;
  private readonly pill: HTMLElement;
  private readonly avatar: HTMLElement;
  private readonly gear: HTMLButtonElement;
  private readonly eqBtn: HTMLButtonElement;
  private readonly soundBtn: HTMLButtonElement;
  /** A Discord app id is built in (see src-tauri/src/discord.rs). */
  private discordAvailable = false;

  constructor(
    private readonly store: AppStore,
    readonly version: string,
    private readonly actions: AccountActions,
  ) {
    // The window has no native frame: this bar is its title bar. Elements
    // marked data-tauri-drag-region move the window (double-click maximizes).
    const drag = { "data-tauri-drag-region": "" };
    // The Sound2K wordmark (ui/public/wordmark.png) is used as a CSS mask so
    // it takes the theme's orange gradient.
    const wordmark = h("div", { class: "wordmark", attrs: { role: "img", "aria-label": "Sound2K", ...drag } });
    this.pill = h("span", { class: "mode-pill" });
    const title = h("div", { class: "app-title", attrs: drag }, [
      wordmark,
      this.pill,
    ]);
    this.avatar = h("button", { class: "avatar", attrs: { type: "button" } });
    this.avatar.addEventListener("click", () => this.toggleSettings());
    this.gear = h(
      "button",
      { class: "glass-btn icon-only", attrs: { type: "button", "aria-label": "Settings", title: "Settings", "aria-haspopup": "dialog", "aria-expanded": "false" } },
      [icon("gear")],
    );
    this.gear.addEventListener("click", () => this.toggleSettings());
    api.discordAvailable().then(
      (yes) => (this.discordAvailable = yes),
      () => undefined,
    );
    // Pages: Equalizer and Sound (crossfade, levelling). Click again to go back.
    const togglePage = (page: "equalizer" | "sound"): void => {
      const s = this.store.get();
      this.store.set({ page: s.page === page ? "library" : page, nowPlayingOpen: false });
    };
    this.eqBtn = button({ label: "Equalizer", icon: "sliders", class: "glass-btn icon-only page-btn", onClick: () => togglePage("equalizer") });
    this.soundBtn = button({ label: "Crossfade & levelling", icon: "wave", class: "glass-btn icon-only page-btn", onClick: () => togglePage("sound") });
    const windowButtons = h("div", { class: "window-buttons" }, [
      button({ label: "Minimize", icon: "winMin", class: "win-btn", onClick: () => void windowControls.minimize() }),
      button({ label: "Maximize / restore", icon: "winMax", class: "win-btn", onClick: () => void windowControls.toggleMaximize() }),
      button({ label: "Close", icon: "winClose", class: "win-btn win-close", onClick: () => void windowControls.close() }),
    ]);
    this.el = h("header", { class: "topbar", attrs: drag }, [
      title,
      h("div", { class: "spacer", attrs: drag }),
      this.eqBtn,
      this.soundBtn,
      this.avatar,
      this.gear,
      windowButtons,
    ]);
  }

  private toggleSettings(): void {
    if (isPopoverOpenFor(this.gear)) {
      closePopover();
      return;
    }
    openPopover(this.gear, this.buildSettingsPanel(), { align: "end", className: "popover-wide" });
  }

  update(s: AppState, prev: AppState | null): void {
    if (!prev || s.update !== prev.update) {
      this.gear.classList.toggle("has-dot", s.update !== null);
      this.gear.title = s.update ? `Settings · update v${s.update.latest} available` : "Settings";
    }
    if (!prev || s.page !== prev.page || s.eqEnabled !== prev.eqEnabled) {
      this.eqBtn.classList.toggle("is-active", s.page === "equalizer");
      this.eqBtn.setAttribute("aria-pressed", String(s.page === "equalizer"));
      this.eqBtn.classList.toggle("has-dot", s.eqEnabled);
      this.soundBtn.classList.toggle("is-active", s.page === "sound");
      this.soundBtn.setAttribute("aria-pressed", String(s.page === "sound"));
    }
    if (!prev || s.account !== prev.account || s.syncing !== prev.syncing || s.signingIn !== prev.signingIn) {
      const label = s.signingIn ? "Signing in…" : s.syncing ? "Syncing…" : s.account ? "" : "Sample library";
      this.pill.textContent = label;
      this.pill.hidden = label === "";
      this.pill.classList.toggle("is-busy", s.syncing || s.signingIn);
      this.pill.title = s.account ? "" : "Not signed in: showing built-in sample tracks";
    }
    if (!prev || s.account !== prev.account) {
      const a = s.account;
      const label = a ? `Signed in as ${a.username}` : "Not signed in";
      this.avatar.setAttribute("aria-label", `${label}. Open account settings`);
      this.avatar.title = label;
      if (a?.avatarUrl) {
        const img = h("img", { attrs: { src: a.avatarUrl, alt: "", decoding: "async" } });
        img.addEventListener("error", () => this.avatar.replaceChildren(icon("user")));
        this.avatar.replaceChildren(img);
      } else {
        this.avatar.replaceChildren(icon("user"));
      }
    }
  }

  private buildSettingsPanel(): HTMLElement {
    const s = this.store.get();
    const choices = h("div", { class: "theme-choices", attrs: { role: "radiogroup", "aria-label": "Theme" } });
    const renderThemes = (): void => {
      const current = this.store.get().theme;
      choices.replaceChildren(
        ...THEMES.map((t) => {
          const selected = t.id === current;
          const b = h(
            "button",
            { class: `theme-choice theme-swatch-${t.id}${selected ? " is-selected" : ""}`, attrs: { type: "button", role: "radio", "aria-checked": String(selected) } },
            [h("span", { class: "swatch", attrs: { "aria-hidden": "true" } }), h("span", { class: "theme-name", text: t.label })],
          );
          b.addEventListener("click", () => {
            this.store.set({ theme: t.id });
            renderThemes();
          });
          return b;
        }),
      );
    };
    renderThemes();

    const account: HTMLElement[] = [];
    if (s.account) {
      const signOut = h("button", { class: "glass-btn small", text: "Sign out", attrs: { type: "button" } });
      signOut.addEventListener("click", () => {
        closePopover();
        this.actions.signOut();
      });
      const refresh = h("button", { class: "glass-btn small", text: s.syncing ? "Syncing…" : "Refresh library", attrs: { type: "button" } });
      refresh.disabled = s.syncing;
      refresh.addEventListener("click", () => {
        closePopover();
        this.actions.sync();
      });
      account.push(
        h("p", { text: `Signed in as ${s.account.username}` }),
        h("div", { class: "button-row" }, [refresh, signOut]),
      );
    } else {
      const signIn = h("button", { class: "glass-btn accent small", text: s.signingIn ? "Waiting for sign-in…" : "Sign in to SoundCloud", attrs: { type: "button" } });
      signIn.disabled = s.signingIn;
      signIn.addEventListener("click", () => {
        closePopover();
        this.actions.signIn();
      });
      account.push(signIn);
    }

    return h("div", { class: "settings-panel", attrs: { role: "dialog", "aria-label": "Settings" } }, [
      h("h3", { text: "Account" }),
      ...account,
      h("h3", { text: "Playback" }),
      ...this.buildPlaybackSettings(),
      h("h3", { text: "Theme" }),
      choices,
      h("h3", { text: "Storage" }),
      ...this.buildStorageSettings(),
      h("h3", { text: "About" }),
      ...this.buildAboutSettings(),
    ]);
  }

  private buildAboutSettings(): HTMLElement[] {
    const s = this.store.get();
    const status = h("p", { class: "small", text: s.update ? `v${s.update.latest} available` : `Sound2K v${this.version}` });
    const check = h("button", { class: "glass-btn small", text: "Check for updates", attrs: { type: "button" } });
    const get = h("button", { class: "glass-btn accent small", text: "Update & restart", attrs: { type: "button" } });
    get.hidden = !s.update;
    get.addEventListener("click", () => {
      get.disabled = true;
      check.disabled = true;
      get.textContent = "Downloading…";
      void installUpdate((pct) => {
        get.textContent = pct === null ? "Downloading…" : pct >= 100 ? "Installing…" : `Downloading ${pct}%`;
      }).finally(() => {
        // Only reached if the update failed (otherwise the app restarts).
        get.disabled = false;
        check.disabled = false;
        get.textContent = "Update & restart";
      });
    });
    const notes = h("button", { class: "link-btn small", text: "What's new", attrs: { type: "button" } });
    notes.hidden = !s.update?.url;
    notes.addEventListener("click", () => openUpdate(this.store));
    check.addEventListener("click", () => {
      check.disabled = true;
      check.textContent = "Checking…";
      void checkForUpdate(this.store, true).finally(() => {
        check.disabled = false;
        check.textContent = "Check for updates";
        const u = this.store.get().update;
        if (u) {
          status.textContent = `v${u.latest} available`;
          get.hidden = false;
          notes.hidden = !u.url;
        }
      });
    });
    const auto = h("input", { attrs: { type: "checkbox" } });
    auto.checked = s.updateCheck;
    auto.addEventListener("change", () => this.store.set({ updateCheck: auto.checked }));
    return [
      h("div", { class: "button-row storage-row" }, [status, notes]),
      h("div", { class: "button-row" }, [get, check]),
      h("label", { class: "check" }, [auto, h("span", { text: "Check on launch" })]),
    ];
  }

  private buildStorageSettings(): HTMLElement[] {
    const summary = h("p", { class: "small", text: "Checking…" });
    const clear = h("button", { class: "glass-btn small", text: "Clear cache", attrs: { type: "button" } });
    const refresh = async (): Promise<void> => {
      try {
        const info = await api.storageInfo();
        summary.textContent = `Using ${formatBytes(info.total)}`;
        summary.title = info.folder;
      } catch (e) {
        summary.textContent = `Couldn't read storage: ${errorMessage(e)}`;
      }
    };
    clear.addEventListener("click", () => {
      clear.disabled = true;
      api
        .clearCache()
        .then(() => toast("Cache cleared. You're still signed in."))
        .catch((e) => toast(`Couldn't clear cache: ${errorMessage(e)}`, "error"))
        .finally(() => {
          clear.disabled = false;
          void refresh();
        });
    });
    void refresh();
    return [h("div", { class: "button-row storage-row" }, [summary, clear])];
  }

  private buildPlaybackSettings(): HTMLElement[] {
    const s = this.store.get();
    const toggle = (label: string, checked: boolean, onChange: (on: boolean) => void): HTMLElement => {
      const input = h("input", { attrs: { type: "checkbox" } });
      input.checked = checked;
      input.addEventListener("change", () => onChange(input.checked));
      return h("label", { class: "check" }, [input, h("span", { text: label })]);
    };
    return [
      toggle("Autoplay similar tracks", s.autoplay, (on) => this.store.set({ autoplay: on })),
      toggle("Visualizer", s.visualizer, (on) => this.store.set({ visualizer: on })),
      toggle("Artwork colours", s.artBackgrounds, (on) => this.store.set({ artBackgrounds: on })),
      toggle("Cat mascot", s.mascot, (on) => this.store.set({ mascot: on })),
      ...(this.discordAvailable ? [toggle("Discord status", s.discordStatus, (on) => this.store.set({ discordStatus: on }))] : []),
    ];
  }
}
