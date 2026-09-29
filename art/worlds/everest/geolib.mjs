/** Shared Everest geodata helpers: UTM 45N, the metric grid, local coordinates. */
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ART = resolve(HERE, "..", "..");
export const CACHE = process.env.ART_CACHE ?? join(ART, ".cache");
export const OUT = join(process.env.ART_OUT ?? join(ART, "out"), "everest");
export const PUB = join(ART, "..", "public", "worlds", "everest");
for (const d of [OUT, join(PUB, "hi")]) mkdirSync(d, { recursive: true });

// Crop: Lukla to beyond the summit ridge (Rongbuk to the north, Kangshung to the east).
export const BBOX = { minLat: 27.63, maxLat: 28.13, minLon: 86.6, maxLon: 87.08 };
export const DX = 30; // meters per grid sample (GLO-30 native)
export const UNIT = 100; // meters per scene unit
export const EXAG = 1.15;
export const TEX_H = 4096;

// ---------------------------------------------------------------- UTM (WGS84, Snyder)
const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const LON0 = (87 * Math.PI) / 180; // zone 45
export const rad = (d) => (d * Math.PI) / 180;
export const deg = (r) => (r * 180) / Math.PI;

function meridian(phi) {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  return A * ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi - ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) - ((35 * e6) / 3072) * Math.sin(6 * phi));
}

export function toUtm(lat, lon) {
  const phi = rad(lat);
  const n = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
  const t = Math.tan(phi) ** 2;
  const c = EP2 * Math.cos(phi) ** 2;
  const a = Math.cos(phi) * (rad(lon) - LON0);
  const x = K0 * n * (a + ((1 - t + c) * a ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120) + 500000;
  const y = K0 * (meridian(phi) + n * Math.tan(phi) * ((a * a) / 2 + ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24 + ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720));
  return [x, y];
}

export function fromUtm(x, y) {
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const mu = y / K0 / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256));
  const p1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const c1 = EP2 * Math.cos(p1) ** 2;
  const t1 = Math.tan(p1) ** 2;
  const n1 = A / Math.sqrt(1 - E2 * Math.sin(p1) ** 2);
  const r1 = (A * (1 - E2)) / (1 - E2 * Math.sin(p1) ** 2) ** 1.5;
  const d = (x - 500000) / (n1 * K0);
  const lat = p1 - ((n1 * Math.tan(p1)) / r1) * ((d * d) / 2 - ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4) / 24 + ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6) / 720);
  const lon = LON0 + (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5) / 120) / Math.cos(p1);
  return [deg(lat), deg(lon)];
}

// ---------------------------------------------------------------- grid definition
export function gridSpec() {
  const corners = [
    [BBOX.minLat, BBOX.minLon],
    [BBOX.minLat, BBOX.maxLon],
    [BBOX.maxLat, BBOX.minLon],
    [BBOX.maxLat, BBOX.maxLon],
  ].map(([la, lo]) => toUtm(la, lo));
  // Inscribed rectangle so every sample is inside the lat/lon box.
  const e0 = Math.ceil(Math.max(corners[0][0], corners[2][0]) / DX) * DX;
  const e1 = Math.floor(Math.min(corners[1][0], corners[3][0]) / DX) * DX;
  const n0 = Math.ceil(Math.max(corners[0][1], corners[1][1]) / DX) * DX;
  const n1 = Math.floor(Math.min(corners[2][1], corners[3][1]) / DX) * DX;
  const nx = Math.round((e1 - e0) / DX) + 1;
  const ny = Math.round((n1 - n0) / DX) + 1;
  const w = (nx - 1) * DX;
  const h = (ny - 1) * DX;
  const texW = Math.round((TEX_H * w) / h / 4) * 4;
  return { e0, e1, n0, n1, nx, ny, dx: DX, ec: (e0 + e1) / 2, nc: (n0 + n1) / 2, width: w, height: h, unit: UNIT, exag: EXAG, tex: [texW, TEX_H] };
}

/** UTM -> three.js local (units). */
export function toLocal(g, e, n, hMeters) {
  return [(e - g.ec) / UNIT, (hMeters * EXAG) / UNIT, -(n - g.nc) / UNIT];
}

export function readGrid(g) {
  const buf = readFileSync(join(OUT, "dem.f32"));
  return new Float32Array(buf.buffer, buf.byteOffset, g.nx * g.ny);
}

export function gridHeight(g, H, e, n) {
  const fx = Math.min(g.nx - 1.001, Math.max(0, (e - g.e0) / g.dx));
  const fy = Math.min(g.ny - 1.001, Math.max(0, (g.n1 - n) / g.dx));
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  const u = fx - x;
  const v = fy - y;
  const i = y * g.nx + x;
  return (H[i] * (1 - u) + H[i + 1] * u) * (1 - v) + (H[i + g.nx] * (1 - u) + H[i + g.nx + 1] * u) * v;
}

export function gridNormals(g, H) {
  // Normals of the exaggerated surface, in three.js axes (x east, y up, z south).
  const N = new Float32Array(g.nx * g.ny * 3);
  for (let y = 0; y < g.ny; y++) {
    for (let x = 0; x < g.nx; x++) {
      const i = y * g.nx + x;
      const hl = H[y * g.nx + Math.max(0, x - 1)];
      const hr = H[y * g.nx + Math.min(g.nx - 1, x + 1)];
      const hn = H[Math.max(0, y - 1) * g.nx + x];
      const hs = H[Math.min(g.ny - 1, y + 1) * g.nx + x];
      const dhdx = ((hr - hl) * EXAG) / (2 * g.dx);
      const dhdz = ((hs - hn) * EXAG) / (2 * g.dx); // +z is south, row+1 is south
      let nx = -dhdx;
      let ny = 1;
      let nz = -dhdz;
      const l = Math.hypot(nx, ny, nz);
      N[i * 3] = nx / l;
      N[i * 3 + 1] = ny / l;
      N[i * 3 + 2] = nz / l;
    }
  }
  return N;
}

export function castShadow(g, H, azDeg, elDeg, maxDist = 14000) {
  const out = new Float32Array(g.nx * g.ny);
  const dxs = Math.sin(rad(azDeg)); // east
  const dns = Math.cos(rad(azDeg)); // north
  const rise = Math.tan(rad(elDeg)) / EXAG; // meters of real height per meter (exaggerated terrain casts longer)
  const step = g.dx * 0.75;
  const n = Math.floor(maxDist / step);
  for (let y = 0; y < g.ny; y++) {
    for (let x = 0; x < g.nx; x++) {
      const h0 = H[y * g.nx + x] + 2;
      let lit = 1;
      for (let k = 1; k <= n; k++) {
        const px = x + (dxs * step * k) / g.dx;
        const py = y - (dns * step * k) / g.dx;
        if (px < 0 || py < 0 || px >= g.nx - 1 || py >= g.ny - 1) break;
        const ray = h0 + rise * step * k;
        if (ray > 8900) break;
        const xi = px | 0;
        const yi = py | 0;
        const u = px - xi;
        const v = py - yi;
        const i = yi * g.nx + xi;
        const th = (H[i] * (1 - u) + H[i + 1] * u) * (1 - v) + (H[i + g.nx] * (1 - u) + H[i + g.nx + 1] * u) * v;
        if (th > ray) {
          lit = 0;
          break;
        }
      }
      out[y * g.nx + x] = lit;
    }
  }
  return out;
}

export function loadMeta() {
  return JSON.parse(readFileSync(join(OUT, "terrain.json"), "utf8"));
}
