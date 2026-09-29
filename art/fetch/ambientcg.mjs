#!/usr/bin/env node
/**
 * ambientCG (CC0) PBR material fetcher.
 *   node art/fetch/ambientcg.mjs <assetId> [res=2K] [format=JPG|PNG]
 *   node art/fetch/ambientcg.mjs search <term>
 * Downloads and unzips into art/.cache/ambientcg/<assetId>/ and prints the map paths.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cachePath, download, getJson, log } from "./lib.mjs";

const API = "https://ambientcg.com/api/v2/full_json";

function classify(file) {
  const f = file.toLowerCase();
  if (f.includes("_color")) return "diffuse";
  if (f.includes("_normalgl")) return "normal";
  if (f.includes("_roughness")) return "rough";
  if (f.includes("_ambientocclusion")) return "ao";
  if (f.includes("_displacement")) return "disp";
  if (f.includes("_metalness")) return "metal";
  if (f.includes("_opacity")) return "opacity";
  return null;
}

export async function fetchMaterial(id, res = "2K", format = "JPG") {
  const dir = cachePath("ambientcg", id, "x").replace(/x$/, "");
  const zip = join(dir, `${id}_${res}-${format}.zip`);
  if (!existsSync(join(dir, ".unzipped"))) {
    const url = `https://ambientcg.com/get?file=${id}_${res}-${format}.zip`;
    await download(url, zip);
    execFileSync("unzip", ["-o", "-q", zip, "-d", dir]);
    execFileSync("touch", [join(dir, ".unzipped")]);
  }
  const out = {};
  for (const f of readdirSync(dir)) {
    const kind = classify(f);
    if (kind && !out[kind]) out[kind] = join(dir, f);
  }
  return out;
}

export async function search(term) {
  const data = await getJson(`${API}?type=Material&q=${encodeURIComponent(term)}&limit=30&include=displayData`);
  return (data.foundAssets ?? []).map((a) => a.assetId);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [a, b, c] = process.argv.slice(2);
  const run = a === "search" ? () => search(b) : () => fetchMaterial(a, b ?? "2K", c ?? "JPG");
  run()
    .then((r) => {
      log("ambientcg", a, b ?? "");
      console.log(JSON.stringify(r, null, 2));
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
