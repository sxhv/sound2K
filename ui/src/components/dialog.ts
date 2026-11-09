// Small modal dialogs (name a playlist, confirm a delete).
import { h } from "../lib/dom";

interface PromptOptions {
  title: string;
  value?: string;
  confirm: string;
  /** Show a "Private" switch (new playlists). */
  privacy?: boolean;
}

export interface PromptResult {
  text: string;
  private: boolean;
}

function openModal(card: HTMLElement, focus: HTMLElement, onClose: () => void): () => void {
  const backdrop = h("div", { class: "modal-backdrop" }, [card]);
  const previous = document.activeElement as HTMLElement | null;
  const close = (): void => {
    document.removeEventListener("keydown", onKey, true);
    backdrop.classList.add("is-closing");
    window.setTimeout(() => backdrop.remove(), 180);
    previous?.focus();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) onClose();
  });
  document.addEventListener("keydown", onKey, true);
  document.body.append(backdrop);
  requestAnimationFrame(() => focus.focus());
  return close;
}

export function promptDialog(opts: PromptOptions): Promise<PromptResult | null> {
  return new Promise((resolve) => {
    const input = h("input", { class: "glass-field modal-input", attrs: { type: "text", maxlength: "100", "aria-label": opts.title } });
    input.value = opts.value ?? "";
    const priv = h("input", { class: "switch", attrs: { type: "checkbox", role: "switch", "aria-label": "Private" } });
    priv.checked = true;
    const ok = h("button", { class: "glass-btn accent", text: opts.confirm, attrs: { type: "submit" } });
    const cancel = h("button", { class: "glass-btn", text: "Cancel", attrs: { type: "button" } });
    const sync = (): void => {
      ok.disabled = input.value.trim() === "";
    };
    sync();
    input.addEventListener("input", sync);

    const form = h("form", { class: "modal glass-panel", attrs: { role: "dialog", "aria-modal": "true", "aria-label": opts.title } }, [
      h("h2", { text: opts.title }),
      input,
      ...(opts.privacy ? [h("label", { class: "modal-row" }, [h("span", { text: "Private" }), priv])] : []),
      h("div", { class: "modal-actions" }, [cancel, ok]),
    ]);
    let done = false;
    const finish = (result: PromptResult | null): void => {
      if (done) return;
      done = true;
      close();
      resolve(result);
    };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (input.value.trim()) finish({ text: input.value.trim(), private: priv.checked });
    });
    cancel.addEventListener("click", () => finish(null));
    const close = openModal(form, input, () => finish(null));
  });
}

export function confirmDialog(title: string, confirm: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ok = h("button", { class: "glass-btn danger", text: confirm, attrs: { type: "button" } });
    const cancel = h("button", { class: "glass-btn", text: "Cancel", attrs: { type: "button" } });
    const card = h("div", { class: "modal glass-panel", attrs: { role: "alertdialog", "aria-modal": "true", "aria-label": title } }, [
      h("h2", { text: title }),
      h("div", { class: "modal-actions" }, [cancel, ok]),
    ]);
    let done = false;
    const finish = (yes: boolean): void => {
      if (done) return;
      done = true;
      close();
      resolve(yes);
    };
    ok.addEventListener("click", () => finish(true));
    cancel.addEventListener("click", () => finish(false));
    const close = openModal(card, cancel, () => finish(false));
  });
}
