import { WORLDS, type WorldId } from "@/lib/worlds";
import type { SceneId, Variant } from "@/worlds/types";

export type DoorWorld = Extract<WorldId, "sites" | "apps" | "play" | "create" | "shop">;

/** One door as written by art/worlds/doors/build.py (three.js coordinates). */
export interface DoorInfo {
  id: DoorWorld;
  scene: SceneId;
  /** Bottom centre of the opening, on the dais. */
  base: [number, number, number];
  /** Middle of the portal plane (a little above half height). */
  center: [number, number, number];
  /** Unit vector through the door, away from the visitor. */
  into: [number, number, number];
  /** Unit vector to the visitor's right while facing the door. */
  right: [number, number, number];
  up: [number, number, number];
  /** Floor point just in front of the door where its light pools. */
  spill: [number, number, number];
}

export interface DoorsLayout {
  doors: DoorInfo[];
  /** Marquee bulbs on the Play arch, world positions. */
  bulbs: [number, number, number][];
  /** Opening half-width and spring height, meters. */
  w: number;
  h: number;
  portalY: number;
}

export const OFFSET = 0.15;
export const RAIL = "/worlds/doors/rails.json";
const LAYOUT = "/worlds/doors/hi/layout.json";

let layoutPromise: Promise<DoorsLayout> | null = null;
export function loadLayout(): Promise<DoorsLayout> {
  layoutPromise ??= fetch(LAYOUT).then((r) => {
    if (!r.ok) throw new Error(`doors layout: ${r.status}`);
    return r.json() as Promise<DoorsLayout>;
  });
  return layoutPromise;
}

export function doorPalette(id: DoorWorld, variant: Variant): [string, string, string] {
  return WORLDS[id].palette[variant];
}

export const DOOR_IDS: DoorWorld[] = ["sites", "apps", "play", "create", "shop"];

export function isDoorWorld(id: string | null): id is DoorWorld {
  return id !== null && (DOOR_IDS as string[]).includes(id);
}
