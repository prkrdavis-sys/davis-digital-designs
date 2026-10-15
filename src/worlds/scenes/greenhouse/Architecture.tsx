"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { useWorldGLTF } from "@/components/three/engine/assets";
import { lightmapExposure, lightmapUrls, TILE_SIZE, TILE_URLS, type GreenhouseMeta } from "@/worlds/scenes/greenhouse/data";
import { floorMaterial, glassMaterial, skyMaterial, withSunShadow } from "@/worlds/scenes/greenhouse/materials";
import type { sunVisUniforms } from "@/worlds/scenes/greenhouse/sunvis";

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

/** Which runtime material each exported primitive gets, keyed by its Blender material name. */
type Part = "paint" | "gilt" | "masonry" | "wire" | "glass" | "floor";
const PARTS: Record<string, Part> = { lm_paint: "paint", lm_gilt: "gilt", lm_masonry: "masonry", rt_wire: "wire", rt_glass: "glass", rt_floor: "floor" };

export function Architecture({ meta, variant, vis, lightDir, lightColor }: { meta: GreenhouseMeta; variant: Variant; vis: ReturnType<typeof sunVisUniforms>; lightDir: THREE.Vector3; lightColor: THREE.Color }) {
  const gltf = useWorldGLTF("greenhouse", "arch.glb");
  const tex = useSetTextures(variant);
  const look = ARCH_LOOK[variant];
  const scene = useThree((s) => s.scene);

  const mats = useMemo(() => {
    const lm = lightmapExposure(meta, variant);
    const gain = (e: number) => Math.pow(2, -e) * look.bakeGain;
    // Baked diffuse GI arrives as emission on a black base; the live sun and environment add only the sheen.
    const baked = (key: string, map: THREE.Texture, exposure: number, rough: number, env: number) =>
      withSunShadow(new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#ffffff", emissiveMap: map, emissiveIntensity: gain(exposure), roughness: rough, metalness: 0, envMapIntensity: env }), vis, key);
    const gilt = withSunShadow(new THREE.MeshStandardMaterial({ color: "#e2b86c", metalness: 1, roughness: 0.32, emissive: "#ffffff", emissiveMap: tex.iron, emissiveIntensity: gain(lm.iron) * 0.35, envMapIntensity: 1.4 * look.envGain }), vis, "gilt");
    return {
      paint: baked("paint", tex.iron, lm.iron, 0.4, 0.35 * look.envGain),
      gilt,
      masonry: baked("masonry", tex.masonry, lm.masonry, 0.85, 0.15 * look.envGain),
      wire: withSunShadow(new THREE.MeshStandardMaterial({ color: "#1b1a17", roughness: 0.45, metalness: 0.6, envMapIntensity: look.envGain }), vis, "wire"),
      floor: floorMaterial({
        albedo: tex.albedo,
        normal: tex.normal,
        rough: tex.rough,
        light: tex.floor,
        env: tex.env,
        bounds: meta.floor.bounds,
        tile: TILE_SIZE,
        lmScale: gain(lm.floor),
        envGain: look.floorEnv,
        caustic: look.caustic,
        causticColor: look.causticColor,
        shade: look.shade,
      }),
      glass: glassMaterial({ env: tex.env, envGain: look.glassEnv, lightDir, lightColor, glint: look.glint, grime: look.grime, grimeAmount: look.grimeAmount }),
      sky: skyMaterial({ sky: tex.sky, gain: look.skyGain, hot: look.skyHot, lightDir, lightColor, disc: look.disc, halo: look.halo }),
    };
  }, [tex, look, meta, variant, vis, lightDir, lightColor]);

  const meshes = useMemo(() => {
    const out: { mesh: THREE.Mesh; part: Part }[] = [];
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = (mesh.material as THREE.Material).name;
      const part = PARTS[name];
      if (!part) throw new Error(`greenhouse arch.glb: unexpected material "${name}"`);
      out.push({ mesh, part });
    });
    return out;
  }, [gltf]);

  useEffect(() => {
    for (const { mesh, part } of meshes) {
      mesh.material = mats[part];
      mesh.frustumCulled = false;
      if (part === "glass") mesh.renderOrder = 20;
    }
  }, [meshes, mats]);

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
