"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

const textures = new Map<string, Promise<THREE.Texture | null>>();

/**
 * Loads an equirect panorama if it exists (HEAD first, so a world that has not
 * been built yet just returns null instead of logging a failed image load).
 */
export function loadPano(url: string): Promise<THREE.Texture | null> {
  let p = textures.get(url);
  if (!p) {
    p = fetch(url, { method: "HEAD" })
      .then((r) => {
        if (!r.ok) return null;
        return new Promise<THREE.Texture | null>((resolve) => {
          new THREE.TextureLoader().load(
            url,
            (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.mapping = THREE.EquirectangularReflectionMapping;
              tex.wrapS = THREE.RepeatWrapping;
              tex.anisotropy = 8;
              resolve(tex);
            },
            undefined,
            () => resolve(null),
          );
        });
      })
      .catch(() => null);
    textures.set(url, p);
  }
  return p;
}

/**
 * Image-based lighting for the scene from its own Cycles panorama, so metals
 * and glass reflect the real room. Falls back to no environment.
 */
export function PanoEnvironment({ url, intensity = 1, rotationY = 0 }: { url: string; intensity?: number; rotationY?: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    let cancelled = false;
    let target: THREE.WebGLRenderTarget | null = null;
    void loadPano(url).then((tex) => {
      if (cancelled || !tex) return;
      const pmrem = new THREE.PMREMGenerator(gl);
      target = pmrem.fromEquirectangular(tex);
      pmrem.dispose();
      scene.environment = target.texture;
      scene.environmentIntensity = intensity;
      scene.environmentRotation.set(0, rotationY, 0);
    });
    return () => {
      cancelled = true;
      if (target) {
        if (scene.environment === target.texture) scene.environment = null;
        target.dispose();
      }
    };
  }, [gl, scene, url, intensity, rotationY]);
  return null;
}
