"use client";

import { create } from "zustand";
import type { WorldId } from "@/lib/worlds";
import type { Quality, SceneId, Variant } from "@/worlds/types";

export type Theme = "light" | "dark";

/**
 * Mutable, non-reactive pointer + scroll state.
 * Updated every frame by listeners; read directly inside R3F useFrame and GSAP
 * tickers so we never trigger React re-renders on mousemove/scroll.
 */
export const pointer = {
  /** pixel coords */
  x: 0,
  y: 0,
  /** normalized -1..1 (x right, y up) */
  nx: 0,
  ny: 0,
  /** smoothed */
  sx: 0,
  sy: 0,
  /** pixel velocity */
  vx: 0,
  vy: 0,
  down: false,
  active: false,
};

export const scrollState = {
  /** 0..1 progress of the whole page */
  progress: 0,
  /** px */
  y: 0,
  velocity: 0,
};

const LOW_KEY = "ddd:low-power";
const AMBIENT_KEY = "ddd:ambient";
const CONTENT_KEY = "ddd:content-hidden";

/** Hide the page and footer without collapsing them, so scroll still drives the worlds. */
function syncContentHidden(hidden: boolean) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (hidden) root.dataset.content = "off";
  else delete root.dataset.content;
  for (const el of document.querySelectorAll("main, footer")) {
    if (hidden) {
      el.setAttribute("inert", "");
      el.setAttribute("aria-hidden", "true");
    } else {
      el.removeAttribute("inert");
      el.removeAttribute("aria-hidden");
    }
  }
}

interface UiState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;

  muted: boolean;
  toggleMuted: () => void;

  /** Optional ambient soundscape per world. Off until the visitor opts in. */
  ambient: boolean;
  setAmbient: (v: boolean) => void;

  world: WorldId;
  /** Project pages show a calmer, parked view of their category's world. */
  parked: boolean;
  /** Cover image of the project being viewed; parked worlds project it into the scene. */
  cover: string | null;
  setWorld: (w: WorldId, parked?: boolean, cover?: string | null) => void;

  /** Chapter ids found on the current page, in document order. */
  chapterIds: string[];
  setChapterIds: (ids: string[]) => void;

  /** Low Resources mode: the designed 2.5D version of every world. */
  lowResources: boolean;
  /** "auto" = chosen from device capabilities; "user" = the visitor picked. */
  lowResourcesSource: "auto" | "user";
  setLowResources: (v: boolean, source?: "auto" | "user") => void;

  /** Logo easter egg: wear another world's cursor. */
  cursorOverride: SceneId | null;
  setCursorOverride: (s: SceneId | null) => void;

  reducedMotion: boolean;
  isTouch: boolean;
  setCapabilities: (c: { reducedMotion: boolean; isTouch: boolean }) => void;

  transitioning: boolean;
  setTransitioning: (v: boolean) => void;

  gameOpen: boolean;
  setGameOpen: (v: boolean) => void;

  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;

  /** Page and footer are invisible; scroll, navbar, cursor, and the worlds remain. */
  contentHidden: boolean;
  setContentHidden: (v: boolean) => void;
}

export const useUi = create<UiState>((set, get) => ({
  theme: "light",
  setTheme: (theme) => {
    set({ theme });
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
      window.localStorage.setItem("ddd:theme", theme);
    }
  },
  toggleTheme: () => get().setTheme(get().theme === "light" ? "dark" : "light"),

  muted: false,
  toggleMuted: () => {
    const muted = !get().muted;
    set({ muted });
    if (typeof window !== "undefined") window.localStorage.setItem("ddd:muted", String(muted));
  },

  ambient: false,
  setAmbient: (ambient) => {
    set({ ambient });
    if (typeof window !== "undefined") window.localStorage.setItem(AMBIENT_KEY, String(ambient));
  },

  world: "home",
  parked: false,
  cover: null,
  setWorld: (world, parked = false, cover = null) => {
    const s = get();
    if (s.world === world && s.parked === parked && s.cover === cover) return;
    set({ world, parked, cover });
    if (typeof document !== "undefined") document.documentElement.dataset.world = world;
  },

  chapterIds: [],
  setChapterIds: (chapterIds) => {
    const prev = get().chapterIds;
    if (prev.length === chapterIds.length && prev.every((id, i) => id === chapterIds[i])) return;
    set({ chapterIds });
  },

  lowResources: false,
  lowResourcesSource: "auto",
  setLowResources: (lowResources, source = "user") => {
    set({ lowResources, lowResourcesSource: source });
    if (typeof window !== "undefined" && source === "user") window.localStorage.setItem(LOW_KEY, String(lowResources));
  },

  cursorOverride: null,
  setCursorOverride: (cursorOverride) => set({ cursorOverride }),

  reducedMotion: false,
  isTouch: false,
  setCapabilities: (c) => set(c),

  transitioning: false,
  setTransitioning: (transitioning) => set({ transitioning }),

  gameOpen: false,
  setGameOpen: (gameOpen) => set({ gameOpen }),

  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  contentHidden: false,
  setContentHidden: (contentHidden) => {
    set({ contentHidden });
    syncContentHidden(contentHidden);
    if (typeof window !== "undefined") window.localStorage.setItem(CONTENT_KEY, String(contentHidden));
  },
}));

export function useVariant(): Variant {
  return useUi((s) => (s.theme === "dark" ? "night" : "day"));
}

export function useQuality(): Quality {
  return useUi((s) => (s.lowResources ? "lo" : "hi"));
}

/** Read the stored Low Resources preference, or decide from device capabilities. */
export function initialLowResources(isTouch: boolean): { value: boolean; source: "auto" | "user" } {
  const stored = window.localStorage.getItem(LOW_KEY);
  if (stored === "true" || stored === "false") return { value: stored === "true", source: "user" };
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lowMemory = typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4;
  const fewCores = typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4;
  return { value: isTouch || lowMemory || fewCores, source: "auto" };
}

export function storedAmbient(): boolean {
  return window.localStorage.getItem(AMBIENT_KEY) === "true";
}

export function storedContentHidden(): boolean {
  return window.localStorage.getItem(CONTENT_KEY) === "true";
}
