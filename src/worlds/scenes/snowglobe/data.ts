import * as THREE from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import type { Variant } from "@/worlds/types";

/** Layout and tracks exported by art/worlds/snowglobe (sg_model.export_meta + the bake step). */
export interface SnowMeta {
  globe: { center: [number, number, number]; rOut: number; rIn: number; baseTop: number; villageR: number };
  pond: { center: [number, number, number]; rx: number; ry: number };
  skaters: { r: number; w: number; phase: number }[];
  glow: Record<string, { color: string; day: number; night: number }>;
  covers: Record<string, string>;
  sMax: number;
  /** [s, value] keys: how hard the globe has just been shaken. */
  shake: [number, number][];
  /** [s, x, y, z] keys: what the camera is looking at (depth of field target). */
  focus: [number, number, number, number][];
  /** Lightmap scale per group and variant (the webp stores irradiance / scale). */
  lightmaps: Record<string, Record<Variant, number>>;
}

export const BASE = "/worlds/snowglobe";

let metaPromise: Promise<SnowMeta> | null = null;
export function loadMeta(): Promise<SnowMeta> {
  metaPromise ??= fetch(`${BASE}/hi/snowglobe.json`).then((r) => {
    if (!r.ok) throw new Error(`snowglobe.json: ${r.status}`);
    return r.json() as Promise<SnowMeta>;
  });
  return metaPromise;
}

/** Snow surface points for glints: float32 [x, y, z, nx, ny, nz] * n. */
let sparklePromise: Promise<Float32Array> | null = null;
export function loadSparkle(): Promise<Float32Array> {
  sparklePromise ??= fetch(`${BASE}/hi/sparkle.bin`)
    .then((r) => (r.ok ? r.arrayBuffer() : new ArrayBuffer(0)))
    .then((b) => new Float32Array(b));
  return sparklePromise;
}

const hdrCache = new Map<string, Promise<THREE.DataTexture>>();
/** Equirect HDR (rendered from the globe centre in Blender, already in three.js orientation): half-float DWAA EXR. */
export function loadHDR(url: string): Promise<THREE.DataTexture> {
  let p = hdrCache.get(url);
  if (!p) {
    p = new EXRLoader().loadAsync(url).then((t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      return t;
    });
    hdrCache.set(url, p);
  }
  return p;
}

export const envUrl = (v: Variant) => `${BASE}/hi/env-${v}.exr`;
export const bgUrl = (v: Variant) => `${BASE}/hi/bg-${v}.exr`;
export const lightmapUrl = (group: string, v: Variant) => `${BASE}/hi/lm-${group}-${v}.webp`;
export const LIGHTMAP_GROUPS = ["village", "trees", "desk", "props"] as const;

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smoothstep interpolation over [s, value] keys (matches sg_model.track). */
export function sampleScalar(keys: [number, number][], s: number): number {
  if (s <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [s0, v0] = keys[i];
    const [s1, v1] = keys[i + 1];
    if (s <= s1) return v0 + (v1 - v0) * smooth((s - s0) / (s1 - s0));
  }
  return keys[keys.length - 1][1];
}

export function sampleVec3(keys: [number, number, number, number][], s: number, out: THREE.Vector3): THREE.Vector3 {
  if (s <= keys[0][0]) return out.set(keys[0][1], keys[0][2], keys[0][3]);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (s <= b[0]) {
      const t = smooth((s - a[0]) / (b[0] - a[0]));
      return out.set(a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t);
    }
  }
  const z = keys[keys.length - 1];
  return out.set(z[1], z[2], z[3]);
}
