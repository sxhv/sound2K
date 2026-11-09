// Equalizer presets (dB per band: 31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz).
export const EQ_FREQUENCIES = ["31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];

export const EQ_PRESETS: Record<string, { label: string; gains: number[] }> = {
  flat: { label: "Flat", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { label: "Bass boost", gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  treble: { label: "Treble boost", gains: [0, 0, 0, 0, 0, 0, 2, 4, 5, 6] },
  vocal: { label: "Vocal", gains: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
  electronic: { label: "Electronic", gains: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5] },
  hiphop: { label: "Hip-hop", gains: [5, 4, 2, 3, -1, -1, 1, -1, 2, 3] },
  rock: { label: "Rock", gains: [4, 3, -1, -2, -1, 1, 3, 4, 4, 4] },
  acoustic: { label: "Acoustic", gains: [3, 3, 2, 1, 2, 2, 3, 3, 2, 1] },
  club2001: { label: "Club 2001", gains: [6, 5, 2, 0, -2, -1, 2, 4, 6, 7] },
};
