"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";

const AXIS_CLEAR = 16;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pushOut(p: THREE.Vector3) {
  const r = Math.hypot(p.x, p.z);
  if (r < AXIS_CLEAR && r > 1e-4) {
    p.x *= AXIS_CLEAR / r;
    p.z *= AXIS_CLEAR / r;
  }
}

/** Thin, wandering actin. */
function actinStrand(rng: () => number): { points: THREE.Vector3[]; width: number } {
  const r = 18 + rng() * 70;
  const a = rng() * Math.PI * 2;
  const p = new THREE.Vector3(Math.cos(a) * r, 60 - rng() * 520, Math.sin(a) * r);
  pushOut(p);
  const points = [p.clone()];
  const steps = 14 + Math.floor(rng() * 12);
  const dir = new THREE.Vector3(rng() - 0.5, -0.75 - rng() * 0.4, rng() - 0.5).normalize();
  for (let i = 0; i < steps; i++) {
    dir.add(new THREE.Vector3((rng() - 0.5) * 0.55, (rng() - 0.5) * 0.2, (rng() - 0.5) * 0.55)).normalize();
    p.addScaledVector(dir, 7 + rng() * 9);
    pushOut(p);
    points.push(p.clone());
  }
  return { points, width: 2.4 + rng() * 1.6 };
}

/** Straighter, thicker microtubules, mostly along the helix axis. */
function microtubule(rng: () => number): { points: THREE.Vector3[]; width: number } {
  const r = 28 + rng() * 160;
  const a = rng() * Math.PI * 2;
  const y0 = 40 - rng() * 180;
  const y1 = y0 - (140 + rng() * 280);
  const bend = (rng() - 0.5) * 0.55;
  const steps = 12;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = a + bend * Math.sin(t * Math.PI);
    const rr = r * (1 + 0.08 * Math.sin(t * Math.PI));
    const p = new THREE.Vector3(Math.cos(ang) * rr, THREE.MathUtils.lerp(y0, y1, t), Math.sin(ang) * rr);
    pushOut(p);
    points.push(p);
  }
  return { points, width: 7 + rng() * 4 };
}

function tubeGeometry(strands: { points: THREE.Vector3[]; width: number }[], sides: number) {
  let vertCount = 0;
  let indexCount = 0;
  for (const s of strands) {
    vertCount += s.points.length * sides;
    indexCount += (s.points.length - 1) * sides * 6;
  }
  const pos = new Float32Array(vertCount * 3);
  const nrm = new Float32Array(vertCount * 3);
  const idx = new Uint32Array(indexCount);
  const tangent = new THREE.Vector3();
  const prevT = new THREE.Vector3();
  const side = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const axis = new THREE.Vector3();
  let v = 0;
  let t = 0;
  for (const s of strands) {
    const n = s.points.length;
    const base = v;
    const radius = s.width * 0.5;
    normal.set(0, 0, 1);
    for (let i = 0; i < n; i++) {
      const p = s.points[i];
      const a = s.points[Math.max(0, i - 1)];
      const b = s.points[Math.min(n - 1, i + 1)];
      tangent.subVectors(b, a);
      if (tangent.lengthSq() < 1e-8) tangent.set(0, -1, 0);
      tangent.normalize();
      if (i === 0) {
        const ref = Math.abs(tangent.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        normal.crossVectors(tangent, ref).normalize();
      } else {
        axis.crossVectors(prevT, tangent);
        if (axis.lengthSq() > 1e-8) {
          const ang = Math.acos(THREE.MathUtils.clamp(prevT.dot(tangent), -1, 1));
          normal.applyAxisAngle(axis.normalize(), ang);
        }
      }
      prevT.copy(tangent);
      binormal.crossVectors(tangent, normal).normalize();
      for (let j = 0; j < sides; j++) {
        const ang = (j / sides) * Math.PI * 2;
        const cx = Math.cos(ang);
        const cy = Math.sin(ang);
        side.copy(normal).multiplyScalar(cx).addScaledVector(binormal, cy);
        pos.set([p.x + side.x * radius, p.y + side.y * radius, p.z + side.z * radius], v * 3);
        nrm.set([side.x, side.y, side.z], v * 3);
        v += 1;
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < sides; j++) {
        const a0 = base + i * sides + j;
        const a1 = base + i * sides + ((j + 1) % sides);
        const b0 = a0 + sides;
        const b1 = a1 + sides;
        idx.set([a0, b0, a1, a1, b0, b1], t);
        t += 6;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

function strandMaterial(variant: Variant, color: string, emissive: string) {
  return new THREE.MeshStandardMaterial({
    color: variant === "night" ? "#041018" : color,
    emissive: variant === "night" ? emissive : color,
    emissiveIntensity: variant === "night" ? 2.2 : 0.18,
    roughness: 0.32,
    metalness: 0,
    transparent: true,
    opacity: variant === "night" ? 0.92 : 0.88,
    depthWrite: false,
  });
}

/** Actin and microtubules in a shell around the helix, so the orbit has lines to fly past. */
export function Filaments({ variant }: { variant: Variant }) {
  const { actin, tubes } = useMemo(() => {
    const rng = mulberry32(0x0a11);
    const actinStrands = Array.from({ length: 64 }, () => actinStrand(rng));
    const tubeStrands = Array.from({ length: 18 }, () => microtubule(rng));
    return { actin: tubeGeometry(actinStrands, 5), tubes: tubeGeometry(tubeStrands, 6) };
  }, []);
  const actinMat = useMemo(() => strandMaterial(variant, "#c56d86", "#ff6fae"), [variant]);
  const tubeMat = useMemo(() => strandMaterial(variant, "#6f9aaf", "#7f97ff"), [variant]);

  return (
    <group>
      <mesh geometry={actin} material={actinMat} frustumCulled={false} />
      <mesh geometry={tubes} material={tubeMat} frustumCulled={false} />
    </group>
  );
}
