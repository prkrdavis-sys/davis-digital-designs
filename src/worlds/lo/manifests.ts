import type { SceneId, Variant } from "@/worlds/types";

/** One Cycles layer set rendered from a rail position (art/lib/ddd/render.py). */
export interface LayerManifest {
  tag: string;
  s: number;
  fov: number;
  aspect: number;
  layers: { band: string; file: string; depth: number }[];
}

export interface PosterEntry {
  tag: string;
  s: number;
  poster: string;
  width: number;
  height: number;
}

const json = new Map<string, Promise<unknown>>();

function load<T>(url: string): Promise<T> {
  let p = json.get(url);
  if (!p) {
    p = fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    json.set(url, p);
  }
  return p as Promise<T>;
}

/** Posters for a scene, or null if the scene has not been built yet. */
export function loadPosters(scene: SceneId): Promise<PosterEntry[] | null> {
  return load<PosterEntry[] | null>(`/worlds/${scene}/posters/index.json`);
}

export function variantOf(tag: string): Variant {
  return tag.startsWith("night") ? "night" : "day";
}

/** Layer manifests for one variant, sorted by chapter time. */
export async function loadLayerSets(scene: SceneId, variant: Variant): Promise<LayerManifest[]> {
  const posters = (await loadPosters(scene)) ?? [];
  const tags = posters.filter((p) => variantOf(p.tag) === variant);
  const sets = await Promise.all(tags.map((p) => load<LayerManifest | null>(`/worlds/${scene}/layers/${p.tag}.json`)));
  return sets.filter((s): s is LayerManifest => Boolean(s)).sort((a, b) => a.s - b.s);
}

/** Index of the entry whose chapter time is the last one at or before `s`. */
export function indexAt<T extends { s: number }>(list: T[], s: number): number {
  let k = 0;
  for (let i = 0; i < list.length; i++) if (list[i].s <= s + 1e-4) k = i;
  return k;
}
