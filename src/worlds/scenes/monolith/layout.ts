export interface MonolithLayout {
  facets: { name: string; label: string; tint: string; home: [number, number, number] }[];
  focus: [number, number, number];
  /** Ceiling slot in three.js: x across the room, z along it, ceil is the opening's height. */
  slot: { x0: number; x1: number; z0: number; z1: number; ceil: number };
  sun: [number, number, number];
}

export const RAIL = "/worlds/monolith/rails.json";
const LAYOUT = "/worlds/monolith/hi/layout.json";

let layoutPromise: Promise<MonolithLayout> | null = null;

export function loadLayout(): Promise<MonolithLayout> {
  layoutPromise ??= fetch(LAYOUT).then((r) => {
    if (!r.ok) throw new Error(`monolith layout: ${r.status}`);
    return r.json() as Promise<MonolithLayout>;
  });
  return layoutPromise;
}
