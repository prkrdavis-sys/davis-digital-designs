#!/usr/bin/env node
/**
 * Web textures for the greenhouse runtime (everything except GLBs and layers):
 *   lightmaps  art/out/greenhouse/lightmaps/*.png -> public/.../hi/lm-*.webp (median-cleaned)
 *   sky        sky-{day,night}.png, env-{day,night}.png -> hi/*.webp
 *   tiles      Poly Haven floor scan -> hi/tile-{albedo,normal,rough}.webp
 */
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "../../..");
const OUT = join(process.env.ART_OUT ?? join(ROOT, "art", "out"), "greenhouse");
const CACHE = process.env.ART_CACHE ?? join(ROOT, "art", ".cache");
const HI = join(ROOT, "public", "worlds", "greenhouse", "hi");
mkdirSync(HI, { recursive: true });

async function webp(src, dst, { width, quality = 82, median = 0 } = {}) {
  if (!existsSync(src)) {
    console.warn(`[web] missing ${src}`);
    return;
  }
  let img = sharp(src);
  if (median) img = img.median(median);
  if (width) img = img.resize({ width, withoutEnlargement: true });
  const info = await img.webp({ quality, effort: 6, smartSubsample: true }).toFile(dst);
  console.log(`[web] ${dst.split("/").slice(-1)[0]} ${info.width}x${info.height} ${(info.size / 1024).toFixed(0)} KB`);
}

const jobs = {
  async lightmaps() {
    for (const v of ["day", "night"]) {
      for (const k of ["iron", "masonry"]) await webp(join(OUT, "lightmaps", `${k}-${v}.png`), join(HI, `lm-${k}-${v}.webp`), { quality: 86, median: 3 });
      await webp(join(OUT, "lightmaps", `floor-${v}.png`), join(HI, `lm-floor-${v}.webp`), { quality: 88, median: 3 });
    }
  },
  async sky() {
    for (const v of ["day", "night"]) {
      await webp(join(OUT, `sky-${v}.png`), join(HI, `sky-${v}.webp`), { quality: 84 });
      await webp(join(OUT, `env-${v}.png`), join(HI, `env-${v}.webp`), { quality: 80 });
    }
  },
  async tiles() {
    const d = join(CACHE, "polyhaven", "texture", "patterned_terracotta_tiling");
    await webp(join(d, "patterned_terracotta_tiling_diffuse_2k.png"), join(HI, "tile-albedo.webp"), { quality: 84 });
    await webp(join(d, "patterned_terracotta_tiling_normal_2k.png"), join(HI, "tile-normal.webp"), { width: 1024, quality: 88 });
    await webp(join(d, "patterned_terracotta_tiling_rough_2k.png"), join(HI, "tile-rough.webp"), { width: 1024, quality: 80 });
  },
};

const which = process.argv.slice(2);
for (const name of which.length ? which : Object.keys(jobs)) {
  if (!jobs[name]) {
    console.error(`unknown job ${name}; have ${Object.keys(jobs).join(", ")}`);
    process.exit(1);
  }
  await jobs[name]();
}
