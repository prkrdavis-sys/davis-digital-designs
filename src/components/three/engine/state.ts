import type { SceneId, TransitionKind } from "@/worlds/types";

/**
 * Non-reactive engine state shared by the DOM chapter tracker, the world
 * director, the cursor layer, and the poster backdrop. Mutated in place.
 */
export const chapters = {
  ids: [] as string[],
  /** Scroll offsets (px) where each chapter starts, plus a final entry at max scroll. */
  anchors: [0] as number[],
  version: 0,
};

/** Continuous chapter time: chapter index + progress through it. */
export function chapterTimeAt(scrollY: number): number {
  const a = chapters.anchors;
  const n = chapters.ids.length;
  if (n === 0) return 0;
  if (scrollY <= a[0]) return 0;
  for (let i = 0; i < n; i++) {
    const start = a[i];
    const end = a[i + 1];
    if (scrollY < end) return i + (scrollY - start) / Math.max(1, end - start);
  }
  return n;
}

/** Homepage interplay between DOM cards and the 3D door corridor. */
export const homeState = {
  /** World id of the door card under the pointer, or null. */
  hoveredDoor: null as string | null,
  /** World id of the door card that was just clicked (the corridor dives through it). */
  enteredDoor: null as string | null,
};

/** Set just before navigating to pick how the next world arrives (doors use "dive"). */
export const routeIntent = {
  kind: null as TransitionKind | null,
};

export const engine = {
  /** Damped chapter time used by cameras. */
  t: 0,
  /** Raw chapter time straight from scroll. */
  rawT: 0,
  /** d(t)/dt, for motion blur, wobble and scroll-velocity effects. */
  velocity: 0,
  /** Index of the chapter under the viewport. */
  chapter: 0,
  /** The scene currently dominating the frame (drives the cursor theme). */
  primaryScene: null as SceneId | null,
  /** Scenes that have rendered at least one frame (posters fade out when ready). */
  readyScenes: new Set<string>(),
  /** Seconds since the director started. */
  time: 0,
  /** Frames per second, smoothed; read by the Low Resources prompt. */
  fps: 60,
};
