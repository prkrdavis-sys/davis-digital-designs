import type { Variant } from "@/worlds/types";

/** Kept in sync with PAL in art/worlds/bubbles/build.py (the Cycles layers use the same colors). */
export interface BubblesPalette {
  vinyl: Record<string, string>;
  sky: [number, string][];
  fog: string;
  stars: number;
  motes: [string, string, string];
}

export const BUBBLES: Record<Variant, BubblesPalette> = {
  day: {
    vinyl: { pink: "#ff8fbd", blue: "#8fb0ff", butter: "#ffd66e", lilac: "#c3a6ff", mint: "#8fe0bd", white: "#f6f2ff", chrome: "#ffffff" },
    sky: [
      [0.0, "#ffe6c9"],
      [0.35, "#ffd6cf"],
      [0.5, "#ffcfe3"],
      [0.65, "#e1cdff"],
      [0.82, "#b9c9ff"],
      [1.0, "#9bb5ff"],
    ],
    fog: "#f7d6ea",
    stars: 0,
    motes: ["#ffffff", "#ffe3f3", "#e3f0ff"],
  },
  night: {
    vinyl: { pink: "#ff7fb8", blue: "#7f9dff", butter: "#ffcc5c", lilac: "#b28cff", mint: "#6fe0b0", white: "#efe8ff", chrome: "#ffffff" },
    sky: [
      [0.0, "#1a0f33"],
      [0.3, "#3b1d52"],
      [0.44, "#7a3b74"],
      [0.5, "#4a2a6e"],
      [0.62, "#1e1b4d"],
      [1.0, "#060a22"],
    ],
    fog: "#2b1d55",
    stars: 1,
    motes: ["#ffffff", "#ffd6ec", "#cfe0ff"],
  },
};
