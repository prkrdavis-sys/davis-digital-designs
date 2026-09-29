#!/usr/bin/env node
/**
 * Shrink a Blender GLB for the web.
 *
 *   node art/optimize.mjs <in.glb> <out.glb> [--size 2048] [--tex mixed|webp|uastc|etc1s|none] [--simplify 0]
 *
 * mixed (default): UASTC+RDO for normal/ORM maps, high-quality ETC1S for color
 * and baked emissive maps. KTX2 stays compressed in GPU memory, which matters
 * more than download size once a world has a dozen 2K textures.
 * Scene structure and node names are preserved because runtime code finds
 * objects by name.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
const [input, output] = args;
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const size = opt("size", "2048");
const tex = opt("tex", "mixed");
const simplify = Number(opt("simplify", "0"));

if (!input || !output) {
  console.error("usage: optimize.mjs <in.glb> <out.glb> [--size 2048] [--tex mixed|webp|uastc|etc1s|none] [--simplify 0]");
  process.exit(1);
}

const bin = join(dirname(new URL(import.meta.url).pathname), "..", "node_modules", ".bin", "gltf-transform");
const tmp = join(tmpdir(), `ddd-opt-${process.pid}`);
mkdirSync(tmp, { recursive: true });
mkdirSync(dirname(output), { recursive: true });

function run(...a) {
  execFileSync(bin, a, { stdio: ["ignore", "ignore", "inherit"] });
}

const stage1 = join(tmp, "1.glb");
run(
  "optimize", input, stage1,
  "--compress", "false",
  "--texture-compress", tex === "webp" ? "webp" : "false",
  "--texture-size", size,
  "--flatten", "false",
  "--join", "false",
  "--palette", "false",
  "--instance", "true",
  "--simplify", simplify > 0 ? "true" : "false",
  ...(simplify > 0 ? ["--simplify-ratio", String(simplify), "--simplify-error", "0.001"] : []),
);

let current = stage1;
const next = (name) => join(tmp, `${name}.glb`);
if (tex === "mixed" || tex === "uastc") {
  const out = next("2");
  run("uastc", current, out, "--level", "2", "--rdo", "--zstd", "18", ...(tex === "mixed" ? ["--slots", "{normalTexture,occlusionTexture,metallicRoughnessTexture,clearcoatNormalTexture}"] : []));
  current = out;
}
if (tex === "mixed" || tex === "etc1s") {
  const out = next("3");
  run("etc1s", current, out, "--quality", "255", "--compression", "2", ...(tex === "mixed" ? ["--slots", "{baseColorTexture,emissiveTexture,sheenColorTexture,transmissionTexture}"] : []));
  current = out;
}
const out4 = next("4");
run("meshopt", current, out4, "--level", "high");
copyFileSync(out4, output);
rmSync(tmp, { recursive: true, force: true });

const mb = (p) => (statSync(p).size / 1e6).toFixed(2);
console.log(`[optimize] ${input.split("/").pop()} ${mb(input)} MB -> ${output.split("/").pop()} ${mb(output)} MB (${tex}, ${size}px)`);
