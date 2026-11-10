// Search field + Sort and Filter dropdowns + removable filter chips.
import { h } from "../lib/dom";
import {
  FILTER_LABELS,
  SORT_LABELS,
  SORT_ORDER,
  filterChips,
  hasLikedDates,
  uniqueArtists,
} from "../lib/filterSort";
import { icon } from "../lib/icons";
import { DEFAULT_FILTERS, type AppState, type AppStore } from "../state";
import type { BoolFilterKey, FilterPrefs, Track } from "../types";
import { closePopover, isPopoverOpenFor, openPopover } from "./popover";

const SEARCH_DEBOUNCE_MS = 80;

function trackSource(s: AppState): readonly Track[] {
  if (s.tab === "playlists") return s.openPlaylist?.tracks ?? [];
  return s.liked;
}

function showsTrackControls(s: AppState): boolean {
  return s.tab === "liked" || (s.tab === "playlists" && s.openPlaylist !== null);
}

export class Toolbar {
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly sortBtn: HTMLButtonElement;
  private readonly sortLabel: HTMLElement;
  private readonly filterBtn: HTMLButtonElement;
  private readonly filterCount: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly chips: HTMLElement;
  private debounce = 0;

  constructor(private readonly store: AppStore) {
    this.input = h("input", {
      class: "search-input",
      attrs: { type: "search", placeholder: "Search", "aria-label": "Search", spellcheck: "false", autocomplete: "off" },
    });
    this.input.addEventListener("input", () => {
      window.clearTimeout(this.debounce);
      this.debounce = window.setTimeout(() => store.set({ search: this.input.value }), SEARCH_DEBOUNCE_MS);
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.input.value) {
        e.stopPropagation();
        this.input.value = "";
        store.set({ search: "" });
      }
    });
    const search = h("label", { class: "search glass-field" }, [icon("search"), this.input]);

    this.sortLabel = h("span");
    this.sortBtn = h(
      "button",
      { class: "glass-btn dropdown-btn", attrs: { type: "button", "aria-haspopup": "true", "aria-expanded": "false", title: "Sort" } },
      [icon("sort"), this.sortLabel, icon("chevron")],
    );
    this.sortBtn.addEventListener("click", () => this.toggleSort());

    this.filterCount = h("span", { class: "count-badge" });
    this.filterBtn = h(
      "button",
      { class: "glass-btn dropdown-btn", attrs: { type: "button", "aria-haspopup": "true", "aria-expanded": "false", title: "Filters" } },
      [icon("filter"), h("span", { text: "Filters" }), this.filterCount, icon("chevron")],
    );
    this.filterBtn.addEventListener("click", () => this.toggleFilters());

    this.controls = h("div", { class: "toolbar-controls" }, [this.sortBtn, this.filterBtn]);
    this.chips = h("div", { class: "chips", attrs: { "aria-label": "Active filters" } });
    this.el = h("div", { class: "toolbar" }, [h("div", { class: "toolbar-row" }, [search, this.controls]), this.chips]);
  }

  focusSearch(): void {
    if (this.el.hidden) return;
    this.input.focus();
    this.input.select();
  }

  private setFilters(patch: Partial<FilterPrefs>): void {
    this.store.set({ filters: { ...this.store.get().filters, ...patch } });
  }

  private toggleSort(): void {
    if (isPopoverOpenFor(this.sortBtn)) {
      closePopover();
      return;
    }
    const current = this.store.get().sort;
    const list = h("div", { class: "menu", attrs: { role: "menu" } });
    for (const key of SORT_ORDER) {
      const checked = key === current;
      const b = h("button", {
        class: `menu-item${checked ? " is-checked" : ""}`,
        text: SORT_LABELS[key],
        attrs: { type: "button", role: "menuitemradio", "aria-checked": String(checked) },
      });
      b.addEventListener("click", () => {
        closePopover();
        this.store.set({ sort: key });
      });
      list.append(b);
    }
    openPopover(this.sortBtn, list);
  }

  private toggleFilters(): void {
    if (isPopoverOpenFor(this.filterBtn)) {
      closePopover();
      return;
    }
    const s = this.store.get();
    const source = trackSource(s);
    const datesKnown = hasLikedDates(source);

    const check = (key: BoolFilterKey, disabled = false, hint?: string): HTMLElement => {
      const input = h("input", { attrs: { type: "checkbox" } });
      input.checked = this.store.get().filters[key];
      input.disabled = disabled;
      input.addEventListener("change", () => this.setFilters({ [key]: input.checked }));
      const label = h("label", { class: `check${disabled ? " is-disabled" : ""}` }, [input, h("span", { text: FILTER_LABELS[key] })]);
      if (hint) label.title = hint;
      return label;
    };

    const artists = uniqueArtists(source);
    const artistInput = h("input", {
      class: "glass-field field-input",
      attrs: { type: "text", list: "artist-options", placeholder: "Any artist", spellcheck: "false", autocomplete: "off", "aria-label": "Artist" },
    });
    artistInput.value = s.filters.artist ?? "";
    const datalist = h("datalist", { attrs: { id: "artist-options" } }, artists.map((a) => h("option", { attrs: { value: a } })));
    const artistHint = h("span", { class: "field-hint" });
    const applyArtist = (): void => {
      const value = artistInput.value.trim();
      if (value === "") {
        artistHint.textContent = "";
        this.setFilters({ artist: null });
      } else if (artists.includes(value)) {
        artistHint.textContent = "";
        this.setFilters({ artist: value });
      } else {
        artistHint.textContent = "No artist with that name in this list.";
      }
    };
    artistInput.addEventListener("change", applyArtist);
    artistInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") applyArtist();
    });

    const panel = h("div", { class: "filter-panel" }, [
      check("playableOnly"),
      check("under3"),
      check("over5"),
      check("recent", !datesKnown, datesKnown ? undefined : "Like dates aren't available for this list."),
      h("div", { class: "field" }, [h("span", { class: "field-label", text: "Artist" }), artistInput, datalist, artistHint]),
    ]);
    openPopover(this.filterBtn, panel, { className: "popover-wide" });
  }

  private renderChips(filters: FilterPrefs): void {
    const chips = filterChips(filters);
    this.chips.replaceChildren(
      ...chips.map((chip) => {
        const b = h(
          "button",
          { class: "chip", attrs: { type: "button", "aria-label": `Remove filter: ${chip.label}`, title: "Remove filter" } },
          [h("span", { text: chip.label }), icon("close")],
        );
        b.addEventListener("click", () =>
          this.setFilters(chip.key === "artist" ? { artist: null } : { [chip.key]: false }),
        );
        return b;
      }),
    );
    if (chips.length > 0) {
      const clear = h("button", { class: "chip-clear", text: "Clear filters", attrs: { type: "button" } });
      clear.addEventListener("click", () => this.store.set({ filters: { ...DEFAULT_FILTERS } }));
      this.chips.append(clear);
    }
  }

  update(s: AppState, prev: AppState | null): void {
    // Queue has its own controls; Search has its own search box.
    this.el.hidden = s.tab === "queue" || s.tab === "search" || s.tab === "home";
    const trackControls = showsTrackControls(s);
    this.controls.hidden = !trackControls;

    this.input.placeholder =
      s.tab === "playlists" && !s.openPlaylist
        ? "Search playlists"
        : s.tab === "recent"
          ? "Search recently played"
          : "Search title or artist";
    if ((!prev || s.search !== prev.search) && this.input.value !== s.search) this.input.value = s.search;

    if (!prev || s.sort !== prev.sort) this.sortLabel.textContent = SORT_LABELS[s.sort];
    if (!prev || s.filters !== prev.filters) {
      const active = filterChips(s.filters).length;
      this.filterCount.textContent = active > 0 ? String(active) : "";
      this.filterCount.hidden = active === 0;
      this.filterBtn.classList.toggle("is-active", active > 0);
      this.renderChips(s.filters);
    }
    this.chips.hidden = !trackControls || this.chips.childElementCount === 0;
  }
}
