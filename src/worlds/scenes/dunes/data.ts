import * as THREE from "three";

/** Layout baked by art/worlds/dunes (Blender axes, meters; convert with `b2t`). */
export interface DunesMeta {
  core: { x0: number; y0: number; size: number };
  sun: { azimuth: number; elevation: number; dir: [number, number, number] };
  monoliths: {
    id: string;
    p: [number, number];
    yaw: number;
    h: number;
    w: number;
    kind: "glass" | "metal" | "stone";
    lean: number;
    product: number;
    ground: number;
    base: number;
    thickness: number;
  }[];
  footprints: { p: [number, number, number]; yaw: number; side: number }[];
  props: { kind: string; p: [number, number]; yaw: number; scale: number; sink: number }[];
  ridges: [number, number, number][][];
  field: { res: number; min: number; max: number };
  light: Record<"day" | "night", { scale: number }>;
  sMax: number;
}

export interface Product {
  slug: string;
  title: string;
  tagline: string;
  price: number;
  tier: "grab-and-go" | "made-to-order";
  accent: string;
  cover: string;
  tags: string[];
}

export interface DunesData {
  meta: DunesMeta;
  products: Product[];
  /** Height field over the core square, meters, row 0 = y0 (south). */
  field: Float32Array;
}

export const BASE = "/worlds/dunes";

/** Blender (x, y, z) -> three.js (x, z, -y). */
export function b2t(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x, z, -y);
}

let pending: Promise<DunesData> | null = null;

export function loadDunes(): Promise<DunesData> {
  if (!pending) {
    pending = Promise.all([
      fetch(`${BASE}/hi/dunes.json`).then((r) => r.json() as Promise<DunesMeta>),
      fetch(`${BASE}/hi/panels.json`).then((r) => r.json() as Promise<Product[]>),
      fetch(`${BASE}/hi/field.bin`).then((r) => r.arrayBuffer()),
    ]).then(([meta, products, buf]) => {
      const q = new Uint16Array(buf);
      const field = new Float32Array(q.length);
      const { min, max } = meta.field;
      for (let i = 0; i < q.length; i++) field[i] = min + (q[i] / 65535) * (max - min);
      return { meta, products, field };
    });
  }
  return pending;
}

/** Bilinear height (meters) at a three.js (x, z) position; clamps outside the core. */
export function heightAt(data: DunesData, x: number, z: number): number {
  const { core } = data.meta;
  const n = data.meta.field.res;
  const u = ((x - core.x0) / core.size) * n - 0.5;
  const v = ((-z - core.y0) / core.size) * n - 0.5;
  const i = Math.min(n - 2, Math.max(0, Math.floor(u)));
  const j = Math.min(n - 2, Math.max(0, Math.floor(v)));
  const fu = Math.min(1, Math.max(0, u - i));
  const fv = Math.min(1, Math.max(0, v - j));
  const h = data.field;
  const a = h[j * n + i] + (h[j * n + i + 1] - h[j * n + i]) * fu;
  const b = h[(j + 1) * n + i] + (h[(j + 1) * n + i + 1] - h[(j + 1) * n + i]) * fu;
  return a + (b - a) * fv;
}

/** The field as a float texture for shaders (R = height in meters). */
export function fieldTexture(data: DunesData): THREE.DataTexture {
  const n = data.meta.field.res;
  const tex = new THREE.DataTexture(data.field, n, n, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Sun (or moon) direction in three.js axes. */
export function lightDir(data: DunesData): THREE.Vector3 {
  const d = data.meta.sun.dir;
  return new THREE.Vector3(d[0], d[2], -d[1]).normalize();
}
