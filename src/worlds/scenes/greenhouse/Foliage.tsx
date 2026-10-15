"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { useWorldGLTF } from "@/components/three/engine/assets";
import { makeLeafUniforms, patchLeaf, withSunShadow } from "@/worlds/scenes/greenhouse/materials";
import type { sunVisUniforms } from "@/worlds/scenes/greenhouse/sunvis";

const TRANSLUCENCY: Record<Variant, { color: string; base: number }> = {
  day: { color: "#e8d27a", base: 0.05 },
  night: { color: "#1a2233", base: 0.02 },
};

/**
 * Everything live-lit: Poly Haven plant scans (GPU-instanced by the optimizer),
 * procedural palms, ivy and pothos, and the brass lanterns. Leaves sway (scans)
 * or flutter (procedural vines), sit in the baked sun-visibility shadows, and
 * glow when the sun is behind them.
 */
export function Foliage({ variant, lightDir, vis }: { variant: Variant; lightDir: THREE.Vector3; vis: ReturnType<typeof sunVisUniforms> }) {
  const gltf = useWorldGLTF("greenhouse", "live.glb");
  const uniforms = useMemo(() => makeLeafUniforms(), []);

  const mats = useMemo(() => {
    const made: THREE.Material[] = [];
    const cache = new Map<THREE.Material, THREE.Material>();
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.MeshStandardMaterial;
      let m = cache.get(src);
      if (!m) {
        const name = src.name ?? "";
        if (name.includes("Lantern")) {
          const l = src.clone();
          l.envMapIntensity = 1.2;
          if (name.includes("glass")) {
            l.transparent = true;
            l.opacity = 0.35;
            l.roughness = 0.05;
            l.depthWrite = false;
          }
          m = withSunShadow(l, vis, name);
        } else if (name.startsWith("trunk")) {
          m = withSunShadow(new THREE.MeshStandardMaterial({ color: src.color, roughness: 0.9, envMapIntensity: 0.8 }), vis, "trunk");
        } else {
          const leaf = new THREE.MeshStandardMaterial({
            map: src.map ?? null,
            vertexColors: !src.map,
            alphaTest: src.map ? Math.max(0.4, src.alphaTest || 0.5) : 0,
            side: THREE.DoubleSide,
            roughness: 0.62,
            metalness: 0,
            envMapIntensity: 0.9,
          });
          patchLeaf(leaf, uniforms, src.map ? "sway" : "flutter", vis);
          m = leaf;
        }
        cache.set(src, m);
        made.push(m);
      }
      mesh.material = m;
      mesh.frustumCulled = false;
    });
    return made;
  }, [gltf, uniforms, vis]);

  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);

  useEffect(() => {
    uniforms.uTrans.value.set(TRANSLUCENCY[variant].color);
    uniforms.uTransBase.value = TRANSLUCENCY[variant].base;
  }, [uniforms, variant]);

  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    tmp.copy(lightDir).transformDirection(state.camera.matrixWorldInverse);
    uniforms.uLightView.value.copy(tmp);
  });

  return <primitive object={gltf.scene} />;
}
