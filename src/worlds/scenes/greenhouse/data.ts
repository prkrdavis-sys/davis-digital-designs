/**
 * Runtime data written by art/worlds/greenhouse/build.py (step `meta`):
 * sun/moon, the light shafts traced through the glazing, fairy-light bulbs,
 * lantern flames and the floating browser panels. All in three.js coordinates.
 */
import type { Variant } from "@/worlds/types";

export type Vec3 = [number, number, number];

export interface Beam {
  a: Vec3;
  b: Vec3;
}

export interface SkyMeta {
  /** Unit vector toward the sun (day) or moon (night). */
  lightDir: Vec3;
  strength: number;
  color: Vec3;
  beams: Beam[];
}

export interface PanelMeta {
  p: Vec3;
  yaw: number;
  w: number;
  cover: string;
}

export interface GreenhouseMeta {
  lightmapExposure: number;
  /** Floor lightmap: planar projection of Blender XY bounds (x0, y0, x1, y1). */
  floor: { bounds: [number, number, number, number]; lm: [number, number] };
  day: SkyMeta;
  night: SkyMeta;
  bulbs: Vec3[];
  flames: Vec3[];
  panels: PanelMeta[];
  parked: { s: number; panel: { p: Vec3 } };
}

let pending: Promise<GreenhouseMeta> | null = null;

export function loadMeta(): Promise<GreenhouseMeta> {
  pending ??= fetch("/worlds/greenhouse/hi/greenhouse.json").then((r) => {
    if (!r.ok) throw new Error(`greenhouse meta: ${r.status}`);
    return r.json() as Promise<GreenhouseMeta>;
  });
  return pending;
}

export const HI = "/worlds/greenhouse/hi";

export function lightmapUrls(variant: Variant) {
  return {
    iron: `${HI}/lm-iron-${variant}.webp`,
    masonry: `${HI}/lm-masonry-${variant}.webp`,
    floor: `${HI}/lm-floor-${variant}.webp`,
    sky: `${HI}/sky-${variant}.webp`,
    env: `${HI}/env-${variant}.webp`,
  };
}

export const TILE_URLS = [`${HI}/tile-albedo.webp`, `${HI}/tile-normal.webp`, `${HI}/tile-rough.webp`];
/** Real-world size of one repeat of the Poly Haven tile scan, meters. */
export const TILE_SIZE = 2.15;
