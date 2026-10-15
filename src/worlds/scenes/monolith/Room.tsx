"use client";

import { useMemo, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { useWorldGLTF } from "@/components/three/engine/assets";
import { lightmapOf, meshesByName, tuneBaked } from "@/worlds/scenes/doors/shared/baked";
import { floorMaterial, syncFog } from "@/worlds/scenes/doors/shared/floor";

const FLOOR: Record<Variant, { a: string; b: string; inlay: string; vein: string; reflect: number }> = {
  day: { a: "#d5dedc", b: "#b7c2bf", inlay: "#9aa8a4", vein: "#8e9c98", reflect: 0.14 },
  night: { a: "#8e99a6", b: "#3c4652", inlay: "#6a7582", vein: "#2c3540", reflect: 0.2 },
};

/** Baked gallery shell, a polished floor, and the mirror image under that floor. */
export function Room({ variant, children }: { variant: Variant; children?: ReactNode }) {
  const gltf = useWorldGLTF("monolith", `room-${variant}.glb`);
  const scene = useThree((s) => s.scene);

  const { statics, floor, material } = useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    const meshes = meshesByName(gltf);
    const shell = meshes.get("shell");
    const statics = new THREE.Group();
    if (shell) {
      const c = shell.clone();
      tuneBaked(c, { rough: variant === "night" ? 0.5 : 0.62, envIntensity: variant === "night" ? 0.35 : 0.28 });
      (c.material as THREE.MeshStandardMaterial).emissiveIntensity = variant === "night" ? 8 : 1;
      c.matrixAutoUpdate = false;
      c.matrix.copy(shell.matrixWorld);
      statics.add(c);
    }
    const fm = meshes.get("floor");
    let floorMesh: THREE.Mesh | null = null;
    let mat: THREE.ShaderMaterial | null = null;
    if (fm) {
      const pal = FLOOR[variant];
      mat = floorMaterial({
        light: lightmapOf(fm),
        a: pal.a,
        b: pal.b,
        inlay: pal.inlay,
        vein: pal.vein,
        tile: 2.4,
        joint: 0.012,
        reflect: pal.reflect,
        reflectMax: 0.9,
        lightScale: variant === "night" ? 7 : 2.1,
      });
      floorMesh = new THREE.Mesh(fm.geometry, mat);
      floorMesh.applyMatrix4(fm.matrixWorld);
      floorMesh.renderOrder = 2;
    }
    return { statics, floor: floorMesh, material: mat };
  }, [gltf, variant]);

  const mirror = useMemo(() => statics.clone(true), [statics]);

  useFrame(() => {
    if (material) syncFog(material, scene.fog);
  });

  return (
    <>
      <primitive object={statics} />
      <group scale={[1, -1, 1]}>
        <primitive object={mirror} />
        {children}
      </group>
      {floor && <primitive object={floor} />}
    </>
  );
}
