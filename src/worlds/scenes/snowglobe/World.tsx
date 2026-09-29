"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { bakedGeometry, useColorTextures, useWorldGLTF } from "@/components/three/engine/assets";
import { LIGHTMAP_GROUPS, lightmapUrl, type SnowMeta } from "@/worlds/scenes/snowglobe/data";

/** Baked diffuse irradiance replaces image-based diffuse; environment reflections stay live. */
function patchLightmapped(m: THREE.MeshStandardMaterial) {
  if (m.userData.sgPatched) return;
  m.userData.sgPatched = true;
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_maps>", "#include <lights_fragment_maps>\n\tiblIrradiance = vec3( 0.0 );");
  };
  m.customProgramCacheKey = () => "sg-lightmapped";
  m.needsUpdate = true;
}

function forEachMesh(root: THREE.Object3D, fn: (m: THREE.Mesh) => void) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) fn(m);
  });
}

function materialsOf(m: THREE.Mesh): THREE.MeshStandardMaterial[] {
  return (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
}

/** Which lightmap group a mesh belongs to: its own name or its multi-primitive parent's. */
function groupOf(m: THREE.Mesh): string | null {
  for (const n of [m.name, m.parent?.name ?? ""]) {
    const base = n.replace(/_\d+$/, "");
    if ((LIGHTMAP_GROUPS as readonly string[]).includes(base)) return base;
  }
  return null;
}

export interface WorldHandles {
  /** World-space centre, normal and width of the big billboard screen (parked cover placement). */
  billboard: { center: THREE.Vector3; normal: THREE.Vector3; width: number } | null;
}

/**
 * The static desk, props and village: glTF materials with Cycles lightmaps
 * (one per group and variant), emissive strengths from the glow table,
 * project covers on the village screens, and skaters circling the pond.
 */
export function World({ meta, variant, hideBillboard, onReady }: { meta: SnowMeta; variant: Variant; hideBillboard: boolean; onReady?: (h: WorldHandles) => void }) {
  const desk = useWorldGLTF("snowglobe", "desk.glb");
  const village = useWorldGLTF("snowglobe", "village.glb");
  const lightmaps = useTexture(
    LIGHTMAP_GROUPS.map((g) => lightmapUrl(g, variant)),
    (loaded) => {
      for (const t of Array.isArray(loaded) ? loaded : [loaded]) {
        t.flipY = false;
        t.channel = 1;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        t.needsUpdate = true;
      }
    },
  ) as THREE.Texture[];

  const coverUrls = useMemo(() => [...new Set(Object.values(meta.covers))], [meta]);
  const covers = useColorTextures(coverUrls);
  const night = variant === "night";

  useLayoutEffect(() => {
    const byGroup = Object.fromEntries(LIGHTMAP_GROUPS.map((g, i) => [g, lightmaps[i]]));
    for (const root of [desk.scene, village.scene]) {
      forEachMesh(root, (mesh) => {
        const group = groupOf(mesh);
        for (const m of materialsOf(mesh)) {
          if (group && mesh.geometry.attributes.uv1) {
            m.lightMap = byGroup[group];
            m.lightMapIntensity = Math.PI * (meta.lightmaps?.[group]?.[variant] ?? 1);
            m.envMapIntensity = group === "props" ? 0.9 : 0.55;
            patchLightmapped(m);
          }
          const glow = meta.glow[m.name];
          if (glow) {
            m.emissive.set(glow.color);
            m.emissiveIntensity = night ? glow.night : glow.day;
            m.toneMapped = true;
          }
          if (m.name === "film") {
            m.alphaTest = 0.5;
            m.transparent = false;
            m.side = THREE.DoubleSide;
          }
          if (m.name === "ice") {
            m.envMapIntensity = 1.4;
          }
        }
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      });
    }
  }, [desk, village, lightmaps, meta, variant, night]);

  // Covers on the screens: a slight HDR boost so they read as lit displays.
  const screenMats = useMemo(() => {
    const out = new Map<string, THREE.MeshBasicMaterial>();
    for (const [name, url] of Object.entries(meta.covers)) {
      const tex = covers[coverUrls.indexOf(url)];
      out.set(name, new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 1, 1).multiplyScalar(night ? 1.5 : 1.1) }));
    }
    return out;
  }, [meta, covers, coverUrls, night]);

  const billboardMesh = useRef<THREE.Mesh | null>(null);
  useLayoutEffect(() => {
    forEachMesh(village.scene, (mesh) => {
      const mat = screenMats.get(mesh.name);
      if (mat) mesh.material = mat;
      if (mesh.name === "screen_billboard") billboardMesh.current = mesh;
    });
  }, [village, screenMats]);

  useLayoutEffect(() => {
    if (billboardMesh.current) billboardMesh.current.visible = !hideBillboard;
  }, [hideBillboard]);

  useLayoutEffect(() => {
    const mesh = billboardMesh.current;
    if (!mesh || !onReady) return;
    village.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()));
    const nrm = mesh.geometry.attributes.normal;
    if (nrm) normal.set(nrm.getX(0), nrm.getY(0), nrm.getZ(0)).transformDirection(mesh.matrixWorld);
    onReady({ billboard: { center, normal, width: Math.hypot(size.x, size.z) } });
  }, [village, onReady]);

  return (
    <>
      <primitive object={desk.scene} />
      <primitive object={village.scene} />
      <Skaters meta={meta} village={village.scene} />
    </>
  );
}

/** Skaters are exported at the origin; re-host their geometry so we can move them freely. */
function Skaters({ meta, village }: { meta: SnowMeta; village: THREE.Object3D }) {
  const skaters = useMemo(() => {
    village.updateMatrixWorld(true);
    const out: THREE.Group[] = [];
    for (let k = 0; k < meta.skaters.length; k++) {
      const src = village.getObjectByName(`skater_${k}`);
      if (!src) continue;
      const g = new THREE.Group();
      forEachMesh(src, (m) => {
        const mesh = new THREE.Mesh(bakedGeometry(m), m.material);
        g.add(mesh);
      });
      src.visible = false;
      out.push(g);
    }
    return out;
  }, [meta, village]);
  const time = useRef(0);

  useFrame((_, dt) => {
    time.current += Math.min(dt, 0.05);
    const [cx, cy, cz] = meta.pond.center;
    skaters.forEach((g, k) => {
      const s = meta.skaters[k];
      const a = s.phase + s.w * time.current;
      // Blender (x, y) -> three (x, -z); the pond centre is already in three coordinates.
      const bx = Math.cos(a) * meta.pond.rx * s.r * 0.8;
      const by = Math.sin(a) * meta.pond.ry * s.r * 0.8;
      g.position.set(cx + bx, cy + Math.abs(Math.sin(time.current * 3 + k)) * 0.0008, cz - by);
      g.rotation.set(0, a + (s.w > 0 ? Math.PI / 2 : -Math.PI / 2), Math.sin(time.current * 2.4 + k) * 0.12);
    });
  });

  return (
    <>
      {skaters.map((g, k) => (
        <primitive key={k} object={g} />
      ))}
    </>
  );
}
