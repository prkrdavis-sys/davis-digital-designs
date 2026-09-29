#!/usr/bin/env node
/**
 * The golden route: Everest Base Camp trek from OpenStreetMap trail geometry,
 * then the South Col climbing route, draped on the DEM.
 *
 *   node art/worlds/everest/route.mjs      (after geo.mjs dem)
 *
 * Writes public/worlds/everest/hi/route.json:
 *   points    detailed route line (local three.js units), for drawing
 *   dist      cumulative distance along `points` (units)
 *   camera    heavily smoothed copy of the route, for the camera to follow
 *   waypoints labelled stops with real elevations
 *   progress  [s, dist] keys: how far the line has drawn at chapter time s
 *
 * Trails (c) OpenStreetMap contributors, ODbL.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE, OUT, PUB, UNIT, EXAG, gridHeight, loadMeta, readGrid, toLocal, toUtm } from "./geolib.mjs";

const OSM_BBOX = [27.66, 86.66, 28.03, 86.99];
const MIRRORS = ["https://overpass.private.coffee/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];

/**
 * Stops in order. `trail: true` legs follow the OSM path graph; the rest are
 * the climbing route, placed at the DEM point nearest the surveyed elevation.
 * `label: false` stops only steer the path.
 */
const STOPS = [
  { name: "Lukla", lat: 27.6868, lon: 86.7315, elev: 2860, kind: "village" },
  { name: "Phakding", lat: 27.7398, lon: 86.7117, elev: 2610, kind: "village", trail: true },
  { name: "Monjo", lat: 27.7717, lon: 86.7222, elev: 2835, kind: "village", trail: true, label: false },
  { name: "Namche Bazaar", lat: 27.8047, lon: 86.7107, elev: 3440, kind: "village", trail: true },
  { name: "Tengboche", lat: 27.8360, lon: 86.7645, elev: 3867, kind: "village", trail: true },
  { name: "Pangboche", lat: 27.8577, lon: 86.7938, elev: 3985, kind: "village", trail: true, label: false },
  { name: "Dingboche", lat: 27.8935, lon: 86.8309, elev: 4410, kind: "village", trail: true },
  { name: "Thukla", lat: 27.9311, lon: 86.8045, elev: 4620, kind: "village", trail: true, label: false },
  { name: "Lobuche", lat: 27.9485, lon: 86.8098, elev: 4940, kind: "village", trail: true },
  { name: "Gorak Shep", lat: 27.9803, lon: 86.8283, elev: 5164, kind: "village", trail: true },
  { name: "Everest Base Camp", lat: 28.0045, lon: 86.8560, elev: 5364, kind: "camp", trail: true, search: 250 },
  { name: "Khumbu Icefall", lat: 28.0003, lon: 86.8665, elev: 5600, kind: "hazard", search: 250 },
  { name: "Camp I", lat: 27.9918, lon: 86.8795, elev: 6065, kind: "camp", search: 400 },
  { name: "Western Cwm", lat: 27.9868, lon: 86.8905, elev: 6250, kind: "hazard", search: 300, label: false },
  { name: "Camp II", lat: 27.9818, lon: 86.9005, elev: 6400, kind: "camp", search: 400 },
  { name: "Camp III", lat: 27.9718, lon: 86.9185, elev: 7160, kind: "camp", search: 300 },
  { name: "Geneva Spur", lat: 27.9728, lon: 86.9275, elev: 7800, kind: "hazard", search: 250, label: false },
  { name: "South Col", lat: 27.9750, lon: 86.9321, elev: 7906, kind: "camp", search: 150 },
  { name: "The Balcony", lat: 27.9800, lon: 86.9306, elev: 8400, kind: "ridge", search: 200 },
  { name: "South Summit", lat: 27.9855, lon: 86.9272, elev: 8749, kind: "ridge", search: 120 },
  { name: "Hillary Step", lat: 27.9871, lon: 86.9259, elev: 8790, kind: "ridge", search: 80 },
  { name: "Summit", lat: 27.98817, lon: 86.92512, elev: 8849, kind: "summit", search: 150 },
];

/** Chapter time at which the line reaches each labelled stop (see src/lib/worlds.ts about chapters). */
const ARRIVE = {
  Lukla: 0.92,
  Phakding: 1.3,
  "Namche Bazaar": 1.82,
  Tengboche: 2.32,
  Dingboche: 2.82,
  Lobuche: 3.08,
  "Gorak Shep": 3.24,
  "Everest Base Camp": 3.38,
  "Khumbu Icefall": 3.5,
  "Camp I": 3.6,
  "Camp II": 3.7,
  "Camp III": 3.8,
  "South Col": 3.95,
  "The Balcony": 4.28,
  "South Summit": 4.55,
  "Hillary Step": 4.7,
  Summit: 4.86,
};

const LINE_OFFSET_M = 14; // line floats this far above the DEM
const SPACING_M = 25;
const S_MAX = 6.2;

/** Fritsch-Carlson monotone cubic through [x, y] keys. */
function monotone(keys, x) {
  if (x <= keys[0][0]) return keys[0][1];
  if (x >= keys[keys.length - 1][0]) return keys[keys.length - 1][1];
  const n = keys.length;
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((keys[i + 1][1] - keys[i][1]) / (keys[i + 1][0] - keys[i][0]));
  const m = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  let i = 0;
  while (keys[i + 1][0] < x) i++;
  const h = keys[i + 1][0] - keys[i][0];
  const t = (x - keys[i][0]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * keys[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * keys[i + 1][1] + (t3 - t2) * h * m[i + 1];
}

async function loadOsm() {
  const path = join(CACHE, "geo", "osm", "khumbu_paths.json");
  if (!existsSync(path)) {
    mkdirSync(join(CACHE, "geo", "osm"), { recursive: true });
    const [s, w, n, e] = OSM_BBOX;
    const q = `[out:json][timeout:180];way["highway"~"path|footway|track|steps"](${s},${w},${n},${e});out geom;`;
    let text = null;
    for (const m of MIRRORS) {
      try {
        const res = await fetch(m, { method: "POST", body: new URLSearchParams({ data: q }), headers: { "User-Agent": "davis-digital-designs-art-pipeline/1.0" } });
        if (!res.ok) throw new Error(String(res.status));
        text = await res.text();
        JSON.parse(text);
        break;
      } catch (err) {
        console.log("[route] overpass", m, "failed:", err.message);
        text = null;
      }
    }
    if (!text) throw new Error("all Overpass mirrors failed");
    writeFileSync(path, text);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

// ---------------------------------------------------------------- graph
function buildGraph(osm) {
  const nodes = new Map(); // id -> { e, n, edges: [[id, w]] }
  for (const way of osm.elements) {
    if (way.type !== "way" || !way.geometry) continue;
    for (let k = 0; k < way.geometry.length; k++) {
      const id = way.nodes[k];
      if (!nodes.has(id)) {
        const [e, n] = toUtm(way.geometry[k].lat, way.geometry[k].lon);
        nodes.set(id, { id, e, n, edges: [] });
      }
    }
    const pen = way.tags?.highway === "track" ? 1.15 : 1;
    for (let k = 1; k < way.nodes.length; k++) {
      const a = nodes.get(way.nodes[k - 1]);
      const b = nodes.get(way.nodes[k]);
      const w = Math.hypot(a.e - b.e, a.n - b.n) * pen;
      a.edges.push([b.id, w]);
      b.edges.push([a.id, w]);
    }
  }
  // Heal small gaps between mapped ways (bridges, unmapped junctions): expensive but rare links.
  const cell = 80;
  const hash = new Map();
  for (const nd of nodes.values()) {
    const key = `${Math.floor(nd.e / cell)},${Math.floor(nd.n / cell)}`;
    if (!hash.has(key)) hash.set(key, []);
    hash.get(key).push(nd);
  }
  let healed = 0;
  for (const nd of nodes.values()) {
    if (nd.edges.length > 1) continue;
    const cx = Math.floor(nd.e / cell);
    const cy = Math.floor(nd.n / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const o of hash.get(`${cx + dx},${cy + dy}`) ?? []) {
        if (o === nd) continue;
        const d = Math.hypot(o.e - nd.e, o.n - nd.n);
        if (d < 70 && !nd.edges.some(([id]) => id === o.id)) {
          nd.edges.push([o.id, d * 4]);
          o.edges.push([nd.id, d * 4]);
          healed++;
        }
      }
    }
  }
  console.log("[route] graph", nodes.size, "nodes; healed", healed, "gaps");
  return nodes;
}

function nearestNode(nodes, e, n) {
  let best = null;
  let bd = Infinity;
  for (const nd of nodes.values()) {
    const d = Math.hypot(nd.e - e, nd.n - n);
    if (d < bd) [best, bd] = [nd, d];
  }
  return { node: best, dist: bd };
}

function dijkstra(nodes, from, to) {
  const dist = new Map([[from.id, 0]]);
  const prev = new Map();
  // Binary heap on [d, id].
  const heap = [[0, from.id]];
  const push = (x) => {
    heap.push(x);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, id] = pop();
    if (id === to.id) break;
    if (d > (dist.get(id) ?? Infinity)) continue;
    for (const [nid, w] of nodes.get(id).edges) {
      const nd = d + w;
      if (nd < (dist.get(nid) ?? Infinity)) {
        dist.set(nid, nd);
        prev.set(nid, id);
        push([nd, nid]);
      }
    }
  }
  if (!dist.has(to.id)) return null;
  const path = [];
  for (let id = to.id; id !== undefined; id = prev.get(id)) path.push(nodes.get(id));
  return { path: path.reverse(), length: dist.get(to.id) };
}

// ---------------------------------------------------------------- geometry
function densify(pts, spacing) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(d / spacing));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** Resample a polyline to uniform spacing along its length. */
function resample(pts, spacing) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const n = Math.max(2, Math.round(total / spacing) + 1);
  const out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = (total * k) / (n - 1);
    while (j < cum.length - 2 && cum[j + 1] < t) j++;
    const u = (t - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * u, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * u]);
  }
  return out;
}

function gaussSmooth(pts, sigmaSamples, keep = []) {
  const r = Math.ceil(sigmaSamples * 3);
  const w = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * sigmaSamples * sigmaSamples)));
  const pinned = new Set(keep);
  return pts.map((p, i) => {
    if (pinned.has(i) || i === 0 || i === pts.length - 1) return p;
    const acc = new Array(p.length).fill(0);
    let ws = 0;
    for (let k = -r; k <= r; k++) {
      const j = Math.min(pts.length - 1, Math.max(0, i + k));
      const ww = w[k + r];
      for (let c = 0; c < p.length; c++) acc[c] += pts[j][c] * ww;
      ws += ww;
    }
    return acc.map((v) => v / ws);
  });
}

/** Climbing stops: the DEM point near the guess whose height best matches the survey. */
function placeOnDem(g, H, stop) {
  const [e, n] = toUtm(stop.lat, stop.lon);
  const R = stop.search ?? 0;
  if (!R) return [e, n];
  let best = [e, n];
  let score = Infinity;
  for (let dy = -R; dy <= R; dy += 15) for (let dx = -R; dx <= R; dx += 15) {
    const d = Math.hypot(dx, dy);
    if (d > R) continue;
    const h = gridHeight(g, H, e + dx, n + dy);
    const s = Math.abs(h - stop.elev) + d * 0.08;
    if (s < score) [best, score] = [[e + dx, n + dy], s];
  }
  return best;
}

export async function stepRoute() {
  const g = loadMeta();
  const H = readGrid(g);
  const osm = await loadOsm();
  const nodes = buildGraph(osm);

  // Plan-view polyline in UTM, with the index where each stop lands.
  const plan = [];
  const stopAt = [];
  let prevNode = null;
  for (let i = 0; i < STOPS.length; i++) {
    const st = STOPS[i];
    const [e, n] = st.trail || i === 0 ? toUtm(st.lat, st.lon) : placeOnDem(g, H, st);
    const next = STOPS[i + 1];
    const snapped = st.trail || next?.trail ? nearestNode(nodes, e, n) : null;
    if (st.trail && prevNode && snapped && snapped.dist < 500) {
      const r = dijkstra(nodes, prevNode, snapped.node);
      const straight = Math.hypot(snapped.node.e - prevNode.e, snapped.node.n - prevNode.n);
      if (r && r.length < straight * 3.2) {
        for (const nd of r.path.slice(1)) plan.push([nd.e, nd.n]);
        console.log(`[route] trail ${STOPS[i - 1].name} -> ${st.name}: ${(r.length / 1000).toFixed(1)} km (${r.path.length} nodes)`);
      } else {
        console.log(`[route] no trail ${STOPS[i - 1].name} -> ${st.name}, straight line`);
        plan.push([snapped.node.e, snapped.node.n]);
      }
    } else if (!plan.length) {
      plan.push(snapped && snapped.dist < 500 ? [snapped.node.e, snapped.node.n] : [e, n]);
    } else {
      plan.push([e, n]);
    }
    stopAt.push(plan.length - 1);
    prevNode = snapped && snapped.dist < 500 ? snapped.node : null;
  }

  // Uniform spacing, light smoothing of OSM zig-zag noise, drape.
  const dense = densify(plan, SPACING_M);
  // Track where stops are in the dense line.
  const denseStop = [];
  {
    let k = 0;
    for (const idx of stopAt) {
      const [se, sn] = plan[idx];
      let best = k;
      let bd = Infinity;
      for (let j = k; j < dense.length; j++) {
        const d = Math.hypot(dense[j][0] - se, dense[j][1] - sn);
        if (d < bd) [best, bd] = [j, d];
        if (d < 1) break;
      }
      denseStop.push(best);
      k = best;
    }
  }
  const smooth = gaussSmooth(dense, 1.2, denseStop);
  const drape = (e, n) => gridHeight(g, H, e, n) + LINE_OFFSET_M;
  const points = smooth.map(([e, n]) => toLocal(g, e, n, drape(e, n)));
  const dist = [0];
  for (let i = 1; i < points.length; i++) dist.push(dist[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]));

  // Camera spline: resample coarse, smooth hard (sigma ~1.2 km), heights from a smoothed ridge-aware drape.
  const coarse = resample(smooth, 100);
  const camPlan = gaussSmooth(coarse, 12);
  const camH = gaussSmooth(camPlan.map(([e, n]) => [gridHeight(g, H, e, n)]), 10).map(([h]) => h);
  const camera = camPlan.map(([e, n], i) => toLocal(g, e, n, camH[i]));

  const waypoints = STOPS.map((st, i) => {
    const j = denseStop[i];
    const [e, n] = smooth[j];
    return {
      name: st.name,
      kind: st.kind,
      label: st.label !== false,
      elev: st.elev,
      dem: Math.round(gridHeight(g, H, e, n)),
      index: j,
      dist: +dist[j].toFixed(3),
      pos: toLocal(g, e, n, gridHeight(g, H, e, n)).map((v) => +v.toFixed(3)),
    };
  });
  for (const w of waypoints) console.log(`[route] ${w.name.padEnd(18)} ${String(w.elev).padStart(5)} m (dem ${w.dem})  at ${(w.dist * UNIT / 1000).toFixed(1)} km`);

  const progress = [[0, 0]];
  for (const w of waypoints) if (ARRIVE[w.name] !== undefined) progress.push([ARRIVE[w.name], w.dist]);
  progress.push([5.0, dist[dist.length - 1]]);
  progress.push([S_MAX, dist[dist.length - 1]]);
  // Dense draw table (every 0.01 s), monotone cubic so the head never stalls or jerks at a stop.
  const draw = [];
  for (let k = 0; k <= Math.round(S_MAX * 100); k++) draw.push(+monotone(progress, k / 100).toFixed(3));

  // Route distance for each camera-spline sample (nearest detailed point, kept monotone).
  const cameraDist = [];
  {
    let j = 0;
    for (const c of camera) {
      let best = j;
      let bd = Infinity;
      for (let k = j; k < Math.min(points.length, j + 400); k++) {
        const d = Math.hypot(points[k][0] - c[0], points[k][2] - c[2]);
        if (d < bd) [best, bd] = [k, d];
      }
      j = best;
      cameraDist.push(+dist[best].toFixed(3));
    }
  }

  const round = (a) => a.map((p) => p.map((v) => +v.toFixed(3)));
  const out = {
    unit: UNIT,
    exag: EXAG,
    offset: LINE_OFFSET_M,
    length: +dist[dist.length - 1].toFixed(3),
    points: round(points),
    dist: dist.map((d) => +d.toFixed(3)),
    camera: round(camera),
    cameraDist,
    waypoints,
    progress,
    drawStep: 0.01,
    draw,
  };
  writeFileSync(join(PUB, "hi", "route.json"), JSON.stringify(out));
  writeFileSync(join(OUT, "route.json"), JSON.stringify(out));
  console.log("[route]", points.length, "points,", ((out.length * UNIT) / 1000).toFixed(1), "km total");
}

if (import.meta.url === `file://${process.argv[1]}`) await stepRoute();
