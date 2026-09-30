/**
 * A relightable cumulus atlas for the paper-planes world, used until
 * art/worlds/planes/pl_atlas.py (Cycles) replaces public/worlds/planes/hi/clouds.*.
 * Channels match the runtime: R = light from the left, G = light from the right,
 * B = ambient, A = coverage, RGB stored as sqrt(value / vmax).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ATLAS_W = 1024;
const ATLAS_H = 640;
const PUB = path.resolve("public/worlds/planes/hi");

const CELLS = [
  { kind: "puff", x: 0, y: 0, w: 256, h: 256, seed: 3 },
  { kind: "puff", x: 256, y: 0, w: 256, h: 256, seed: 11 },
  { kind: "puff", x: 512, y: 0, w: 256, h: 256, seed: 19 },
  { kind: "puff", x: 768, y: 0, w: 256, h: 256, seed: 29 },
  { kind: "tower", x: 0, y: 256, w: 256, h: 384, seed: 41 },
  { kind: "tower", x: 256, y: 256, w: 256, h: 384, seed: 53 },
  { kind: "tower", x: 512, y: 256, w: 256, h: 384, seed: 67 },
  { kind: "tower", x: 768, y: 256, w: 256, h: 384, seed: 83 },
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function blobsFor(kind, seed) {
  const rnd = mulberry32(seed);
  const blobs = [];
  const stack = kind === "tower" ? 4 : 1;
  for (let s = 0; s < stack; s++) {
    const y = kind === "tower" ? 0.8 - s * 0.18 : 0.5;
    const scale = kind === "tower" ? 1 - s * 0.14 : 1;
    for (let i = 0; i < 3; i++) {
      blobs.push({
        x: 0.5 + (rnd() - 0.5) * 0.36 * scale,
        y: y + (rnd() - 0.5) * 0.07,
        rx: (kind === "tower" ? 0.1 : 0.16 + rnd() * 0.06) * scale,
        ry: (kind === "tower" ? 0.08 : 0.12 + rnd() * 0.04) * scale,
        w: 0.9 + rnd() * 0.35,
      });
    }
  }
  return blobs;
}

function paintCell(cell) {
  const { w, h, kind } = cell;
  const blobs = blobsFor(kind, cell.seed);
  const density = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const v = (y + 0.5) / h;
      let d = 0;
      for (const b of blobs) {
        const dx = (u - b.x) / b.rx;
        const dy = (v - b.y) / b.ry;
        d += b.w * Math.exp(-(dx * dx + dy * dy));
      }
      const edge = smooth(0.0, 0.08, u) * smooth(0.0, 0.08, 1 - u) * smooth(0.0, 0.06, v) * smooth(0.0, 0.05, 1 - v);
      const lo = kind === "tower" ? 0.55 : 0.48;
      density[y * w + x] = smooth(lo, lo + 0.7, d) * edge;
    }
  }
  const rgba = new Float32Array(w * h * 4);
  const light = (x, y, z) => {
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
  };
  const L = light(-0.85, -0.35, 0.55);
  const R = light(0.85, -0.35, 0.55);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = density[i];
      if (a < 0.004) continue;
      const gx = density[i + 1] - density[i - 1];
      const gy = density[i + w] - density[i - w];
      let nx = -gx;
      let ny = -gy;
      let nz = 0.22 + a * 0.35;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const shade = (s) => Math.max(0, nx * s[0] + ny * s[1] + nz * s[2]);
      const o = i * 4;
      rgba[o] = shade(L) * 1.35 + a * 0.08;
      rgba[o + 1] = shade(R) * 1.35 + a * 0.08;
      rgba[o + 2] = 0.25 + a * 0.85;
      rgba[o + 3] = a;
    }
  }
  return rgba;
}

const atlas = new Float32Array(ATLAS_W * ATLAS_H * 4);
const meta = [];
for (const cell of CELLS) {
  const painted = paintCell(cell);
  for (let y = 0; y < cell.h; y++) {
    for (let x = 0; x < cell.w; x++) {
      const s = (y * cell.w + x) * 4;
      const d = ((cell.y + y) * ATLAS_W + (cell.x + x)) * 4;
      atlas[d] = painted[s];
      atlas[d + 1] = painted[s + 1];
      atlas[d + 2] = painted[s + 2];
      atlas[d + 3] = painted[s + 3];
    }
  }
  const aspect = cell.kind === "tower" ? [46, 92] : [58, 40];
  meta.push({
    kind: cell.kind,
    uv: [cell.x / ATLAS_W, cell.y / ATLAS_H, cell.w / ATLAS_W, cell.h / ATLAS_H],
    size: aspect,
  });
}

const lit = [];
for (let i = 0; i < atlas.length; i += 4) {
  if (atlas[i + 3] > 0.05) lit.push(atlas[i], atlas[i + 1], atlas[i + 2]);
}
lit.sort((a, b) => a - b);
const vmax = lit.length ? lit[Math.floor(lit.length * 0.997)] : 1;

const bytes = Buffer.alloc(ATLAS_W * ATLAS_H * 4);
for (let i = 0; i < ATLAS_W * ATLAS_H; i++) {
  const o = i * 4;
  bytes[o] = Math.round(Math.sqrt(Math.min(1, Math.max(0, atlas[o] / vmax))) * 255);
  bytes[o + 1] = Math.round(Math.sqrt(Math.min(1, Math.max(0, atlas[o + 1] / vmax))) * 255);
  bytes[o + 2] = Math.round(Math.sqrt(Math.min(1, Math.max(0, atlas[o + 2] / vmax))) * 255);
  bytes[o + 3] = Math.round(Math.min(1, Math.max(0, atlas[o + 3])) * 255);
}

await mkdir(PUB, { recursive: true });
await sharp(bytes, { raw: { width: ATLAS_W, height: ATLAS_H, channels: 4 } })
  .webp({ lossless: true, effort: 4, exact: true })
  .toFile(path.join(PUB, "clouds.webp"));
await writeFile(
  path.join(PUB, "clouds.json"),
  JSON.stringify({ vmax: Math.round(vmax * 10000) / 10000, encoding: "sqrt", cells: meta }, null, 1),
);
console.log("wrote clouds atlas", "vmax", vmax.toFixed(3), "cells", meta.length);
