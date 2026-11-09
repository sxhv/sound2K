// Scrolling text for titles that don't fit (slowly glides to the end,
// pauses, glides back). Short titles stay still.

const observed = new WeakSet<HTMLElement>();
const resize = new ResizeObserver((entries) => {
  for (const e of entries) measure(e.target as HTMLElement);
});

export function setMarquee(el: HTMLElement, text: string): void {
  let inner = el.firstElementChild as HTMLElement | null;
  if (!inner || !inner.classList.contains("marquee-inner")) {
    inner = document.createElement("span");
    inner.className = "marquee-inner";
    el.replaceChildren(inner);
    el.classList.add("marquee");
  }
  if (inner.textContent === text) return;
  inner.textContent = text;
  el.classList.remove("is-scrolling");
  if (!observed.has(el)) {
    observed.add(el);
    resize.observe(el);
  }
  requestAnimationFrame(() => measure(el));
}

function measure(el: HTMLElement): void {
  const inner = el.firstElementChild as HTMLElement | null;
  if (!inner) return;
  const overflow = inner.scrollWidth - el.clientWidth;
  const scroll = overflow > 4 && el.clientWidth > 0;
  if (scroll) {
    el.style.setProperty("--marquee-shift", `${-overflow - 8}px`);
    el.style.setProperty("--marquee-dur", `${Math.max(8, overflow / 22 + 6).toFixed(1)}s`);
  }
  el.classList.toggle("is-scrolling", scroll);
}
