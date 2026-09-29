#!/usr/bin/env node
/** art/out/snowglobe/lm/<group>-<variant>.png -> public/worlds/snowglobe/hi/lm-<group>-<variant>.webp */
import { mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "..", "..", "..");
const src = join(process.env.ART_OUT ?? join(ROOT, "art", "out"), "snowglobe", "lm");
const dst = join(ROOT, "public", "worlds", "snowglobe", "hi");
mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src).filter((f) => f.endsWith(".png"))) {
  const out = join(dst, `lm-${f.replace(/\.png$/, ".webp")}`);
  const info = await sharp(join(src, f)).webp({ quality: 88, effort: 6 }).toFile(out);
  console.log(`[lightmaps] ${f} -> ${out.split("/").pop()} ${(info.size / 1024).toFixed(0)} KB`);
}
