export type Season = "spring" | "summer" | "autumn" | "winter" | "golden";

export const SEASONS: Season[] = ["spring", "summer", "autumn", "winter", "golden"];

export interface SeasonTheme {
  label: string;
  tagline: string;
  /** Hex colors used by the 3D scene. */
  sky: { high: string; low: string };
  terrain: { top: string; bottom: string };
  particle: string[];
  particleKind: "petal" | "pollen" | "leaf" | "snow" | "dust";
  particleCount: number;
  fallSpeed: number;
  sway: number;
}

export const SEASON_THEMES: Record<Season, SeasonTheme> = {
  spring: {
    label: "Spring",
    tagline: "Fresh starts and blooming ideas",
    sky: { high: "#9fd9ff", low: "#ffe6f2" },
    terrain: { top: "#7fd39a", bottom: "#3d9a63" },
    particle: ["#ff9ec4", "#ffc3dc", "#fff0f6"],
    particleKind: "petal",
    particleCount: 220,
    fallSpeed: 0.35,
    sway: 1.2,
  },
  summer: {
    label: "Summer",
    tagline: "Bright, bold, and full of energy",
    sky: { high: "#4fb0ea", low: "#fff3c4" },
    terrain: { top: "#9ed66c", bottom: "#4f9d3a" },
    particle: ["#ffe28a", "#fff6cc", "#ffd166"],
    particleKind: "pollen",
    particleCount: 160,
    fallSpeed: -0.12,
    sway: 0.8,
  },
  autumn: {
    label: "Autumn",
    tagline: "Playful, warm, a little wild",
    sky: { high: "#f7b267", low: "#ffe8d1" },
    terrain: { top: "#e0a458", bottom: "#8c4a2b" },
    particle: ["#e8743b", "#ffb84d", "#c0392b", "#f4d35e"],
    particleKind: "leaf",
    particleCount: 200,
    fallSpeed: 0.55,
    sway: 1.8,
  },
  winter: {
    label: "Winter",
    tagline: "Quiet focus and crisp detail",
    sky: { high: "#c9e6ff", low: "#f4f9ff" },
    terrain: { top: "#f2f8ff", bottom: "#b9d3ea" },
    particle: ["#ffffff", "#e9f4ff", "#d6ecff"],
    particleKind: "snow",
    particleCount: 320,
    fallSpeed: 0.25,
    sway: 0.6,
  },
  golden: {
    label: "Golden hour",
    tagline: "Warm glow, ready to ship",
    sky: { high: "#ff9a6b", low: "#ffe2a8" },
    terrain: { top: "#f0b96b", bottom: "#a35d3c" },
    particle: ["#ffd27a", "#ffe9b8", "#ffb35c"],
    particleKind: "dust",
    particleCount: 180,
    fallSpeed: -0.06,
    sway: 0.5,
  },
};

export function nextSeason(current: Season): Season {
  const i = SEASONS.indexOf(current);
  return SEASONS[(i + 1) % SEASONS.length];
}
