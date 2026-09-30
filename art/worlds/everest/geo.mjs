#!/usr/bin/env node
/**
 * Everest geodata: real terrain, imagery and route for the Khumbu.
 *
 *   node art/worlds/everest/geo.mjs dem     Copernicus GLO-30 -> metric grid (UTM 45N), heightmap, normals
 *   node art/worlds/everest/geo.mjs s2      Sentinel-2 true color mosaic -> de-lit albedo on the same grid
 *   node art/worlds/everest/geo.mjs route   OSM trail graph + South Col waypoints -> draped route.json
 *   node art/worlds/everest/geo.mjs all
 *
 * Coordinates: the grid is axis-aligned in UTM zone 45N (meters). Local
 * three.js space is 1 unit = 100 m, x east, y up (x EXAG), z south, origin at
 * the grid centre and sea level. Blender uses x east, y north, z up.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fromFile, fromUrl } from "geotiff";
import sharp from "sharp";
import { CACHE, EXAG, OUT, PUB, BBOX, castShadow, fromUtm, gridHeight, gridNormals, gridSpec, rad, readGrid, toLocal, toUtm } from "./geolib.mjs";

// ---------------------------------------------------------------- DEM
/** Surveyed summits: lat, lon, meters. */
const SUMMITS = {
  Everest: [27.98817, 86.92512, 8849],
  Lhotse: [27.96175, 86.93306, 8516],
  Nuptse: [27.9672, 86.8864, 7861],
  "Ama Dablam": [27.8617, 86.8614, 6812],
  Pumori: [28.0149, 86.8281, 7161],
};

async function loadDemTiles() {
  const tiles = new Map();
  for (const la of [27, 28]) {
    for (const lo of [86, 87]) {
      const name = `Copernicus_DSM_COG_10_N${la}_00_E0${lo}_00_DEM`;
      const path = join(CACHE, "geo", "dem", `${name}.tif`);
      if (!existsSync(path)) throw new Error(`missing ${path}; run: node art/fetch/geo.mjs dem ${la + 0.5} ${lo + 0.5}`);
      const tif = await fromFile(path);
      const im = await tif.getImage();
      const [data] = await im.readRasters();
      tiles.set(`${la},${lo}`, { data, w: im.getWidth(), h: im.getHeight(), lat0: la, lon0: lo });
    }
  }
  return tiles;
}

function sampleDem(tiles, lat, lon) {
  const t = tiles.get(`${Math.floor(lat)},${Math.floor(lon)}`);
  const fx = Math.min(t.w - 1.001, Math.max(0, (lon - t.lon0) * t.w - 0.5));
  const fy = Math.min(t.h - 1.001, Math.max(0, (t.lat0 + 1 - lat) * t.h - 0.5));
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  const u = fx - x;
  const v = fy - y;
  const d = t.data;
  const i = y * t.w + x;
  return (d[i] * (1 - u) + d[i + 1] * u) * (1 - v) + (d[i + t.w] * (1 - u) + d[i + t.w + 1] * u) * v;
}





async function writeGray16(path, w, h, values, scale) {
  const buf = Buffer.alloc(w * h * 2);
  for (let i = 0; i < w * h; i++) buf.writeUInt16LE(Math.max(0, Math.min(65535, Math.round(values[i] * scale))), i * 2);
  await sharp(buf, { raw: { width: w, height: h, channels: 1, depth: "ushort" } }).toColourspace("grey16").png({ compressionLevel: 9 }).toFile(path);
}

async function stepDem() {
  const g = gridSpec();
  console.log("[geo] grid", g.nx, "x", g.ny, `${(g.width / 1000).toFixed(1)} x ${(g.height / 1000).toFixed(1)} km`, "tex", g.tex.join("x"));
  const tiles = await loadDemTiles();
  const H = new Float32Array(g.nx * g.ny);
  let hMin = 1e9;
  let hMax = -1e9;
  for (let y = 0; y < g.ny; y++) {
    const n = g.n1 - y * g.dx;
    for (let x = 0; x < g.nx; x++) {
      const [lat, lon] = fromUtm(g.e0 + x * g.dx, n);
      const h = sampleDem(tiles, lat, lon);
      H[y * g.nx + x] = h;
      if (h < hMin) hMin = h;
      if (h > hMax) hMax = h;
    }
  }
  // A 30 m DSM rounds off sharp summits by 60-150 m. Restore the surveyed heights with a narrow bump.
  for (const [lat, lon, ref] of Object.values(SUMMITS)) {
    const [e, n] = toUtm(lat, lon);
    let best = -1;
    let be = e;
    let bn = n;
    for (let dy = -150; dy <= 150; dy += 15) for (let dx = -150; dx <= 150; dx += 15) {
      const h = gridHeight(g, H, e + dx, n + dy);
      if (h > best) [best, be, bn] = [h, e + dx, n + dy];
    }
    const add = ref - best;
    if (!(add > 0 && add < 220)) continue;
    const sigma = 110;
    const cx = (be - g.e0) / g.dx;
    const cy = (g.n1 - bn) / g.dx;
    const r = Math.ceil((sigma * 3) / g.dx);
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(g.ny - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(g.nx - 1, Math.ceil(cx + r)); x++) {
        const d2 = ((x - cx) ** 2 + (y - cy) ** 2) * g.dx * g.dx;
        H[y * g.nx + x] += add * Math.exp(-d2 / (2 * sigma * sigma));
      }
    }
  }
  hMax = Math.max(...Object.values(SUMMITS).map((p) => p[2]), hMax);
  writeFileSync(join(OUT, "dem.f32"), Buffer.from(H.buffer));
  await writeGray16(join(OUT, "heightmap16.png"), g.nx, g.ny, H, 65535 / 9000);

  // Object-space normal map (three.js axes), full DEM resolution -> texture size.
  const N = gridNormals(g, H);
  const nb = Buffer.alloc(g.nx * g.ny * 3);
  for (let i = 0; i < N.length; i++) nb[i] = Math.round((N[i] * 0.5 + 0.5) * 255);
  const [tw, th] = [Math.round(g.tex[0] / 2 / 4) * 4, g.tex[1] / 2];
  await sharp(nb, { raw: { width: g.nx, height: g.ny, channels: 3 } }).resize(tw, th, { kernel: "cubic" }).png().toFile(join(OUT, "normal.png"));

  // Runtime heightfield for cursor ray-marching and cloud masks: meters, 1/4 resolution.
  const step = 4;
  const rw = Math.floor((g.nx - 1) / step) + 1;
  const rh = Math.floor((g.ny - 1) / step) + 1;
  const rt = new Uint16Array(rw * rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) rt[y * rw + x] = Math.round(H[y * step * g.nx + x * step]);
  writeFileSync(join(PUB, "hi", "height.bin"), Buffer.from(rt.buffer));

  // Where the famous summits land (sanity check on georeferencing).
  const peaks = { ...SUMMITS, Makalu: [27.8897, 87.0888, 8485], Lukla: [27.6875, 86.7317, 2860] };
  const peakOut = {};
  for (const [name, [lat, lon, ref]] of Object.entries(peaks)) {
    const [e, n] = toUtm(lat, lon);
    const inside = e >= g.e0 && e <= g.e1 && n >= g.n0 && n <= g.n1;
    // The DEM smooths sharp summits; report the local max within 150 m.
    let best = inside ? gridHeight(g, H, e, n) : NaN;
    let bestE = e;
    let bestN = n;
    if (inside) {
      for (let dy = -150; dy <= 150; dy += 15) for (let dx = -150; dx <= 150; dx += 15) {
        const h = gridHeight(g, H, e + dx, n + dy);
        if (h > best) [best, bestE, bestN] = [h, e + dx, n + dy];
      }
    }
    console.log(`[geo] ${name.padEnd(11)} ref ${ref} m  dem ${inside ? best.toFixed(0) : "outside"} m`);
    if (inside) peakOut[name] = { lat, lon, ref, dem: Math.round(best), local: toLocal(g, bestE, bestN, best).map((v) => +v.toFixed(3)) };
  }

  const meta = { ...g, hMin, hMax, heightBin: { w: rw, h: rh, step }, peaks: peakOut, bbox: BBOX, crs: "EPSG:32645" };
  writeFileSync(join(OUT, "terrain.json"), JSON.stringify(meta, null, 1));
  // Keep the bake/light blocks written by build.py, so re-running this step never orphans the KTX2 textures.
  const pubMeta = join(PUB, "hi", "terrain.json");
  const prev = existsSync(pubMeta) ? JSON.parse(readFileSync(pubMeta, "utf8")) : {};
  writeFileSync(pubMeta, JSON.stringify({ ...meta, ...(prev.bake ? { bake: prev.bake } : {}), ...(prev.light ? { light: prev.light } : {}) }));
  console.log("[geo] heights", hMin.toFixed(0), "..", hMax.toFixed(0), "m");
}

// ---------------------------------------------------------------- Sentinel-2
const S2_ITEMS = ["S2A_45RVM_20241107_0_L2A", "S2A_45RVL_20241107_0_L2A"];
const S2_SUN = { az: 161.2, el: 43.1 };

/**
 * Mosaic one L2A band over the grid at `res` meters. The two MGRS tiles share
 * the UTM 45N pixel grid, so they paste together without resampling.
 */
async function s2Band(g, band, res) {
  const w = Math.round(g.width / res);
  const h = Math.round(g.height / res);
  const out = new Uint16Array(w * h);
  for (const id of S2_ITEMS) {
    const [, tile] = id.split("_");
    const url = `https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/${tile.slice(0, 2)}/${tile[2]}/${tile.slice(3)}/2024/11/${id}/${band}.tif`;
    console.log("[geo] s2", id, band);
    const tif = await fromUrl(url);
    const im = await tif.getImage();
    const [ox, oy] = im.getOrigin();
    const W = im.getWidth();
    const Hh = im.getHeight();
    const c0 = Math.max(0, Math.floor((g.e0 - ox) / res));
    const r0 = Math.max(0, Math.floor((oy - g.n1) / res));
    const c1 = Math.min(W, c0 + w + 1);
    const r1 = Math.min(Hh, r0 + h + 1);
    if (c1 <= c0 || r1 <= r0) continue;
    let data;
    for (let attempt = 0; !data; attempt++) {
      try {
        [data] = await im.readRasters({ window: [c0, r0, c1, r1] });
      } catch (e) {
        if (attempt >= 4) throw e;
        console.log("[geo] retry", band, e.message);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    const ww = c1 - c0;
    const dc = Math.round((ox + c0 * res - g.e0) / res);
    const dr = Math.round((g.n1 - (oy - r0 * res)) / res);
    for (let r = 0; r < r1 - r0; r++) {
      for (let c = 0; c < ww; c++) {
        const X = c + dc;
        const Y = r + dr;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const d = Y * w + X;
        const v = data[r * ww + c];
        if (out[d] || !v) continue;
        out[d] = v;
      }
    }
  }
  return { w, h, data: out };
}

/** Cached mosaics: rgb (B04, B03, B02 surface reflectance DN, raw uint16) and SCL classes (png). */
async function s2Mosaic(g) {
  const dir = join(CACHE, "geo", "s2");
  mkdirSync(dir, { recursive: true });
  const rgbPath = join(dir, "khumbu_rgb_10m.u16");
  const sclPath = join(dir, "khumbu_scl_20m.png");
  const w = Math.round(g.width / 10);
  const h = Math.round(g.height / 10);
  if (!existsSync(rgbPath)) {
    const bands = [];
    for (const b of ["B04", "B03", "B02"]) bands.push(await s2Band(g, b, 10));
    const out = new Uint16Array(w * h * 3);
    for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = bands[c].data[i];
    writeFileSync(rgbPath, Buffer.from(out.buffer));
  }
  if (!existsSync(sclPath)) {
    const scl = await s2Band(g, "SCL", 20);
    await sharp(Buffer.from(Uint8Array.from(scl.data)), { raw: { width: scl.w, height: scl.h, channels: 1 } }).png().toFile(sclPath);
  }
  const buf = readFileSync(rgbPath);
  return { rgb: new Uint16Array(buf.buffer, buf.byteOffset, w * h * 3), w, h, sclPath };
}

/** Box-filtered resample of an interleaved uint16 image. */
function boxResample(src, sw, sh, ch, dw, dh) {
  const out = new Float32Array(dw * dh * ch);
  const kx = sw / dw;
  const ky = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * ky);
    const y1 = Math.max(y0 + 1, Math.min(sh, Math.floor((y + 1) * ky)));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * kx);
      const x1 = Math.max(x0 + 1, Math.min(sw, Math.floor((x + 1) * kx)));
      for (let c = 0; c < ch; c++) {
        let acc = 0;
        let n = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
          const v = src[(yy * sw + xx) * ch + c];
          if (v) {
            acc += v;
            n++;
          }
        }
        out[(y * dw + x) * ch + c] = n ? acc / n : 0;
      }
    }
  }
  return out;
}

function upsample(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1.001, ((y + 0.5) / dh) * (sh - 1));
    const yi = fy | 0;
    const v = fy - yi;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1.001, ((x + 0.5) / dw) * (sw - 1));
      const xi = fx | 0;
      const u = fx - xi;
      const i = yi * sw + xi;
      out[y * dw + x] = (src[i] * (1 - u) + src[i + 1] * u) * (1 - v) + (src[i + sw] * (1 - u) + src[i + sw + 1] * u) * v;
    }
  }
  return out;
}

const linToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

async function stepS2() {
  const g = JSON.parse(readFileSync(join(OUT, "terrain.json"), "utf8"));
  const H = readGrid(g);
  const { rgb, w: mw, h: mh, sclPath } = await s2Mosaic(g);
  const [tw, th] = g.tex;
  const img = boxResample(rgb, mw, mh, 3, tw, th);
  const { data: scl } = await sharp(sclPath).extractChannel(0).resize(tw, th, { kernel: "nearest" }).raw().toBuffer({ resolveWithObject: true });

  // Predicted illumination at acquisition time: sun (Lambert x cast shadow) + sky.
  const N = gridNormals(g, H);
  const sh = castShadow(g, H, S2_SUN.az, S2_SUN.el);
  const sun = [Math.sin(rad(S2_SUN.az)) * Math.cos(rad(S2_SUN.el)), Math.sin(rad(S2_SUN.el)), -Math.cos(rad(S2_SUN.az)) * Math.cos(rad(S2_SUN.el))];
  const flat = 0.82 * Math.sin(rad(S2_SUN.el)) + 0.18;
  const shade = new Float32Array(g.nx * g.ny);
  const up = new Float32Array(g.nx * g.ny);
  for (let i = 0; i < shade.length; i++) {
    const l = Math.max(0, N[i * 3] * sun[0] + N[i * 3 + 1] * sun[1] + N[i * 3 + 2] * sun[2]);
    shade[i] = (0.82 * l * sh[i] + 0.18 * (0.55 + 0.45 * N[i * 3 + 1])) / flat;
    up[i] = N[i * 3 + 1];
  }
  const shadeT = upsample(shade, g.nx, g.ny, tw, th);
  const upT = upsample(up, g.nx, g.ny, tw, th);

  const out = Buffer.alloc(tw * th * 3);
  const mask = Buffer.alloc(tw * th * 3);
  const refl = (dn) => dn / 10000;
  for (let i = 0; i < tw * th; i++) {
    const nodata = img[i * 3] === 0;
    const s = Math.max(0.2, shadeT[i]);
    let R = refl(img[i * 3]) / s;
    let G = refl(img[i * 3 + 1]) / s;
    let B = refl(img[i * 3 + 2]) / s;
    // Sky-lit shadow is blue: pull the de-lit color toward neutral where the sun did not reach.
    const k = Math.min(1, Math.max(0, (0.65 - shadeT[i]) / 0.45));
    const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    R += (lum * 1.01 - R) * k * 0.75;
    G += (lum * 1.0 - G) * k * 0.75;
    B += (lum * 0.99 - B) * k * 0.75;
    out[i * 3] = Math.round(linToSrgb(Math.min(0.92, R)) * 255);
    out[i * 3 + 1] = Math.round(linToSrgb(Math.min(0.92, G)) * 255);
    out[i * 3 + 2] = Math.round(linToSrgb(Math.min(0.92, B)) * 255);
    // Masks for the procedural blend: R snow/ice class, G water, B confidence of the de-lit color.
    const c = scl[i];
    const conf = nodata ? 0 : Math.min(1, Math.max(0, (shadeT[i] - 0.22) / 0.45)) * Math.min(1, Math.max(0, (upT[i] - 0.4) / 0.3));
    mask[i * 3] = c === 11 ? 255 : 0;
    mask[i * 3 + 1] = c === 6 ? 255 : 0;
    mask[i * 3 + 2] = Math.round(conf * 255);
  }
  await sharp(out, { raw: { width: tw, height: th, channels: 3 } }).png().toFile(join(OUT, "albedo.png"));
  await sharp(mask, { raw: { width: tw, height: th, channels: 3 } }).blur(1.2).png().toFile(join(OUT, "masks.png"));
  await sharp(out, { raw: { width: tw, height: th, channels: 3 } }).resize(1024).jpeg().toFile(join(OUT, "albedo_preview.jpg"));
  await sharp(mask, { raw: { width: tw, height: th, channels: 3 } }).resize(1024).jpeg().toFile(join(OUT, "masks_preview.jpg"));
  console.log("[geo] albedo", tw, "x", th);
}

const steps = { dem: stepDem, s2: stepS2 };
const cmd = process.argv[2] ?? "all";
if (cmd === "all") {
  await stepDem();
  await stepS2();
} else if (steps[cmd]) {
  await steps[cmd]();
} else {
  console.error("usage: geo.mjs dem|s2|all");
  process.exit(1);
}
