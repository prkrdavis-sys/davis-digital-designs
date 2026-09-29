#!/usr/bin/env node
/**
 * Geodata fetchers for the Everest world.
 *   node art/fetch/geo.mjs dem <lat> <lon>        Copernicus GLO-30 1x1 degree tile (Cloud Optimized GeoTIFF)
 *   node art/fetch/geo.mjs s2 <minLon> <minLat> <maxLon> <maxLat> <dateRange>
 *                                                 lowest-cloud Sentinel-2 L2A true-color (visual) COG via Earth Search STAC
 *   node art/fetch/geo.mjs osm <minLat> <minLon> <maxLat> <maxLon>
 *                                                 hiking paths from OpenStreetMap (Overpass API) as JSON
 *
 * Attribution (see src/lib/credits.ts):
 *   DEM: Copernicus DEM GLO-30, (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the EU and ESA.
 *   Imagery: Contains modified Copernicus Sentinel data.
 *   Trails: (c) OpenStreetMap contributors, ODbL.
 */
import { writeFileSync } from "node:fs";
import { cachePath, download, getJson, log, USER_AGENT } from "./lib.mjs";

function tileName(lat, lon) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  const la = String(Math.abs(Math.floor(lat))).padStart(2, "0");
  const lo = String(Math.abs(Math.floor(lon))).padStart(3, "0");
  return `Copernicus_DSM_COG_10_${ns}${la}_00_${ew}${lo}_00_DEM`;
}

export async function fetchDem(lat, lon) {
  const name = tileName(lat, lon);
  const dest = cachePath("geo", "dem", `${name}.tif`);
  await download(`https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`, dest);
  return dest;
}

export async function fetchSentinel2(bbox, datetime) {
  const body = {
    collections: ["sentinel-2-l2a"],
    bbox,
    datetime,
    limit: 50,
    query: { "eo:cloud_cover": { lt: 8 } },
    sortby: [{ field: "properties.eo:cloud_cover", direction: "asc" }],
  };
  const res = await fetch("https://earth-search.aws.element84.com/v1/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`STAC search -> ${res.status}`);
  const items = (await res.json()).features ?? [];
  if (!items.length) throw new Error("no Sentinel-2 scenes matched");
  const picked = [];
  for (const item of items.slice(0, 3)) {
    const href = item.assets.visual?.href;
    if (!href) continue;
    const dest = cachePath("geo", "s2", `${item.id}_visual.tif`);
    await download(href, dest);
    picked.push({ id: item.id, date: item.properties.datetime, cloud: item.properties["eo:cloud_cover"], path: dest, bbox: item.bbox });
  }
  writeFileSync(cachePath("geo", "s2", "picked.json"), JSON.stringify(picked, null, 2));
  return picked;
}

export async function fetchOsmTrails(s, w, n, e) {
  const query = `[out:json][timeout:120];(way["highway"~"path|footway|track"](${s},${w},${n},${e});node["place"](${s},${w},${n},${e});node["natural"="peak"](${s},${w},${n},${e}););out body geom;`;
  const data = await getJson(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
  const dest = cachePath("geo", "osm", `trails_${s}_${w}_${n}_${e}.json`);
  writeFileSync(dest, JSON.stringify(data));
  return dest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [kind, ...args] = process.argv.slice(2);
  const run = {
    dem: () => fetchDem(Number(args[0]), Number(args[1])),
    s2: () => fetchSentinel2(args.slice(0, 4).map(Number), args[4] ?? "2024-10-15/2024-12-31"),
    osm: () => fetchOsmTrails(...args.map(Number)),
  }[kind];
  if (!run) {
    console.error("usage: geo.mjs dem|s2|osm ...");
    process.exit(1);
  }
  run()
    .then((r) => {
      log(kind, args.join(" "));
      console.log(JSON.stringify(r, null, 2));
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
