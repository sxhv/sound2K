// Artwork URL helpers and colour sampling.
//
// Artwork URLs come from SoundCloud's API, so they are validated before
// being used anywhere (including CSS backgrounds): https only, and only on
// SoundCloud's image CDN.

export type ArtSize = "small" | "t67x67" | "large" | "t300x300" | "t500x500";

const SIZE_PATTERN = /-(?:small|tiny|badge|t67x67|large|t300x300|crop|t500x500|original)\.(jpg|png)$/;

/** A validated artwork URL at the requested size, or null. */
export function artUrl(url: string | null | undefined, size: ArtSize): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !(u.hostname === "sndcdn.com" || u.hostname.endsWith(".sndcdn.com"))) return null;
  u.pathname = u.pathname.replace(SIZE_PATTERN, `-${size}.$1`);
  return u.href;
}

/** `url("…")` for CSS; the URL has already been normalised by `URL`, so
 * quotes and backslashes are percent-encoded. */
export function cssUrl(href: string): string {
  return `url("${href.replace(/["\\\n\r]/g, encodeURIComponent)}")`;
}

export type Rgb = readonly [number, number, number];

const colourCache = new Map<string, Promise<Rgb | null>>();

/**
 * Main colour of an artwork (sampled in Rust: see colour.rs), or null for
 * black-and-white covers / no artwork.
 */
export function artColour(url: string | null | undefined, sample: (src: string) => Promise<Rgb | null>): Promise<Rgb | null> {
  const src = artUrl(url, "t67x67");
  if (!src) return Promise.resolve(null);
  let pending = colourCache.get(src);
  if (!pending) {
    pending = sample(src).catch(() => null);
    colourCache.set(src, pending);
    if (colourCache.size > 300) colourCache.delete(colourCache.keys().next().value as string);
  }
  return pending;
}

export interface AccentPalette {
  accent: string;
  light: string;
  dark: string;
}

/** Turn a sampled colour into accent shades that read well on the dark
 * glass UI: always vivid, never too dark or too pale. */
export function accentPalette([r, g, b]: Rgb): AccentPalette {
  const [h, s] = rgbToHsl(r, g, b);
  const sat = Math.min(1, Math.max(0.7, s));
  return {
    accent: hsl(h, sat, 0.55),
    light: hsl(h, sat, 0.66),
    dark: hsl(h, sat, 0.4),
  };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h.toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%)`;
}
