import type { Variant } from "@/worlds/types";

/** Miniatures the island carries. Kept in sync with art/worlds/diorama/layout.py. */
export const MINI_IDS = ["garden", "doors", "museum", "bubbles", "greenhouse", "dna", "pinball", "snowglobe", "everest", "dunes", "planes"] as const;

export type MiniId = (typeof MINI_IDS)[number];

export interface Plot {
  id: MiniId;
  /** three.js world position of the pad top (mini origin). */
  p: [number, number, number];
  yaw: number;
  kind: "star" | "arch" | "frame" | "sphere" | "glass" | "helix" | "table" | "globe" | "peak" | "cone" | "plane";
  day: string;
  night: string;
  glow: string;
}

export interface DioramaLayout {
  sMax: number;
  pond: { c: [number, number, number]; rx: number; rz: number };
  table: { radius: number; height: number };
  plots: Plot[];
  focus: { s: number; p: [number, number, number] }[];
}

/** Fallback if layout.json has not been written yet (matches the Blender file). */
export const LAYOUT: DioramaLayout = {
  sMax: 2.2,
  pond: { c: [0.16, 0.055, -0.04], rx: 1.62, rz: 1.28 },
  table: { radius: 8.7, height: 0.2 },
  plots: [
    { id: "garden", p: [2.58, 0.28, 3.88], yaw: 0.314, kind: "star", day: "#ffcf4d", night: "#ffd76f", glow: "#ffe9a0" },
    { id: "doors", p: [3.88, 0.26, 1.12], yaw: -0.244, kind: "arch", day: "#9dbcff", night: "#a3b6ff", glow: "#ffe08f" },
    { id: "museum", p: [3.52, 0.26, -1.78], yaw: -0.454, kind: "frame", day: "#f4c552", night: "#ffd66e", glow: "#fff1c2" },
    { id: "bubbles", p: [1.22, 0.26, -3.58], yaw: 0.175, kind: "sphere", day: "#ff9cc2", night: "#ffa6d0", glow: "#ffd0ea" },
    { id: "greenhouse", p: [-1.78, 0.26, -3.38], yaw: 0.419, kind: "glass", day: "#8fd08a", night: "#9ae8a4", glow: "#c8ffc4" },
    { id: "dna", p: [-3.58, 0.26, -1.42], yaw: -0.209, kind: "helix", day: "#5cc3d2", night: "#6dffab", glow: "#7f97ff" },
    { id: "pinball", p: [-3.48, 0.26, 1.58], yaw: 0.663, kind: "table", day: "#ff5c9d", night: "#ff4fa0", glow: "#3edcff" },
    { id: "snowglobe", p: [-1.12, 0.26, 3.68], yaw: 0.105, kind: "globe", day: "#a9dcff", night: "#86e8cc", glow: "#cbb2ff" },
    { id: "everest", p: [0.38, 0.42, -6.48], yaw: 0, kind: "peak", day: "#f4c552", night: "#ffd66e", glow: "#8dbcff" },
    { id: "dunes", p: [-6.18, 0.28, 3.78], yaw: 0.733, kind: "cone", day: "#ffb85f", night: "#ffdca8", glow: "#ff8a66" },
    { id: "planes", p: [6.38, 0.28, 2.32], yaw: -0.314, kind: "plane", day: "#ffa684", night: "#ffd07e", glow: "#bea3ff" },
  ],
  focus: [
    { s: 0.0, p: [2.58, 0.73, 3.88] },
    { s: 0.85, p: [1.6, 0.6, 2.2] },
    { s: 1.4, p: [0.15, 0.45, -0.1] },
    { s: 2.0, p: [0.15, 0.45, -0.1] },
  ],
};

export const PALETTE: Record<Variant, { fog: string; water: string; sky: [number, string][]; stars: number; seam: string }> = {
  day: {
    fog: "#ffc9b4",
    water: "#4a6fa0",
    sky: [
      [0.0, "#ffc9a0"],
      [0.46, "#ffd4b4"],
      [0.52, "#ffb48a"],
      [0.58, "#f08a7a"],
      [0.72, "#c97ec8"],
      [0.86, "#7f9ad8"],
      [1.0, "#5c78c4"],
    ],
    stars: 0,
    seam: "#ff9cc2",
  },
  night: {
    fog: "#1a1440",
    water: "#0a1224",
    sky: [
      [0.0, "#0a0818"],
      [0.48, "#16122e"],
      [0.52, "#3a2160"],
      [0.62, "#1a1840"],
      [1.0, "#050614"],
    ],
    stars: 1,
    seam: "#cdb0ff",
  },
};
