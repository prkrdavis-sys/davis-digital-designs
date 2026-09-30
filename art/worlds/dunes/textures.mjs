#!/usr/bin/env node
/**
 * Dunes Blender outputs -> runtime textures.
 *
 *   node art/worlds/dunes/textures.mjs
 *
 * art/out/dunes/sky-<v>.png, light-<v>.png, terrain-data.png   -> public/worlds/dunes/hi/*.webp
 * art/out/dunes/dunes_meta.json                                 -> public/worlds/dunes/hi/dunes.json
 * Poly Haven coast_sand_05 (CC0) diffuse + normal               -> sand-albedo.webp (neutral grey grain), sand-normal.webp
 *
 * Blender writes row 0 at the bottom; the runtime samples with flipY (three.js
 * default for images), so the PNGs are converted as-is.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "../../..");
const OUT = join(process.env.ART_OUT ?? join(ROOT, "art", "out"), "dunes");
const CACHE = process.env.ART_CACHE ?? join(ROOT, "art", ".cache");
const HI = join(ROOT, "public", "worlds", "dunes", "hi");
mkdirSync(HI, { recursive: true });

const mb = (info) => `${(info.size / 1e6).toFixed(2)} MB`;

async function webp(src, dst, opts) {
  if (!existsSync(src)) {
    console.warn(`[dunes] missing ${src}`);
    return;
  }
  const info = await sharp(src).removeAlpha().webp({ effort: 6, ...opts }).toFile(join(HI, dst));
  console.log(`[dunes] ${dst} ${info.width}x${info.height} ${mb(info)}`);
}

// Skies: smooth gradients plus stars; keep chroma sharp for the stars.
for (const v of ["day", "night"]) await webp(join(OUT, `sky-${v}.png`), `sky-${v}.webp`, { quality: v === "night" ? 90 : 86, smartSubsample: true });
// Irradiance (gamma-encoded, scale in dunes.json).
for (const v of ["day", "night"]) await webp(join(OUT, `light-${v}.png`), `light-${v}.webp`, { quality: 88, smartSubsample: true });
// Normals (RG) and sun visibility (B). Near-lossless keeps the brinks crisp.
await webp(join(OUT, "terrain-data.png"), "terrain-data.webp", { nearLossless: true, quality: 60 });

if (existsSync(join(OUT, "dunes_meta.json"))) {
  copyFileSync(join(OUT, "dunes_meta.json"), join(HI, "dunes.json"));
  console.log("[dunes] dunes.json");
}

// Close-up sand grain: luminance only, normalized to a mid grey so the runtime
// multiplies it around 1.0 without shifting the painted sand color.
const sand = join(CACHE, "polyhaven", "texture", "coast_sand_05");
const diff = join(sand, "coast_sand_05_diffuse_1k.png");
const nrm = join(sand, "coast_sand_05_normal_1k.png");
if (existsSync(diff)) {
  const { data, info } = await sharp(diff).greyscale().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  let sq = 0;
  for (const v of data) {
    sum += v;
    sq += v * v;
  }
  const mean = sum / data.length;
  const sd = Math.sqrt(sq / data.length - mean * mean) || 1;
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(128 + ((data[i] - mean) / sd) * 42)));
  const r = await sharp(out, { raw: { width: info.width, height: info.height, channels: 1 } }).toColourspace("b-w").webp({ quality: 82, effort: 6 }).toFile(join(HI, "sand-albedo.webp"));
  console.log(`[dunes] sand-albedo.webp ${mb(r)}`);
  await webp(nrm, "sand-normal.webp", { quality: 86, smartSubsample: true });
} else {
  console.warn("[dunes] sand texture not cached: node art/fetch/polyhaven.mjs texture coast_sand_05 1k");
}
