"use client";

import { useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { useWorldGLTF } from "@/components/three/engine/assets";
import { doorPalette, type DoorsLayout } from "@/worlds/scenes/doors/layout";
import type { DoorFx } from "@/worlds/scenes/doors/Doors";
import { lightmapOf, meshesByName, tuneBaked } from "@/worlds/scenes/doors/shared/baked";
import { floorMaterial, syncFog } from "@/worlds/scenes/doors/shared/floor";

const FLOOR: Record<Variant, { a: string; b: string; inlay: string; vein: string }> = {
  day: { a: "#f7f3f6", b: "#e2d6ea", inlay: "#d9b16a", vein: "#b7a3c9" },
  night: { a: "#dcdbec", b: "#c2bfdc", inlay: "#d7b775", vein: "#8c86b8" },
};

/** The baked colonnade: shell + props as emissive GI, the floor as polished marble. */
export function useCorridor(variant: Variant) {
  const gltf = useWorldGLTF("doors", `corridor-${variant}.glb`);
  return useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    const meshes = meshesByName(gltf);
    const shell = meshes.get("shell");
    const props = meshes.get("props");
    const floorMesh = meshes.get("floor");
    for (const m of [shell, props]) if (m) tuneBaked(m, { rough: 0.45, envIntensity: variant === "night" ? 0.25 : 0.4 });
    let floor: THREE.Mesh | null = null;
    let material: THREE.ShaderMaterial | null = null;
    if (floorMesh) {
      const pal = FLOOR[variant];
      material = floorMaterial({ light: lightmapOf(floorMesh), ...pal, tile: 1.5, joint: 0.02, reflect: variant === "night" ? 0.16 : 0.1, reflectMax: 0.9 });
      floor = new THREE.Mesh(floorMesh.geometry, material);
      floor.name = "floor";
      floor.applyMatrix4(floorMesh.matrixWorld);
      floor.renderOrder = 2;
    }
    // Clones keep the cached GLB intact for the next mount.
    const statics = new THREE.Group();
    for (const m of [shell, props]) {
      if (!m) continue;
      const c = m.clone();
      c.matrixAutoUpdate = false;
      c.matrix.copy(m.matrixWorld);
      statics.add(c);
    }
    return { statics, floor, material };
  }, [gltf, variant]);
}

export function Corridor({ variant, layout, fx }: { variant: Variant; layout: DoorsLayout; fx: DoorFx }) {
  const { statics, floor, material } = useCorridor(variant);
  const mirror = useMemo(() => statics.clone(true), [statics]);
  const scene = useThree((s) => s.scene);
  const spill = useMemo(
    () =>
      layout.doors.map((d) => {
        const into = new THREE.Vector2(d.into[0], d.into[2]).normalize();
        return { pos: new THREE.Vector3(...d.spill), dir: into.multiplyScalar(-1), col: new THREE.Color(doorPalette(d.id, variant)[0]) };
      }),
    [layout, variant],
  );

  useFrame((_, dt) => {
    if (!material) return;
    syncFog(material, scene.fog);
    const u = material.uniforms;
    u.uTime.value += Math.min(dt, 0.05);
    spill.forEach((s, i) => {
      u.uSpillPos.value[i].copy(s.pos);
      u.uSpillDir.value[i].copy(s.dir);
      u.uSpillCol.value[i].copy(s.col);
      u.uSpillAmt.value[i] = fx.glow[i] * (variant === "night" ? 1.1 : 0.55);
    });
  });

  return (
    <>
      <primitive object={statics} />
      <group scale={[1, -1, 1]}>
        <primitive object={mirror} />
      </group>
      {floor && <primitive object={floor} />}
      <FarGlow variant={variant} />
    </>
  );
}

const glowVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const glowFragment = /* glsl */ `
  varying vec2 vUv;
  uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform float uGain;
  void main() {
    float t = vUv.y;
    vec3 col = t < 0.5 ? mix(uA, uB, t * 2.0) : mix(uB, uC, (t - 0.5) * 2.0);
    float side = 1.0 - pow(abs(vUv.x - 0.5) * 2.0, 3.0) * 0.35;
    gl_FragColor = vec4(col * uGain * side, 1.0);
  }
`;

const FAR: Record<Variant, { colors: [string, string, string]; gain: number }> = {
  day: { colors: ["#fff6ee", "#ffe2ee", "#e8e6ff"], gain: 2.3 },
  night: { colors: ["#3a3f8a", "#6a5fc0", "#a99be8"], gain: 1.5 },
};

/** Soft light beyond the arches at both ends of the colonnade. */
function FarGlow({ variant }: { variant: Variant }) {
  const material = useMemo(() => {
    const f = FAR[variant];
    return new THREE.ShaderMaterial({
      vertexShader: glowVertex,
      fragmentShader: glowFragment,
      uniforms: { uA: { value: new THREE.Color(f.colors[0]) }, uB: { value: new THREE.Color(f.colors[1]) }, uC: { value: new THREE.Color(f.colors[2]) }, uGain: { value: f.gain } },
      fog: false,
    });
  }, [variant]);
  return (
    <>
      <mesh material={material} position={[0, 4, -53]}>
        <planeGeometry args={[24, 18]} />
      </mesh>
      <mesh material={material} position={[0, 4, 21]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[24, 18]} />
      </mesh>
    </>
  );
}
