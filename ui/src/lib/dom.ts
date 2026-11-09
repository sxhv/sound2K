import { icon, type IconName } from "./icons";

type Handlers = {
  [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void;
};

export interface Props {
  class?: string;
  /** Set via textContent — never parsed as HTML. */
  text?: string;
  attrs?: Record<string, string>;
  on?: Handlers;
}

/** Create an element. All text goes through textContent (no innerHTML). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  children: ReadonlyArray<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.attrs) {
    for (const [name, value] of Object.entries(props.attrs)) el.setAttribute(name, value);
  }
  if (props.on) {
    for (const [type, fn] of Object.entries(props.on)) {
      if (fn) el.addEventListener(type, fn as unknown as EventListener);
    }
  }
  el.append(...children);
  return el;
}

export interface ButtonOptions {
  label: string;
  icon?: IconName;
  text?: string;
  class?: string;
  onClick: (event: MouseEvent) => void;
}

/** A button; `label` is used for aria-label and the tooltip. */
export function button(opts: ButtonOptions): HTMLButtonElement {
  const children: Node[] = [];
  if (opts.icon) children.push(icon(opts.icon));
  if (opts.text) children.push(h("span", { text: opts.text }));
  const btn = h(
    "button",
    {
      class: opts.class ?? "icon-btn",
      attrs: { type: "button", "aria-label": opts.label, title: opts.label },
    },
    children,
  );
  btn.addEventListener("click", opts.onClick);
  return btn;
}
