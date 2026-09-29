"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { node, useWorldGLTF } from "@/components/three/engine/assets";
import { lightmapUrls, TILE_SIZE, TILE_URLS, type GreenhouseMeta } from "@/worlds/scenes/greenhouse/data";
import { floorMaterial, glassMaterial, skyMaterial, type Atmos } from "@/worlds/scenes/greenhouse/materials";

/** Per-variant look of the static set. */
export const ARCH_LOOK: Record<Variant, { envGain: number; floorEnv: number; caustic: number; causticColor: string; shade: number; glassEnv: number; glint: number; grime: string; grimeAmount: number; skyGain: number; skyHot: number; disc: number; halo: number; bakeGain: number }> = {
  day: { envGain: 1.0, floorEnv: 0.9, caustic: 0.55, causticColor: "#fff1c8", shade: 0.18, glassEnv: 1.1, glint: 40, grime: "#d8d2bd", grimeAmount: 0.11, skyGain: 1.15, skyHot: 3.0, disc: 60, halo: 3.0, bakeGain: 1.0 },
  night: { envGain: 1.0, floorEnv: 1.2, caustic: 0.25, causticColor: "#bcd0ff", shade: 0.05, glassEnv: 1.3, glint: 6, grime: "#6f7ea6", grimeAmount: 0.07, skyGain: 1.0, skyHot: 1.5, disc: 12, halo: 0.6, bakeGain: 1.0 },
};

function useSetTextures(variant: Variant) {
  const urls = lightmapUrls(variant);
  const color = useTexture([urls.iron, urls.masonry, urls.floor, urls.sky, urls.env, TILE_URLS[0]]) as THREE.Texture[];
  const data = useTexture([TILE_URLS[1], TILE_URLS[2]]) as THREE.Texture[];
  return useMemo(() => {
    const [iron, masonry, floor, sky, env, albedo] = color;
    for (const t of color) t.colorSpace = THREE.SRGBColorSpace;
    for (const t of data) t.colorSpace = THREE.NoColorSpace;
    // Baked atlases are sampled with the GLB's own UVs (glTF convention).
    iron.flipY = false;
    masonry.flipY = false;
    for (const t of [iron, masonry]) t.anisotropy = 4;
    for (const t of [sky, env]) {
      t.wrapS = THREE.RepeatWrapping;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
    }
    for (const t of [...color, ...data]) t.needsUpdate = true;
    return { iron, masonry, floor, sky, env, albedo, normal: data[0], rough: data[1] };
  }, [color, data]);
}

export function Architecture({ meta, variant, atmos, lightDir, lightColor }: { meta: GreenhouseMeta; variant: Variant; atmos: Atmos; lightDir: THREE.Vector3; lightColor: THREE.Color }) {
  const gltf = useWorldGLTF("greenhouse", "arch.glb");
  const tex = useSetTextures(variant);
  const look = ARCH_LOOK[variant];
  const scene = useThree((s) => s.scene);

  const mats = useMemo(() => {
    const baked = (map: THREE.Texture, rough: number) =>
      new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#ffffff", emissiveMap: map, emissiveIntensity: 2 * look.bakeGain, roughness: rough, metalness: 0, envMapIntensity: 0.35 });
    return {
      iron: baked(tex.iron, 0.38),
      masonry: baked(tex.masonry, 0.85),
      floor: floorMaterial({
        albedo: tex.albedo,
        normal: tex.normal,
        rough: tex.rough,
        light: tex.floor,
        env: tex.env,
        bounds: meta.floor.bounds,
        tile: TILE_SIZE,
        lmScale: Math.pow(2, -meta.lightmapExposure),
        envGain: look.floorEnv,
        caustic: look.caustic,
        causticColor: look.causticColor,
        shade: look.shade,
        atmos,
      }),
      glass: glassMaterial({ env: tex.env, envGain: look.glassEnv, lightDir, lightColor, glint: look.glint, grime: look.grime, grimeAmount: look.grimeAmount, atmos }),
      sky: skyMaterial({ sky: tex.sky, gain: look.skyGain, hot: look.skyHot, lightDir, lightColor, disc: look.disc, halo: look.halo }),
    };
  }, [tex, look, meta, atmos, lightDir, lightColor]);

  const parts = useMemo(() => {
    const out: Record<"iron" | "masonry" | "floor" | "glass", THREE.Mesh> = {
      iron: node<THREE.Mesh>(gltf, "iron"),
      masonry: node<THREE.Mesh>(gltf, "masonry"),
      floor: node<THREE.Mesh>(gltf, "floor"),
      glass: node<THREE.Mesh>(gltf, "glass"),
    };
    return out;
  }, [gltf]);

  useEffect(() => {
    parts.iron.material = mats.iron;
    parts.masonry.material = mats.masonry;
    parts.floor.material = mats.floor;
    parts.glass.material = mats.glass;
    parts.glass.renderOrder = 20;
    for (const m of Object.values(parts)) m.frustumCulled = false;
  }, [parts, mats]);

  useEffect(() => {
    const env = tex.env.clone();
    env.mapping = THREE.EquirectangularReflectionMapping;
    env.needsUpdate = true;
    scene.environment = env;
    scene.environmentIntensity = 1;
    return () => {
      scene.environment = null;
      env.dispose();
    };
  }, [scene, tex.env]);

  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  useFrame((state) => {
    (mats.floor.uniforms.uTime as { value: number }).value = state.clock.elapsedTime;
  });

  return (
    <>
      <mesh material={mats.sky} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[300, 48, 24]} />
      </mesh>
      <primitive object={gltf.scene} />
    </>
  );
}
