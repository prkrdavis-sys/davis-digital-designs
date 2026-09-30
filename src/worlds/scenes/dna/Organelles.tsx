"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { firstMeshGeometry, useWorldGLTF } from "@/components/three/engine/assets";

const UP = new THREE.Vector3(0, 1, 0);

/** Hand-placed, outside the microtubule lanes (which end near r=232) and clear of the helix. */
const VESICLES: { at: [number, number, number]; scale: number }[] = [
  { at: [280, 50, 70], scale: 18 },
  { at: [-260, -30, 120], scale: 15 },
  { at: [90, -140, -290], scale: 20 },
  { at: [-300, -210, -80], scale: 16 },
  { at: [200, -300, 240], scale: 17 },
  { at: [-120, -390, -270], scale: 14 },
];

const MITO: { at: [number, number, number]; scale: number; tilt: [number, number, number] }[] = [
  { at: [340, -90, 40], scale: 110, tilt: [0.06, 1, 0.02] },
  { at: [-310, -240, 160], scale: 96, tilt: [-0.04, 1, 0.08] },
  { at: [70, -360, -340], scale: 120, tilt: [0.02, 1, -0.05] },
];

const ER: { at: [number, number, number]; scale: number; normal: [number, number, number] }[] = [
  { at: [420, -170, 30], scale: 130, normal: [1, 0.15, 0.05] },
  { at: [-380, -320, -140], scale: 150, normal: [-0.8, 0.2, -0.35] },
];

function place(at: [number, number, number], dir: [number, number, number], scale: number, chromo: THREE.Vector3) {
  const position = new THREE.Vector3(...at);
  if (Math.hypot(position.x, position.z) < 250) return null;
  if (position.distanceTo(chromo) < 280) return null;
  const q = new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(...dir).normalize());
  return new THREE.Matrix4().compose(position, q, new THREE.Vector3(scale, scale, scale));
}

function layout(center: [number, number, number]) {
  const chromo = new THREE.Vector3(...center);
  const vesicle = VESICLES.map((v) => place(v.at, [0, 1, 0], v.scale, chromo)).filter((m): m is THREE.Matrix4 => m !== null);
  const mito = MITO.map((v) => place(v.at, v.tilt, v.scale, chromo)).filter((m): m is THREE.Matrix4 => m !== null);
  const er = ER.map((v) => place(v.at, v.normal, v.scale, chromo)).filter((m): m is THREE.Matrix4 => m !== null);
  return { vesicle, mito, er };
}

function organelleMaterial(variant: Variant, color: string, emissive: string) {
  const night = variant === "night";
  return new THREE.MeshStandardMaterial({
    color: night ? "#071422" : color,
    emissive: night ? emissive : color,
    emissiveIntensity: night ? 1.35 : 0.08,
    roughness: 0.38,
    metalness: 0,
    side: THREE.DoubleSide,
  });
}

function FieldMesh({ geometry, matrices, material }: { geometry: THREE.BufferGeometry; matrices: THREE.Matrix4[]; material: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
  }, [matrices]);
  if (matrices.length === 0) return null;
  return <instancedMesh ref={ref} args={[geometry, material, matrices.length]} frustumCulled={false} />;
}

/** A few closed organelles, spaced so they frame the helix instead of crossing it. */
export function Organelles({ variant, center }: { variant: Variant; center: [number, number, number] }) {
  const vesicleGltf = useWorldGLTF("dna", "vesicle.glb");
  const mitoGltf = useWorldGLTF("dna", "mitochondrion.glb");
  const erGltf = useWorldGLTF("dna", "er.glb");
  const vesicleGeo = useMemo(() => firstMeshGeometry(vesicleGltf), [vesicleGltf]);
  const mitoGeo = useMemo(() => firstMeshGeometry(mitoGltf), [mitoGltf]);
  const erGeo = useMemo(() => firstMeshGeometry(erGltf), [erGltf]);
  const fields = useMemo(() => layout(center), [center]);
  const vesicleMat = useMemo(() => organelleMaterial(variant, "#d5eef6", "#8fd4ff"), [variant]);
  const mitoMat = useMemo(() => organelleMaterial(variant, "#d7a08a", "#ff8fb8"), [variant]);
  const erMat = useMemo(() => organelleMaterial(variant, "#9ec4d8", "#7ee0c8"), [variant]);

  return (
    <group>
      <FieldMesh geometry={vesicleGeo} matrices={fields.vesicle} material={vesicleMat} />
      <FieldMesh geometry={mitoGeo} matrices={fields.mito} material={mitoMat} />
      <FieldMesh geometry={erGeo} matrices={fields.er} material={erMat} />
    </group>
  );
}
