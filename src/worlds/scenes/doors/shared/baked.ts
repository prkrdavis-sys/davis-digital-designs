import * as THREE from "three";
import type { LoadedGLTF } from "@/components/three/engine/assets";

/** Meshes in a GLB by node name (baked groups are single meshes). */
export function meshesByName(gltf: LoadedGLTF): Map<string, THREE.Mesh> {
  const out = new Map<string, THREE.Mesh>();
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) out.set(m.name, m);
  });
  return out;
}

/** The emissive lightmap Blender baked onto a mesh (ddd.bake.bake_group). */
export function lightmapOf(mesh: THREE.Mesh): THREE.Texture | null {
  const m = mesh.material as THREE.MeshStandardMaterial;
  return m.emissiveMap ?? null;
}

/**
 * Baked GI meshes render as pure emission (albedo x light). Keep a faint
 * specular response so the environment still glints off the stone.
 */
export function tuneBaked(mesh: THREE.Mesh, { rough = 0.55, envIntensity = 0.35, fog = true } = {}) {
  const m = mesh.material as THREE.MeshStandardMaterial;
  m.roughness = rough;
  m.metalness = 0;
  m.envMapIntensity = envIntensity;
  m.fog = fog;
  if (m.emissiveMap) m.emissiveMap.anisotropy = 8;
  m.needsUpdate = true;
}
