#!/usr/bin/env node
/**
 * Post-process Cycles stills for the web.
 *
 *   node art/images.mjs layers <scene>     Convert art/out/<scene>/layers/*.png -> public/worlds/<scene>/layers/*.webp,
 *                                          copy the per-tag manifests, and composite each tag into a poster.
 *   node art/images.mjs pano <in.png> <out.webp> [width=4096]
 *   node art/images.mjs clean <in.png>     Median-filter a baked lightmap in place (removes fireflies).
 *
 * Layers keep alpha (webp alpha), posters are flattened (webp, 1920 wide).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "..");
const OUT = process.env.ART_OUT ?? join(ROOT, "art", "out");
const PUB = join(ROOT, "public", "worlds");

async function layers(scene, width = 1920) {
  const src = join(OUT, scene, "layers");
  const dst = join(PUB, scene, "layers");
  const posters = join(PUB, scene, "posters");
  mkdirSync(dst, { recursive: true });
  mkdirSync(posters, { recursive: true });
  const manifests = readdirSync(src).filter((f) => f.endsWith(".json"));
  const index = [];
  for (const mf of manifests) {
    const info = JSON.parse(readFileSync(join(src, mf), "utf8"));
    const composites = [];
    for (const layer of info.layers) {
      const png = join(src, layer.file);
      const webp = layer.file.replace(/\.png$/, ".webp");
      const isBack = composites.length === 0;
      await sharp(png).resize({ width, withoutEnlargement: true }).webp({ quality: isBack ? 78 : 82, alphaQuality: 90, effort: 6, smartSubsample: true }).toFile(join(dst, webp));
      composites.push(png);
      layer.file = webp;
    }
    writeFileSync(join(dst, mf), JSON.stringify(info));
    // Poster = layers alpha-composited back to front.
    const [back, ...rest] = composites;
    const meta = await sharp(back).metadata();
    const poster = await sharp(back)
      .composite(rest.map((input) => ({ input, blend: "over" })))
      .resize({ width: Math.min(width, meta.width ?? width) })
      .webp({ quality: 80, effort: 6 })
      .toFile(join(posters, `${info.tag}.webp`));
    index.push({ tag: info.tag, s: info.s, poster: `${info.tag}.webp`, width: poster.width, height: poster.height });
    console.log(`[images] ${scene}/${info.tag}: ${info.layers.length} layers + poster`);
  }
  index.sort((a, b) => a.s - b.s);
  writeFileSync(join(posters, "index.json"), JSON.stringify(index));
}

async function pano(input, output, width = 4096) {
  await sharp(input).resize({ width }).webp({ quality: 82, effort: 6 }).toFile(output);
  console.log(`[images] pano -> ${output}`);
}

async function clean(input) {
  const buf = await sharp(input).median(3).png().toBuffer();
  writeFileSync(input, buf);
  console.log(`[images] cleaned ${input}`);
}

const [cmd, a, b, c] = process.argv.slice(2);
const jobs = {
  layers: () => layers(a, b ? Number(b) : undefined),
  pano: () => pano(a, b, c ? Number(c) : undefined),
  clean: () => clean(a),
};
if (!jobs[cmd] || (cmd === "layers" && !existsSync(join(OUT, a ?? "", "layers")))) {
  console.error("usage: images.mjs layers <scene> | pano <in> <out> [w] | clean <png>");
  process.exit(1);
}
jobs[cmd]().catch((e) => {
  console.error(e);
  process.exit(1);
});
