// Decorative background life for some themes: bubbles drifting up
// (Frutiger Aero), twinkling stars (Midnight), CRT scanlines (Winamp).
// Pure CSS animations of transform/opacity, which the GPU composites
// cheaply. They're hidden on other themes, paused while the window is
// hidden, and turned off by Windows' "reduce animations".

import type { Visualizer } from "./visualizer";

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

/** Song theme: the background breathes with the bass (sets --pulse 0..1).
 * Bubblegum: sparkles fly out when you like a song. */
export function attachThemeBehaviour(visualizer: Visualizer): void {
  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  let pulse = 0;
  let avg = 0;
  visualizer.onBeat((bass) => {
    if (root.dataset.theme !== "song" || reduce.matches) {
      if (pulse !== 0) {
        pulse = 0;
        root.style.setProperty("--pulse", "0");
      }
      return;
    }
    avg = avg * 0.94 + bass * 0.06;
    const target = Math.min(1, Math.max(0, (bass - avg) * 2.2 + bass * 0.08));
    pulse += (target - pulse) * (target > pulse ? 0.5 : 0.18);
    root.style.setProperty("--pulse", pulse.toFixed(3));
  });

  // Capture phase: read the heart's state before the click changes it.
  document.addEventListener(
    "click",
    (e) => {
      if (root.dataset.theme !== "bubblegum" || reduce.matches) return;
      const heart = (e.target as Element | null)?.closest<HTMLElement>(".track-like, .dock-like, .np-like, .mini-like");
      if (!heart || heart.getAttribute("aria-pressed") === "true") return;
      sparkles(e.clientX, e.clientY);
    },
    true,
  );
}

function sparkles(x: number, y: number): void {
  for (let i = 0; i < 8; i++) {
    const s = document.createElement("span");
    s.className = `like-sparkle${i % 2 ? " is-pink" : ""}`;
    const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 26 + Math.random() * 20;
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    s.style.setProperty("--dx", `${(Math.cos(angle) * dist).toFixed(1)}px`);
    s.style.setProperty("--dy", `${(Math.sin(angle) * dist).toFixed(1)}px`);
    document.body.append(s);
    window.setTimeout(() => s.remove(), 800);
  }
}
