import { createContext, useContext, useEffect, useRef } from "react";

/** Per-frame cursor state, in CSS pixels (origin top-left). Written by CursorLayer. */
export const cursor = {
  x: -100,
  y: -100,
  /** Smoothed velocity, px/s. */
  vx: 0,
  vy: 0,
  speed: 0,
  /** Pixels travelled this frame. */
  moved: 0,
  down: false,
  /** 0..1: grows over links and buttons. */
  hover: 0,
  /** 0..1: fades out when the pointer leaves the page or over data-cursor="hidden". */
  presence: 0,
  /** True while a labelled element (data-cursor="View") is under the pointer. */
  labelled: false,
  width: 1,
  height: 1,
  time: 0,
};

/** Screen px -> orthographic world units (origin centre, y up). */
export function toWorldX(x: number) {
  return x - cursor.width / 2;
}
export function toWorldY(y: number) {
  return cursor.height / 2 - y;
}

type ClickFn = (x: number, y: number) => void;

export interface ThemeContextValue {
  /** 0..1 cross-fade weight of this theme (themes swap smoothly between scenes). */
  weight: { current: number };
  clicks: Set<ClickFn>;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useThemeWeight() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("cursor theme parts must be inside a ThemeHost");
  return ctx.weight;
}

/** Run `fn` on every click while this theme is showing. */
export function useCursorClick(fn: ClickFn) {
  const ctx = useContext(ThemeContext);
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!ctx) return;
    const h: ClickFn = (x, y) => ref.current(x, y);
    ctx.clicks.add(h);
    return () => {
      ctx.clicks.delete(h);
    };
  }, [ctx]);
}

/**
 * Additive glows vanish on light daytime pages, so parts can ask for additive
 * blending only at night. Normal blending is used otherwise.
 */
export type Additive = boolean | "night";

export function resolveAdditive(additive: Additive | undefined, night: boolean): boolean {
  return additive === "night" ? night : Boolean(additive);
}

/** Readings scenes can publish for their cursor (Everest altimeter elevation, etc.). */
export const cursorBridge = {
  /** Elevation in meters under the pointer, or null when off the terrain. */
  elevation: null as number | null,
};
