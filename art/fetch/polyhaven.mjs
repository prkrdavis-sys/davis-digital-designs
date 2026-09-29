#!/usr/bin/env node
/**
 * Poly Haven (CC0) fetcher.
 *   node art/fetch/polyhaven.mjs hdri <id> [res=2k] [format=hdr|exr]
 *   node art/fetch/polyhaven.mjs texture <id> [res=2k]      -> diffuse, normal (GL), rough, ao, disp, arm
 *   node art/fetch/polyhaven.mjs model <id> [res=2k]        -> .blend with its texture folder
 *   node art/fetch/polyhaven.mjs search <type> <term>
 * Files land in art/.cache/polyhaven/<type>/<id>/ and the path is printed.
 */
import { join } from "node:path";
import { cachePath, download, getJson, log } from "./lib.mjs";

const API = "https://api.polyhaven.com";

export async function fetchHdri(id, res = "2k", format = "hdr") {
  const files = await getJson(`${API}/files/${id}`);
  const entry = files.hdri?.[res]?.[format];
  if (!entry) throw new Error(`hdri ${id} has no ${res}/${format}`);
  const dest = cachePath("polyhaven", "hdri", id, `${id}_${res}.${format}`);
  await download(entry.url, dest);
  return dest;
}

const TEXTURE_MAPS = {
  diffuse: ["Diffuse", "diff"],
  normal: ["nor_gl"],
  rough: ["Rough", "rough"],
  ao: ["AO", "ao"],
  disp: ["Displacement", "disp"],
  arm: ["arm"],
  metal: ["Metal", "metal"],
};

export async function fetchTexture(id, res = "2k") {
  const files = await getJson(`${API}/files/${id}`);
  const out = {};
  for (const [name, keys] of Object.entries(TEXTURE_MAPS)) {
    const key = keys.find((k) => files[k]?.[res]);
    if (!key) continue;
    const variants = files[key][res];
    const entry = variants.png ?? variants.jpg ?? variants.exr;
    const ext = variants.png ? "png" : variants.jpg ? "jpg" : "exr";
    const dest = cachePath("polyhaven", "texture", id, `${id}_${name}_${res}.${ext}`);
    await download(entry.url, dest);
    out[name] = dest;
  }
  return out;
}

export async function fetchModel(id, res = "2k") {
  const files = await getJson(`${API}/files/${id}`);
  const blend = files.blend?.[res]?.blend;
  if (!blend) throw new Error(`model ${id} has no ${res} blend`);
  const dir = cachePath("polyhaven", "model", id, res, "x").replace(/x$/, "");
  const blendPath = join(dir, blend.url.split("/").pop());
  await download(blend.url, blendPath);
  for (const [rel, dep] of Object.entries(blend.include ?? {})) {
    await download(dep.url, join(dir, rel));
  }
  return blendPath;
}

export async function search(type, term) {
  const assets = await getJson(`${API}/assets?type=${type}`);
  const t = term.toLowerCase();
  return Object.entries(assets)
    .filter(([id, a]) => id.includes(t) || a.name?.toLowerCase().includes(t) || a.tags?.some((x) => x.includes(t)) || a.categories?.some((x) => x.includes(t)))
    .map(([id, a]) => ({ id, name: a.name, categories: a.categories }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [kind, id, res, extra] = process.argv.slice(2);
  const run = {
    hdri: () => fetchHdri(id, res ?? "2k", extra ?? "hdr"),
    texture: () => fetchTexture(id, res ?? "2k"),
    model: () => fetchModel(id, res ?? "2k"),
    search: () => search(id, res ?? ""),
  }[kind];
  if (!run) {
    console.error("usage: polyhaven.mjs hdri|texture|model|search <id> [res]");
    process.exit(1);
  }
  run()
    .then((r) => {
      log(kind, id);
      console.log(JSON.stringify(r, null, 2));
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
