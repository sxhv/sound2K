// One floating panel at a time: dropdowns, overflow menus, settings.
import { h } from "../lib/dom";

interface OpenState {
  el: HTMLElement;
  anchor: HTMLElement;
  onClose?: () => void;
}

let current: OpenState | null = null;

export function isPopoverOpenFor(anchor: HTMLElement): boolean {
  return current?.anchor === anchor;
}

export function closePopover(): void {
  const open = current;
  if (!open) return;
  current = null;
  open.el.remove();
  open.anchor.setAttribute("aria-expanded", "false");
  open.onClose?.();
}

export interface PopoverOptions {
  className?: string;
  align?: "start" | "end";
  onClose?: () => void;
}

export function openPopover(anchor: HTMLElement, content: HTMLElement, opts: PopoverOptions = {}): HTMLElement {
  closePopover();
  const el = h("div", { class: `popover glass-panel ${opts.className ?? ""}` }, [content]);
  document.body.append(el);
  position(el, anchor, opts.align ?? "start");
  anchor.setAttribute("aria-expanded", "true");
  current = { el, anchor };
  if (opts.onClose) current.onClose = opts.onClose;
  el.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled])")?.focus({ preventScroll: true });
  return el;
}

function position(el: HTMLElement, anchor: HTMLElement, align: "start" | "end"): void {
  const r = anchor.getBoundingClientRect();
  const margin = 8;
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  let left = align === "end" ? r.right - width : r.left;
  left = Math.min(Math.max(margin, left), window.innerWidth - width - margin);
  let top = r.bottom + 6;
  if (top + height > window.innerHeight - margin) top = Math.max(margin, r.top - height - 6);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export interface MenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
}

/** Simple action menu anchored to a button. Clicking the anchor again closes it. */
export function showMenu(anchor: HTMLElement, items: readonly MenuItem[]): void {
  if (isPopoverOpenFor(anchor)) {
    closePopover();
    return;
  }
  const list = h("div", { class: "menu", attrs: { role: "menu" } });
  for (const item of items) {
    const b = h("button", { class: "menu-item", text: item.label, attrs: { type: "button", role: "menuitem" } });
    b.disabled = item.disabled === true;
    b.addEventListener("click", () => {
      closePopover();
      item.action();
    });
    list.append(b);
  }
  openPopover(anchor, list, { align: "end" });
}

// Close on outside press, Escape, resize, or scrolling elsewhere.
document.addEventListener(
  "pointerdown",
  (e) => {
    if (!current) return;
    const target = e.target as Node | null;
    if (target && (current.el.contains(target) || current.anchor.contains(target))) return;
    closePopover();
  },
  true,
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && current) {
    const anchor = current.anchor;
    closePopover();
    anchor.focus();
  }
});
window.addEventListener("resize", () => closePopover());
document.addEventListener(
  "wheel",
  (e) => {
    if (current && !current.el.contains(e.target as Node)) closePopover();
  },
  { passive: true, capture: true },
);
