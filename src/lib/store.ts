"use client";

import { create } from "zustand";
import type { Season } from "@/lib/seasons";

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

interface UiState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;

  muted: boolean;
  toggleMuted: () => void;

  season: Season;
  /** Set by route; cleared when a user "shuffles" seasons via easter egg. */
  seasonOverride: Season | null;
  setSeason: (s: Season) => void;
  setSeasonOverride: (s: Season | null) => void;

  reducedMotion: boolean;
  isTouch: boolean;
  setCapabilities: (c: { reducedMotion: boolean; isTouch: boolean }) => void;

  cursorLabel: string | null;
  cursorVariant: "default" | "link" | "view" | "drag" | "hidden";
  setCursor: (v: UiState["cursorVariant"], label?: string | null) => void;

  transitioning: boolean;
  setTransitioning: (v: boolean) => void;

  gameOpen: boolean;
  setGameOpen: (v: boolean) => void;
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

  season: "spring",
  seasonOverride: null,
  setSeason: (season) => {
    set({ season });
    if (typeof document !== "undefined" && !get().seasonOverride) {
      document.documentElement.dataset.season = season;
    }
  },
  setSeasonOverride: (seasonOverride) => {
    set({ seasonOverride });
    if (typeof document !== "undefined") {
      document.documentElement.dataset.season = seasonOverride ?? get().season;
    }
  },

  reducedMotion: false,
  isTouch: false,
  setCapabilities: (c) => set(c),

  cursorLabel: null,
  cursorVariant: "default",
  setCursor: (cursorVariant, cursorLabel = null) => set({ cursorVariant, cursorLabel }),

  transitioning: false,
  setTransitioning: (transitioning) => set({ transitioning }),

  gameOpen: false,
  setGameOpen: (gameOpen) => set({ gameOpen }),
}));

/** The season currently shown: override wins over the route season. */
export function useActiveSeason(): Season {
  return useUi((s) => s.seasonOverride ?? s.season);
}
