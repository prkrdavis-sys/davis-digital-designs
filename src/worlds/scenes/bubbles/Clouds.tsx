"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { useColorTextures } from "@/components/three/engine/assets";
import type { BubblesLayout } from "@/worlds/scenes/bubbles/layout";

const CARDS = 4;

/**
 * Cycles-rendered puffy clouds as cards, turning to face the camera around
 * the vertical axis. Far ones melt into the sky through the scene fog.
 */
export function Clouds({ variant, layout }: { variant: Variant; layout: BubblesLayout }) {
  const urls = useMemo(() => Array.from({ length: CARDS }, (_, k) => `/worlds/bubbles/hi/cloud-${variant}-${k}.webp`), [variant]);
  const textures = useColorTextures(urls);
  const group = useRef<THREE.Group>(null);

  const { meshes, materials, geometry } = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const materials = textures.map((map) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: true, opacity: variant === "night" ? 0.95 : 1 }));
    const meshes = layout.clouds.map((c) => {
      const m = new THREE.Mesh(geometry, materials[c.k % CARDS]);
      m.position.set(...c.pos);
      m.scale.set(c.size[0] * c.scale, c.size[1] * c.scale, 1);
      m.renderOrder = -5;
      return m;
    });
    return { meshes, materials, geometry };
  }, [textures, layout, variant]);

  useEffect(
    () => () => {
      geometry.dispose();
      materials.forEach((m) => m.dispose());
    },
    [geometry, materials],
  );

  useFrame((state, dt) => {
    const cam = state.camera.position;
    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      m.rotation.y = Math.atan2(cam.x - m.position.x, cam.z - m.position.z);
      m.position.x += Math.sin(state.clock.elapsedTime * 0.05 + i) * Math.min(dt, 0.05) * 0.15;
    }
  });

  return (
    <group ref={group}>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}
