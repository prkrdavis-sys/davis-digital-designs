"use client";

import { useGLTF, useTexture } from "@react-three/drei";
import type { ObjectMap } from "@react-three/fiber";
import * as THREE from "three";
import { KTX2Loader, type GLTF, type GLTFLoader } from "three-stdlib";
import type { SceneId, Quality } from "@/worlds/types";

let renderer: THREE.WebGLRenderer | null = null;
let ktx2: KTX2Loader | null = null;

/** Called once when the canvas is created so loaders can detect GPU texture support. */
export function setAssetRenderer(gl: THREE.WebGLRenderer) {
  renderer = gl;
}

function extend(loader: GLTFLoader) {
  if (!ktx2 && renderer) ktx2 = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(renderer);
  if (ktx2) loader.setKTX2Loader(ktx2);
}

export type LoadedGLTF = GLTF & ObjectMap;

export function worldUrl(scene: SceneId, path: string): string {
  return `/worlds/${scene}/${path}`;
}

/** GLB from public/worlds/<scene>/<quality>/<file>, meshopt + KTX2 aware. Suspends. */
export function useWorldGLTF(scene: SceneId, file: string, quality: Quality = "hi"): LoadedGLTF {
  return useGLTF(worldUrl(scene, `${quality}/${file}`), false, true, extend);
}

export function preloadWorldGLTF(scene: SceneId, file: string, quality: Quality = "hi") {
  useGLTF.preload(worldUrl(scene, `${quality}/${file}`), false, true, extend);
}

/** Plain images (covers, sprites) as sRGB color textures. Suspends. */
export function useColorTextures(urls: string[]): THREE.Texture[] {
  return useTexture(urls, (loaded) => {
    for (const tex of Array.isArray(loaded) ? loaded : [loaded]) {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
    }
  }) as THREE.Texture[];
}

/**
 * A mesh's geometry with its node transform baked in, as plain float
 * attributes. Needed for meshopt-quantized GLBs: positions are stored
 * normalized in [-1, 1] and the real scale lives on the node.
 */
export function bakedGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  mesh.updateWorldMatrix(true, false);
  const src = mesh.geometry;
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  if (src.index) g.setIndex(src.index.clone());
  g.applyMatrix4(mesh.matrixWorld);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** First mesh in a GLB with its transform baked (single-mesh assets). */
export function firstMeshGeometry(gltf: LoadedGLTF): THREE.BufferGeometry {
  let found: THREE.Mesh | null = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!found && m.isMesh) found = m;
  });
  if (!found) throw new Error("GLB has no mesh");
  return bakedGeometry(found);
}

/** Find a named node in a loaded GLB, failing loudly with the available names. */
export function node<T extends THREE.Object3D = THREE.Mesh>(gltf: LoadedGLTF, name: string): T {
  const found = gltf.scene.getObjectByName(name);
  if (!found) {
    const names: string[] = [];
    gltf.scene.traverse((o) => {
      if (o.name) names.push(o.name);
    });
    throw new Error(`node "${name}" not in GLB. Have: ${names.slice(0, 40).join(", ")}`);
  }
  return found as T;
}
