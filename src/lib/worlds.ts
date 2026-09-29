import type { SceneId, TransitionKind, Variant } from "@/worlds/types";

export type { TransitionKind };

/**
 * A world is a page's 3D identity: its palette, its scenes, and how those
 * scenes map onto the page's scroll chapters. Pages mark their sections with
 * data-chapter="<id>"; the footer is always "outro".
 */
export type WorldId = "home" | "sites" | "apps" | "play" | "create" | "shop" | "about" | "contact";

export const WORLD_IDS: WorldId[] = ["home", "sites", "apps", "play", "create", "shop", "about", "contact"];

export interface ChapterBinding {
  /** Matches data-chapter on the page. */
  id: string;
  scene: SceneId;
  /** How this chapter's scene arrives when it differs from the previous one. */
  transition?: TransitionKind;
}

export interface World {
  id: WorldId;
  label: string;
  tagline: string;
  /** UI accents: gradient trio (a, b, c) per variant. Text on the gradient is dark ink. */
  palette: Record<Variant, [string, string, string]>;
  chapters: ChapterBinding[];
  /** Scene used when a page has no chapters, and for project pages in this world. */
  scene: SceneId;
  /** A single line shown in the category page's interlude chapter, while the world finishes its story. */
  interlude?: string;
  /** How this world arrives when you navigate to it (links can override, e.g. the homepage doors dive). */
  entry: TransitionKind;
}

const single = (scene: SceneId, ids: string[]): ChapterBinding[] => ids.map((id) => ({ id, scene }));

export const WORLDS: Record<WorldId, World> = {
  home: {
    id: "home",
    label: "The studio",
    tagline: "Five worlds, one scroll",
    palette: { day: ["#ff9cc2", "#9dbcff", "#ffe08f"], night: ["#ffa6d0", "#a3b6ff", "#cdb0ff"] },
    scene: "garden",
    entry: "dissolve",
    chapters: [
      { id: "hero", scene: "garden" },
      { id: "doors", scene: "doors", transition: "dissolve" },
      { id: "reel", scene: "museum", transition: "wipe" },
      { id: "voices", scene: "bubbles", transition: "chroma" },
      { id: "cta", scene: "diorama", transition: "dissolve" },
      { id: "outro", scene: "diorama" },
    ],
  },
  sites: {
    id: "sites",
    label: "The greenhouse",
    tagline: "Websites grown in morning light",
    palette: { day: ["#8fd08a", "#f6c47c", "#e6f2de"], night: ["#9ae8a4", "#f3d58f", "#a9bfff"] },
    scene: "greenhouse",
    entry: "dissolve",
    chapters: single("greenhouse", ["intro", "work", "interlude", "outro"]),
    interlude: "Every site starts as a seed. Light, patience, a little pruning.",
  },
  apps: {
    id: "apps",
    label: "Under the microscope",
    tagline: "The DNA of software people use",
    palette: { day: ["#5cc3d2", "#e58bbd", "#f3e9dc"], night: ["#6dffab", "#ff6fae", "#7f97ff"] },
    scene: "dna",
    entry: "chroma",
    chapters: single("dna", ["intro", "work", "interlude", "outro"]),
    interlude: "Every app is a sequence, read one base at a time.",
  },
  play: {
    id: "play",
    label: "Inside the machine",
    tagline: "Games, toys, and multiball",
    palette: { day: ["#ff5c9d", "#3edcff", "#ffd84a"], night: ["#ff4fa0", "#2fe6ff", "#ffe066"] },
    scene: "pinball",
    entry: "wipe",
    chapters: single("pinball", ["intro", "work", "interlude", "outro"]),
    interlude: "Tilt, flip, repeat. A good game is just physics with a sense of humor.",
  },
  create: {
    id: "create",
    label: "The snow globe",
    tagline: "Stories in a tiny, perfect world",
    palette: { day: ["#a9dcff", "#eef4ff", "#cbb2ff"], night: ["#86e8cc", "#bccbff", "#ffd392"] },
    scene: "snowglobe",
    entry: "frost",
    chapters: single("snowglobe", ["intro", "work", "interlude", "outro"]),
    interlude: "Stories settle like snow: slowly, then all at once.",
  },
  shop: {
    id: "shop",
    label: "The golden dunes",
    tagline: "Templates, standing tall at sunset",
    palette: { day: ["#ffb85f", "#ff8a66", "#ffe4b5"], night: ["#dccbff", "#8e98ff", "#ffdca8"] },
    scene: "dunes",
    entry: "dissolve",
    chapters: single("dunes", ["intro", "work", "faq", "outro"]),
  },
  about: {
    id: "about",
    label: "The long way up",
    tagline: "From Lukla to the summit",
    palette: { day: ["#f4c552", "#8dbcff", "#eef3f8"], night: ["#ffd66e", "#98adff", "#cfd9ea"] },
    scene: "everest",
    entry: "wipe",
    chapters: single("everest", ["intro", "values", "tools", "story", "voices", "outro"]),
  },
  contact: {
    id: "contact",
    label: "Paper planes",
    tagline: "Send one over the clouds",
    palette: { day: ["#ffa684", "#bea3ff", "#fff1d8"], night: ["#ffd07e", "#a2acff", "#f3e8d2"] },
    scene: "planes",
    entry: "dissolve",
    chapters: single("planes", ["intro", "form", "outro"]),
  },
};

/** Worlds for routes. Project pages (/work/...) set their world from the project's category. */
export function worldForPath(pathname: string): WorldId | null {
  if (pathname.startsWith("/work/")) return null;
  if (pathname === "/") return "home";
  const first = pathname.split("/")[1] as WorldId;
  return WORLD_IDS.includes(first) ? first : "home";
}

export function nextWorld(current: WorldId): WorldId {
  const i = WORLD_IDS.indexOf(current);
  return WORLD_IDS[(i + 1) % WORLD_IDS.length];
}
