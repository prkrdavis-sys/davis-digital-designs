#!/usr/bin/env node
/**
 * Cloud impostor atlas PNG -> WebP. The channels are light passes (not
 * colors), so encode losslessly: lossy WebP would subsample chroma and bleed
 * the left/right/ambient passes into each other.
 *   node art/worlds/planes/atlas.mjs <in.png> <out.webp>
 */
import sharp from "sharp";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: atlas.mjs <in.png> <out.webp>");
  process.exit(1);
}
const info = await sharp(input).webp({ lossless: true, effort: 6, exact: true }).toFile(output);
console.log(`[atlas] ${output} ${(info.size / 1e6).toFixed(2)} MB`);
