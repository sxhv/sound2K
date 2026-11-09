// Fixed-row-height virtualized list: only rows near the viewport exist in
// the DOM, so a 10,000-track library costs the same as a 30-track one.
import { h } from "../lib/dom";

const OVERSCAN = 6;

export class VirtualList<T> {
  readonly el: HTMLDivElement;
  private readonly sizer: HTMLDivElement;
  private readonly layer: HTMLDivElement;
  private items: readonly T[] = [];
  private rendered: { el: HTMLElement; item: T }[] = [];
  private start = -1;
  private end = -1;
  private frame = 0;

  constructor(
    private readonly rowHeight: number,
    private readonly renderRow: (item: T, index: number) => HTMLElement,
    /** Applies state classes (selected/playing) without rebuilding rows. */
    private readonly decorate: (el: HTMLElement, item: T) => void,
    label: string,
  ) {
    this.layer = h("div", { class: "vlist-layer" });
    this.sizer = h("div", { class: "vlist-sizer" }, [this.layer]);
    this.el = h("div", { class: "vlist", attrs: { role: "list", "aria-label": label } }, [this.sizer]);
    this.el.addEventListener("scroll", () => this.schedule(), { passive: true });
    new ResizeObserver(() => this.schedule()).observe(this.el);
  }

  setItems(items: readonly T[], resetScroll: boolean): void {
    this.items = items;
    this.sizer.style.height = `${items.length * this.rowHeight}px`;
    if (resetScroll) this.el.scrollTop = 0;
    this.start = -1;
    this.end = -1;
    this.render();
  }

  /** Index range fully on screen ([first, last], may be empty). */
  visibleRange(): [number, number] {
    const rh = this.rowHeight;
    const top = this.el.scrollTop;
    return [Math.ceil(top / rh), Math.floor((top + this.el.clientHeight) / rh) - 1];
  }

  /** Smoothly scroll so row `index` sits in the middle, then flash it. */
  scrollToIndex(index: number, flash: (el: HTMLElement) => void): void {
    const target = Math.max(0, index * this.rowHeight - (this.el.clientHeight - this.rowHeight) / 2);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Far away: hop most of the way instantly, then glide the last stretch.
    const view = this.el.clientHeight || 400;
    if (!reduce && Math.abs(this.el.scrollTop - target) > view * 2) {
      this.el.scrollTop = target + (this.el.scrollTop > target ? view : -view);
    }
    this.el.scrollTo({ top: target, behavior: reduce ? "auto" : "smooth" });
    const item = this.items[index];
    // Flash once the row exists (after the scroll settles).
    let tries = 0;
    const find = (): void => {
      const row = this.rendered.find((r) => r.item === item);
      if (row && Math.abs(this.el.scrollTop - target) < 4) flash(row.el);
      else if (tries++ < 60) requestAnimationFrame(find);
      else if (row) flash(row.el);
    };
    requestAnimationFrame(find);
  }

  /** Re-apply state classes to the rows currently on screen. */
  refresh(): void {
    for (const r of this.rendered) this.decorate(r.el, r.item);
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    const rh = this.rowHeight;
    const top = this.el.scrollTop;
    const viewHeight = this.el.clientHeight || window.innerHeight;
    const start = Math.max(0, Math.floor(top / rh) - OVERSCAN);
    const end = Math.min(this.items.length, Math.ceil((top + viewHeight) / rh) + OVERSCAN);
    if (start === this.start && end === this.end) return;
    this.start = start;
    this.end = end;

    const rows: { el: HTMLElement; item: T }[] = [];
    for (let i = start; i < end; i++) {
      const item = this.items[i];
      if (item === undefined) continue;
      const el = this.renderRow(item, i);
      this.decorate(el, item);
      rows.push({ el, item });
    }
    this.rendered = rows;
    this.layer.style.transform = `translateY(${start * rh}px)`;
    this.layer.replaceChildren(...rows.map((r) => r.el));
  }
}
