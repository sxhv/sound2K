/** 3:07, or 1:02:45 for long mixes. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function hash32(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/**
 * Warm placeholder gradient for tracks without artwork. Stays in the
 * red–orange–amber range so it fits the orange palette.
 */
export function placeholderGradient(id: string): string {
  const h = hash32(id);
  const hue = 4 + (h % 42); // 4°–45°
  const light = 34 + ((h >>> 8) % 22); // 34%–55%
  const angle = 115 + ((h >>> 16) % 50);
  return `linear-gradient(${angle}deg, hsl(${hue} 85% ${light}%), hsl(${(hue + 340) % 360} 70% ${Math.max(12, light - 26)}%))`;
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** "1 hr 23 min" / "42 min" for a list's total length. */
export function formatTotal(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}
