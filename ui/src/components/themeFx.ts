// Decorative background life for some themes: bubbles drifting up
// (Frutiger Aero), twinkling stars (Midnight), CRT scanlines (Winamp).
// Pure CSS animations of transform/opacity, which the GPU composites
// cheaply. They're hidden on other themes, paused while the window is
// hidden, and turned off by Windows' "reduce animations".

const BUBBLES = 14;
const STARS = 46;

export function createThemeFx(): HTMLElement {
  const el = document.createElement("div");
  el.className = "theme-fx";
  el.setAttribute("aria-hidden", "true");
  // Fixed pseudo-random layout so it looks the same every launch.
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < BUBBLES; i++) {
    const b = document.createElement("span");
    b.className = "fx-bubble";
    const size = 14 + rand() * 46;
    b.style.setProperty("--x", `${(rand() * 100).toFixed(1)}%`);
    b.style.setProperty("--size", `${size.toFixed(0)}px`);
    b.style.setProperty("--dur", `${(16 + rand() * 18).toFixed(1)}s`);
    b.style.setProperty("--delay", `${(-rand() * 30).toFixed(1)}s`);
    b.style.setProperty("--drift", `${((rand() - 0.5) * 80).toFixed(0)}px`);
    el.append(b);
  }
  for (let i = 0; i < STARS; i++) {
    const s = document.createElement("span");
    s.className = "fx-star";
    s.style.setProperty("--x", `${(rand() * 100).toFixed(1)}%`);
    s.style.setProperty("--y", `${(rand() * 100).toFixed(1)}%`);
    s.style.setProperty("--size", `${(1 + rand() * 2.2).toFixed(1)}px`);
    s.style.setProperty("--dur", `${(2.5 + rand() * 4).toFixed(1)}s`);
    s.style.setProperty("--delay", `${(-rand() * 6).toFixed(1)}s`);
    el.append(s);
  }
  const sync = (): void => {
    el.classList.toggle("is-paused", document.hidden);
  };
  document.addEventListener("visibilitychange", sync);
  sync();
  return el;
}
