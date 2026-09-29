/** Featured projects hung in the hall (written by art/worlds/museum/build.py from content/work). */
export interface CoverInfo {
  slug: string;
  title: string;
  category: string;
  year: number;
  cover: string;
  aspect: number;
}

/** Placement of each artwork and the light shafts (three.js coordinates). */
export interface MuseumLayout {
  art: {
    slug: string;
    center: [number, number, number];
    /** Unit vector out of the wall, into the hall. */
    normal: [number, number, number];
    right: [number, number, number];
    w: number;
    h: number;
    placard: [number, number, number];
    style: "gilded" | "modern";
  }[];
  /** Gallery spotlights on the entablature soffit, one per artwork. */
  spots: { pos: [number, number, number]; target: [number, number, number] }[];
  /** Skylight openings (four corners each, at ceiling height). */
  shafts: { top: [number, number, number][] }[];
  /** Direction toward the sun / moon per variant. */
  sun: { day: [number, number, number]; night: [number, number, number] };
}

export const OFFSET = 0.15;
export const RAIL = "/worlds/museum/rails.json";

const cache = new Map<string, Promise<unknown>>();
function json<T>(url: string): Promise<T> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json();
    });
    cache.set(url, p);
  }
  return p as Promise<T>;
}

export const loadCovers = () => json<CoverInfo[]>("/worlds/museum/covers.json");
export const loadLayout = () => json<MuseumLayout>("/worlds/museum/hi/layout.json");
