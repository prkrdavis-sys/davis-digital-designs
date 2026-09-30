"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";

/** Radii sit well outside the helix and far enough apart that the tubes never meet. */
const LANES = [62, 86, 112, 140, 172, 206, 240];

interface Strand {
  tube: THREE.TubeGeometry;
  caps: [THREE.Vector3, THREE.Vector3];
  radius: number;
}

function buildStrands(): Strand[] {
  return LANES.map((radius, i) => {
    const ang = (i / LANES.length) * Math.PI * 2 + 0.4;
    const pts: THREE.Vector3[] = [];
    const steps = 8;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const y = THREE.MathUtils.lerp(80, -500, t);
      const bend = Math.sin(t * Math.PI) * 0.08;
      const a = ang + bend;
      const r = radius + Math.sin(t * Math.PI) * 3;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tubeRadius = 4.2 + (i % 3) * 0.55;
    return {
      tube: new THREE.TubeGeometry(curve, 28, tubeRadius, 10, false),
      caps: [curve.getPoint(0), curve.getPoint(1)],
      radius: tubeRadius,
    };
  });
}

function tubeMaterial(variant: Variant) {
  const night = variant === "night";
  return new THREE.MeshStandardMaterial({
    color: night ? "#0c2438" : "#4e86a8",
    emissive: night ? "#7ec8e8" : "#c5e6f4",
    emissiveIntensity: night ? 1.15 : 0.12,
    roughness: 0.42,
    metalness: 0,
  });
}

/** A few smooth, closed microtubules running with the helix. */
export function Filaments({ variant }: { variant: Variant }) {
  const strands = useMemo(() => buildStrands(), []);
  const material = useMemo(() => tubeMaterial(variant), [variant]);
  const cap = useMemo(() => new THREE.SphereGeometry(1, 12, 10), []);

  return (
    <group>
      {strands.map((strand, i) => (
        <mesh key={i} geometry={strand.tube} material={material} frustumCulled={false} />
      ))}
      {strands.flatMap((strand, i) =>
        strand.caps.map((position, end) => (
          <mesh key={`${i}-${end}`} geometry={cap} material={material} position={position} scale={strand.radius} frustumCulled={false} />
        )),
      )}
    </group>
  );
}
