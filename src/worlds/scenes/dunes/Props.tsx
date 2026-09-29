"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { useWorldGLTF } from "@/components/three/engine/assets";
import { withAtmosphere, type AtmosphereUniforms } from "@/worlds/scenes/dunes/atmosphere";

/** Sun-bleached quiver trunks and half-buried boulders (Poly Haven, CC0). */
export function Props({ atmosphere, envMap, night }: { atmosphere: AtmosphereUniforms; envMap: THREE.Texture; night: boolean }) {
  const gltf = useWorldGLTF("dunes", "props.glb");
  const scene = useMemo(() => {
    const seen = new Map<THREE.Material, THREE.Material>();
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.MeshStandardMaterial;
      let m = seen.get(src);
      if (!m) {
        const c = src.clone();
        c.envMap = envMap;
        c.envMapIntensity = night ? 0.6 : 1;
        // Bleach the wood and warm the stone toward the sand's palette.
        if (mesh.userData.kind === "trunk") c.color = new THREE.Color("#f2e6d6");
        else c.color = new THREE.Color("#e8c9a8");
        m = withAtmosphere(c, atmosphere, `prop-${mesh.userData.kind ?? "x"}`);
        seen.set(src, m);
      }
      mesh.material = m;
    });
    return gltf.scene;
  }, [gltf, atmosphere, envMap, night]);
  return <primitive object={scene} />;
}
