import type { Variant } from "@/worlds/types";

/** Kept in sync with PAL in art/worlds/garden/build.py (Cycles layers use the same colors). */
export interface GardenPalette {
  vinyl: Record<string, string>;
  rim: Record<string, string> | null;
  water: string;
  glass: string;
  /** Sky gradient stops: [t, color], t = 0 straight down, 0.5 horizon, 1 zenith. */
  sky: [number, string][];
  fog: string;
  stars: number;
  cores: string[];
}

export const GARDEN: Record<Variant, GardenPalette> = {
  day: {
    vinyl: { star: "#ffcf4d", d: "#ff7fb2", arch: "#8fb0ff", torus: "#c4a4ff", blob: "#ff9f86", pill_a: "#8fe0bd", pill_b: "#ff9cc2", pill_c: "#ffe08f" },
    rim: null,
    water: "#8795e0",
    glass: "#f4eaff",
    sky: [
      [0.0, "#ffd7c2"],
      [0.5, "#ffd9c9"],
      [0.54, "#ffc9df"],
      [0.66, "#e3c4ff"],
      [0.8, "#b5c3ff"],
      [1.0, "#8fa8ff"],
    ],
    fog: "#ffd3d8",
    stars: 0,
    cores: [],
  },
  night: {
    vinyl: { star: "#ffcf4d", d: "#ff6fae", arch: "#7f9dff", torus: "#b996ff", blob: "#ff8f7a", pill_a: "#6fe0b0", pill_b: "#ff8fc0", pill_c: "#ffd76f" },
    rim: { star: "#ffe9a0", d: "#ff9cd0", arch: "#9fc0ff", torus: "#dcb8ff", blob: "#ffb49c", pill_a: "#a8ffd8", pill_b: "#ffb3dc", pill_c: "#fff0a8" },
    water: "#0d0c1f",
    glass: "#e9e4ff",
    sky: [
      [0.0, "#07061a"],
      [0.5, "#1c1440"],
      [0.53, "#3a2160"],
      [0.62, "#1d1a4a"],
      [1.0, "#05071a"],
    ],
    fog: "#2a1a52",
    stars: 1,
    cores: ["#ff8fd0", "#9fb8ff", "#ffd98a"],
  },
};
