"use client";

import { useMemo, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { useWorldGLTF } from "@/components/three/engine/assets";
import { lightmapOf, meshesByName, tuneBaked } from "@/worlds/scenes/doors/shared/baked";
import { floorMaterial, syncFog } from "@/worlds/scenes/doors/shared/floor";

const FLOOR: Record<Variant, { a: string; b: string; inlay: string; vein: string; reflect: number }> = {
  day: { a: "#f4f0ea", b: "#39373d", inlay: "#cda65c", vein: "#b9ada3", reflect: 0.12 },
  night: { a: "#e2dfe6", b: "#2a2830", inlay: "#c49c55", vein: "#8f8a99", reflect: 0.18 },
};

/** Baked marble hall (walls, coffered ceiling, furniture) plus the polished floor and its mirror image. */
export function Hall({ variant, children }: { variant: Variant; children?: ReactNode }) {
  const gltf = useWorldGLTF("museum", `hall-${variant}.glb`);
  const scene = useThree((s) => s.scene);

  const { statics, floor, material } = useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    const meshes = meshesByName(gltf);
    const statics = new THREE.Group();
    for (const name of ["walls", "ceiling", "furniture"]) {
      const m = meshes.get(name);
      if (!m) continue;
      const c = m.clone();
      tuneBaked(c, { rough: name === "walls" ? 0.35 : 0.55, envIntensity: variant === "night" ? 0.2 : 0.35 });
      c.matrixAutoUpdate = false;
      c.matrix.copy(m.matrixWorld);
      statics.add(c);
    }
    const fm = meshes.get("floor");
    let floor: THREE.Mesh | null = null;
    let material: THREE.ShaderMaterial | null = null;
    if (fm) {
      const pal = FLOOR[variant];
      material = floorMaterial({ light: lightmapOf(fm), a: pal.a, b: pal.b, inlay: pal.inlay, vein: pal.vein, tile: 2.0, joint: 0.018, mode: 1, reflect: pal.reflect, reflectMax: 0.92 });
      floor = new THREE.Mesh(fm.geometry, material);
      floor.applyMatrix4(fm.matrixWorld);
      floor.renderOrder = 2;
    }
    return { statics, floor, material };
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
