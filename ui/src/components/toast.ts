import { h } from "../lib/dom";

let host: HTMLElement | null = null;

/** Short, non-blocking notification (bottom-right, above the dock). */
export function toast(message: string, kind: "info" | "error" = "info"): void {
  if (!host) {
    host = h("div", { class: "toast-host", attrs: { role: "status", "aria-live": "polite" } });
    document.body.append(host);
  }
  const el = h("div", { class: `toast glass-panel toast-${kind}`, text: message });
  host.append(el);
  while (host.children.length > 3) host.firstElementChild?.remove();
  window.setTimeout(() => {
    el.classList.add("is-leaving");
    window.setTimeout(() => el.remove(), 300);
  }, 3500);
}
