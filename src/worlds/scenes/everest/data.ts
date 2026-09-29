/**
 * Runtime mirror of art/worlds/everest (geo.mjs, route.mjs, build.py). The
 * build writes the terrain grid metadata, a quarter-resolution heightfield and
 * the draped route; this file loads them and re-implements the lookups the
 * Blender side uses (draw progress, route/camera spline sampling).
 *
 * Local space: 1 unit = 100 m, x east, y up (x exag), z south, origin at the
 * centre of the UTM grid and sea level.
 */

export interface Peak {
  lat: number;
  lon: number;
  ref: number;
  dem: number;
  local: [number, number, number];
}

export interface TerrainMeta {
  nx: number;
  ny: number;
  dx: number;
  width: number;
  height: number;
  unit: number;
  exag: number;
  tex: [number, number];
  hMin: number;
  hMax: number;
  heightBin: { w: number; h: number; step: number };
  peaks: Record<string, Peak>;
  bake?: Partial<Record<"day" | "night", { scale: number }>>;
  light?: Record<"day" | "night", { az: number; el: number }>;
}

export interface Waypoint {
  name: string;
  kind: "village" | "camp" | "hazard" | "ridge" | "summit";
  label: boolean;
  elev: number;
  dem: number;
  index: number;
  dist: number;
  pos: [number, number, number];
}

export interface RouteData {
  unit: number;
  exag: number;
  length: number;
  points: [number, number, number][];
  dist: number[];
  camera: [number, number, number][];
  cameraDist: number[];
  waypoints: Waypoint[];
  progress: [number, number][];
  drawStep: number;
  draw: number[];
}

export interface EverestData {
  meta: TerrainMeta;
  route: RouteData;
  /** Heights in meters, row 0 = north, `meta.heightBin` resolution. */
  heights: Uint16Array;
}

const BASE = "/worlds/everest/hi";
let pending: Promise<EverestData> | null = null;

export function loadEverest(): Promise<EverestData> {
  pending ??= (async () => {
    const [meta, route, bin] = await Promise.all([
      fetch(`${BASE}/terrain.json`).then((r) => r.json() as Promise<TerrainMeta>),
      fetch(`${BASE}/route.json`).then((r) => r.json() as Promise<RouteData>),
      fetch(`${BASE}/height.bin`).then((r) => r.arrayBuffer()),
    ]);
    return { meta, route, heights: new Uint16Array(bin) };
  })();
  return pending;
}

/** Terrain half extents in units (x, z). */
export function halfExtent(meta: TerrainMeta): [number, number] {
  return [meta.width / meta.unit / 2, meta.height / meta.unit / 2];
}

/** Ground elevation in meters at local (x, z), or null off the map. Peaks get their surveyed height back. */
export function elevationAt(data: EverestData, x: number, z: number): number | null {
  const { meta, heights } = data;
  const [hx, hz] = halfExtent(meta);
  if (x < -hx || x > hx || z < -hz || z > hz) return null;
  const { w, h, step } = meta.heightBin;
  const fx = Math.min(w - 1.001, Math.max(0, (((x + hx) / (2 * hx)) * (meta.nx - 1)) / step));
  const fy = Math.min(h - 1.001, Math.max(0, (((z + hz) / (2 * hz)) * (meta.ny - 1)) / step));
  const xi = Math.floor(fx);
  const yi = Math.floor(fy);
  const u = fx - xi;
  const v = fy - yi;
  const i = yi * w + xi;
  let m = (heights[i] * (1 - u) + heights[i + 1] * u) * (1 - v) + (heights[i + w] * (1 - u) + heights[i + w + 1] * u) * v;
  // The quarter-res field under-samples sharp summits: blend toward the surveyed peak.
  for (const p of Object.values(meta.peaks)) {
    const d = Math.hypot(x - p.local[0], z - p.local[2]);
    if (d < 4) m = Math.max(m, p.ref - (p.ref - m) * Math.min(1, (d / 4) ** 1.5));
  }
  return m;
}

/** Ground height in scene units at local (x, z) (0 off the map). */
export function groundY(data: EverestData, x: number, z: number): number {
  const m = elevationAt(data, x, z);
  return m === null ? 0 : (m * data.meta.exag) / data.meta.unit;
}

/** Route distance drawn at chapter time s (dense table from route.mjs). */
export function drawAt(route: RouteData, s: number): number {
  const f = Math.min(Math.max(s / route.drawStep, 0), route.draw.length - 1);
  const i = Math.min(Math.floor(f), route.draw.length - 2);
  return route.draw[i] + (route.draw[i + 1] - route.draw[i]) * (f - i);
}

function along(arr: [number, number, number][], dist: number[], d: number, out: [number, number, number]) {
  const dd = Math.min(Math.max(d, dist[0]), dist[dist.length - 1]);
  let lo = 0;
  let hi = dist.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (dist[m] <= dd) lo = m;
    else hi = m;
  }
  const t = (dd - dist[lo]) / Math.max(1e-9, dist[hi] - dist[lo]);
  for (let c = 0; c < 3; c++) out[c] = arr[lo][c] + (arr[hi][c] - arr[lo][c]) * t;
  return out;
}

/** Point on the detailed (drawn) route at distance d. */
export function routePoint(route: RouteData, d: number, out: [number, number, number] = [0, 0, 0]) {
  return along(route.points, route.dist, d, out);
}

/** Point on the smoothed camera spline at route distance d. */
export function cameraPoint(route: RouteData, d: number, out: [number, number, number] = [0, 0, 0]) {
  return along(route.camera, route.cameraDist, d, out);
}
