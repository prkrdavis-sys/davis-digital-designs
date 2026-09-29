#!/usr/bin/env node
/**
 * art/optimize.mjs, but keeps unused vertex attributes: the lightmap UVs
 * (TEXCOORD_1) have no texture in the GLB (lightmaps ship as separate webp
 * files per variant), so the default prune would strip them.
 *
 *   node art/worlds/snowglobe/optimize-lm.mjs <in.glb> <out.glb> [--size 2048] [--tex mixed|none]
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

const bin = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "node_modules", ".bin", "gltf-transform");
const tmp = join(tmpdir(), `ddd-optlm-${process.pid}`);
mkdirSync(tmp, { recursive: true });
mkdirSync(dirname(output), { recursive: true });
const run = (...a) => execFileSync(bin, a, { stdio: ["ignore", "ignore", "inherit"] });

let current = join(tmp, "1.glb");
run("optimize", input, current, "--compress", "false", "--texture-compress", "false", "--texture-size", size, "--flatten", "false", "--join", "false", "--palette", "false", "--instance", "false", "--simplify", "false", "--prune-attributes", "false");
if (tex === "mixed") {
  const a = join(tmp, "2.glb");
  run("uastc", current, a, "--level", "2", "--rdo", "--zstd", "18", "--slots", "{normalTexture,occlusionTexture,metallicRoughnessTexture,clearcoatNormalTexture}");
  const b = join(tmp, "3.glb");
  run("etc1s", a, b, "--quality", "255", "--compression", "2", "--slots", "{baseColorTexture,emissiveTexture,sheenColorTexture,transmissionTexture}");
  current = b;
}
const out = join(tmp, "4.glb");
run("meshopt", current, out, "--level", "high");
copyFileSync(out, output);
rmSync(tmp, { recursive: true, force: true });
const mb = (p) => (statSync(p).size / 1e6).toFixed(2);
console.log(`[optimize-lm] ${input.split("/").pop()} ${mb(input)} MB -> ${output.split("/").pop()} ${mb(output)} MB`);
