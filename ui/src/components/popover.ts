// One floating panel at a time: dropdowns, overflow menus, settings.
import { h } from "../lib/dom";
import { icon, type IconName } from "../lib/icons";

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
  let lastGroup: number | null = null;
  for (const item of items) {
    // Thin divider between groups (playback / library / links / remove).
    const look = menuLook(item.label);
    if (lastGroup !== null && look.group !== lastGroup) list.append(h("div", { class: "menu-sep", attrs: { role: "separator" } }));
    lastGroup = look.group;
    const b = h("button", { class: `menu-item${look.danger ? " is-danger" : ""}`, attrs: { type: "button", role: "menuitem" } }, [
      h("span", { class: "menu-icon", attrs: { "aria-hidden": "true" } }, look.icon ? [icon(look.icon)] : []),
      h("span", { class: "menu-label", text: item.label }),
    ]);
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

/** Icon, group and colour for a menu item, from its label. Works for any
 * menu without each one listing icons. */
const LOOKS: readonly { test: RegExp; icon: IconName | null; group: number; danger?: boolean }[] = [
  { test: /^play next/i, icon: "next", group: 0 },
  { test: /^(play|shuffle)/i, icon: "play", group: 0 },
  { test: /queue/i, icon: "queue", group: 0 },
  { test: /^(remove|delete|clear)/i, icon: "trash", group: 3, danger: true },
  { test: /^(like|unlike)/i, icon: "heart", group: 1 },
  { test: /repost/i, icon: "repost", group: 1 },
  { test: /playlist/i, icon: "plus", group: 1 },
  { test: /(save|download)/i, icon: "download", group: 1 },
  { test: /^(rename|edit)/i, icon: "edit", group: 1 },
  { test: /^move/i, icon: "sort", group: 1 },
  { test: /(soundcloud|open)/i, icon: "external", group: 2 },
  { test: /artist/i, icon: "user", group: 2 },
];

function menuLook(label: string): { icon: IconName | null; group: number; danger: boolean } {
  const hit = LOOKS.find((l) => l.test.test(label));
  return hit ? { icon: hit.icon, group: hit.group, danger: hit.danger === true } : { icon: null, group: 1, danger: false };
}
