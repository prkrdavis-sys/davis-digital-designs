/**
 * Publishes a tabletop island and a pull-back camera rail so the homepage
 * finale can load before the Cycles bake (art/worlds/diorama/build.sh) lands.
 * Outputs: public/worlds/diorama/hi/terrain-{day,night}.glb and rails.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import * as THREE from "three";

const PUB = path.resolve("public/worlds/diorama");

const PLOTS = [
  [2.58, 0.55, 3.88],
  [3.88, 0.55, 1.12],
  [3.52, 0.55, -1.78],
  [1.22, 0.55, -3.58],
  [-1.78, 0.55, -3.38],
  [-3.58, 0.55, -1.42],
  [-3.48, 0.55, 1.58],
  [-1.12, 0.55, 3.68],
  [0.38, 0.85, -6.48],
  [-6.18, 0.62, 3.78],
  [6.38, 0.62, 2.32],
];

function normals(positions, indices) {
  const n = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ax = positions[b] - positions[a];
    const ay = positions[b + 1] - positions[a + 1];
    const az = positions[b + 2] - positions[a + 2];
    const bx = positions[c] - positions[a];
    const by = positions[c + 1] - positions[a + 1];
    const bz = positions[c + 2] - positions[a + 2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
    n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
    n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

function islandMesh() {
  const n = 72;
  const ext = 7.6;
  const pos = [];
  const idx = [];
  const height = (x, z) => {
    const r = Math.hypot(x, z);
    const edge = Math.max(0, 1 - r / ext);
    const hill = edge ** 1.35 * 0.72;
    const pond = Math.exp(-((x - 0.05) ** 2) / (2 * 2.1 ** 2) - ((z + 0.12) ** 2) / (2 * 1.65 ** 2));
    return 0.2 + hill - pond * 0.16;
  };
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = -ext + (2 * ext * i) / n;
      const z = -ext + (2 * ext * j) / n;
      pos.push(x, height(x, z), z);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      idx.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

function cylinder(radius, y0, y1, segs = 48) {
  const pos = [];
  const idx = [];
  pos.push(0, y1, 0, 0, y0, 0);
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    pos.push(x, y1, z, x, y0, z);
  }
  for (let i = 0; i < segs; i++) {
    const t0 = 2 + i * 2;
    const t1 = 2 + ((i + 1) % segs) * 2;
    const b0 = t0 + 1;
    const b1 = t1 + 1;
    idx.push(0, t1, t0, 1, b0, b1, t0, t1, b1, t0, b1, b0);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

function cone(radius, y0, height, segs = 10) {
  const pos = [0, y0 + height, 0];
  const idx = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    pos.push(Math.cos(a) * radius, y0, Math.sin(a) * radius);
  }
  for (let i = 0; i < segs; i++) idx.push(0, 1 + ((i + 1) % segs), 1 + i);
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

function translate(mesh, x, y, z) {
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    p[i] += x;
    p[i + 1] += y;
    p[i + 2] += z;
  }
  return mesh;
}

function addMesh(doc, buffer, scene, name, mesh, color, opts = {}) {
  const pos = doc.createAccessor().setArray(mesh.positions).setType("VEC3").setBuffer(buffer);
  const nrm = doc.createAccessor().setArray(normals(mesh.positions, mesh.indices)).setType("VEC3").setBuffer(buffer);
  const ix = doc.createAccessor().setArray(mesh.indices).setType("SCALAR").setBuffer(buffer);
  const mat = doc
    .createMaterial(name)
    .setBaseColorFactor(color)
    .setRoughnessFactor(opts.rough ?? 0.72)
    .setMetallicFactor(opts.metal ?? 0)
    .setDoubleSided(true);
  if (opts.emissive) mat.setEmissiveFactor(opts.emissive);
  const prim = doc.createPrimitive().setAttribute("POSITION", pos).setAttribute("NORMAL", nrm).setIndices(ix).setMaterial(mat);
  scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
}

function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

async function writeVariant(variant) {
  const night = variant === "night";
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene("diorama");
  addMesh(doc, buffer, scene, "table", cylinder(8.7, 0, 0.2, 64), hex(night ? "#3a2418" : "#6b3f24"), { rough: 0.55 });
  addMesh(doc, buffer, scene, "island", islandMesh(), hex(night ? "#1d3a28" : "#7eae58"), { rough: 0.86 });
  PLOTS.forEach((p, i) => {
    addMesh(doc, buffer, scene, `pad_${i}`, translate(cylinder(0.34, 0, 0.08, 16), p[0], p[1] - 0.08, p[2]), hex(night ? "#2a2440" : "#f3ead8"), { rough: 0.4 });
    if (i % 2 === 0) {
      addMesh(
        doc,
        buffer,
        scene,
        `tree_${i}`,
        translate(cone(0.16, 0, 0.42, 8), p[0] + 0.55, p[1], p[2] - 0.2),
        hex(night ? "#14301c" : "#2f6b3a"),
        { rough: 0.8 },
      );
    }
    if (night) {
      addMesh(
        doc,
        buffer,
        scene,
        `lamp_${i}`,
        translate(cylinder(0.035, 0, 0.05, 8), p[0], p[1] + 0.02, p[2]),
        hex("#ffd392"),
        { rough: 0.4, emissive: [1, 0.72, 0.35] },
      );
    }
  });
  const io = new NodeIO();
  const out = path.join(PUB, "hi", `terrain-${variant}.glb`);
  await io.write(out, doc);
  console.log("wrote", out);
}

function writeRail() {
  const sMax = 2.2;
  const step = 0.02;
  const count = Math.round(sMax / step) + 1;
  const p = [];
  const q = [];
  const fov = [];
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const mat = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const s = i * step;
    const e = s / sMax;
    const t = e * e * (3 - 2 * e);
    pos.set(THREE.MathUtils.lerp(4.4, 0.35, t), THREE.MathUtils.lerp(1.45, 6.2, t), THREE.MathUtils.lerp(7.6, 12.2, t));
    look.set(THREE.MathUtils.lerp(2.58, 0.1, t), THREE.MathUtils.lerp(0.7, 0.4, t), THREE.MathUtils.lerp(3.88, -0.05, t));
    mat.lookAt(pos, look, new THREE.Vector3(0, 1, 0));
    quat.setFromRotationMatrix(mat);
    p.push(+pos.x.toFixed(5), +pos.y.toFixed(5), +pos.z.toFixed(5));
    q.push(+quat.x.toFixed(5), +quat.y.toFixed(5), +quat.z.toFixed(5), +quat.w.toFixed(5));
    fov.push(+(THREE.MathUtils.lerp(32, 44, t)).toFixed(3));
  }
  return { step, sMax, count, p, q, fov };
}

await mkdir(path.join(PUB, "hi"), { recursive: true });
await writeVariant("day");
await writeVariant("night");
const rail = writeRail();
await writeFile(path.join(PUB, "rails.json"), JSON.stringify(rail));
console.log("rail samples", rail.count);
