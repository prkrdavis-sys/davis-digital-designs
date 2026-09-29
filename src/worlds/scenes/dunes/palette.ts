import type { Variant } from "@/worlds/types";

/** Lighting and grade per variant. Kept in step with LOOK in art/worlds/dunes/build.py. */
export interface DunesPalette {
  sun: string;
  sunIntensity: number;
  skyStrength: number;
  /** Multiplies the sky's horizon color to get the haze. */
  hazeTint: [number, number, number];
  fogDensity: number;
  /** Meters: haze thins with altitude above this scale height. */
  fogHeight: number;
  sandA: string;
  sandB: string;
  /** Emissive multiplier for the template panels (HDR, blooms above 1). */
  panelGlow: number;
  disc: string;
  discStrength: number;
  discRadius: number;
  /** Warm light pooling on the sand in front of each panel. */
  spill: number;
  exposure: number;
  particles: string;
}

export const PALETTES: Record<Variant, DunesPalette> = {
  day: {
    sun: "#ffbd76",
    sunIntensity: 7.5,
    skyStrength: 0.7,
    hazeTint: [1.0, 0.94, 0.88],
    fogDensity: 0.00016,
    fogHeight: 180,
    sandA: "#e6b273",
    sandB: "#cf955a",
    panelGlow: 2.6,
    disc: "#fff1d6",
    discStrength: 60,
    discRadius: 1.3,
    spill: 0.0,
    exposure: 1.0,
    particles: "#ffd9a8",
  },
  night: {
    sun: "#9fb8ff",
    sunIntensity: 0.55,
    skyStrength: 1.0,
    hazeTint: [0.95, 1.0, 1.1],
    fogDensity: 0.00014,
    fogHeight: 160,
    sandA: "#c99a6a",
    sandB: "#b3845a",
    panelGlow: 4.5,
    disc: "#f4f1ea",
    discStrength: 18,
    discRadius: 1.1,
    spill: 1.0,
    exposure: 1.0,
    particles: "#b9c8ff",
  },
};
