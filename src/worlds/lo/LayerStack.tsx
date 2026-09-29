"use client";

import { use, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { pointer } from "@/lib/store";
import { useLook, useSceneTime } from "@/components/three/engine/slot";
import type { SceneId, Variant } from "@/worlds/types";
import { indexAt, loadLayerSets, type LayerManifest } from "@/worlds/lo/manifests";

const setsCache = new Map<string, Promise<LayerManifest[]>>();
function useLayerSets(scene: SceneId, variant: Variant): LayerManifest[] {
  const key = `${scene}:${variant}`;
  let p = setsCache.get(key);
  if (!p) {
    p = loadLayerSets(scene, variant);
    setsCache.set(key, p);
  }
  return use(p);
}

interface Props {
  scene: SceneId;
  variant: Variant;
  /** Pointer parallax, as a fraction of the nearest layer's depth. */
  parallax?: number;
  /** Forward travel per chapter, as a fraction of the nearest layer's depth. */
  dolly?: number;
  /** Part of each chapter spent crossfading into the next layer set. */
  fade?: number;
  /** Where the subject sits across the rendered frame (0..1); portrait screens pan to keep it in view. */
  focus?: number;
  /** Cheap live extras (particles, glints) rendered in front of the layers. */
  children?: ReactNode;
}

interface Built {
  group: THREE.Group;
  materials: THREE.MeshBasicMaterial[];
  nearest: number;
  set: LayerManifest;
}

/**
 * The Low Resources renderer: Cycles depth layers on planes at their real
 * distances, so moving the camera a little produces genuine parallax. Each
 * chapter's set sits one dolly-length further down -Z, so scrolling flies
 * forward through them while they crossfade.
 */
export function LayerStack({ scene, variant, parallax = 0.035, dolly = 0.14, fade = 0.45, focus = 0.64, children }: Props) {
  useLook({ tone: "none", exposure: 1, grain: 0.04, vignette: 0.28 });
  const sets = useLayerSets(scene, variant);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const time = useSceneTime();
  const root = useRef<THREE.Group>(null);

  const built = useMemo<Built[]>(() => {
    const loader = new THREE.TextureLoader();
    let z = 0;
    return sets.map((set) => {
      const group = new THREE.Group();
      const nearest = Math.min(...set.layers.map((l) => l.depth));
      group.position.z = -z;
      z += nearest * dolly;
      const tan = Math.tan(THREE.MathUtils.degToRad(set.fov) / 2);
      const materials = set.layers.map((layer, i) => {
        const tex = loader.load(`/worlds/${scene}/layers/${layer.file}`);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, opacity: 0 });
        const h = 2 * layer.depth * tan;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(h * set.aspect, h), mat);
        mesh.position.z = -layer.depth;
        mesh.renderOrder = i;
        mesh.userData.depth = layer.depth;
        group.add(mesh);
        return mat;
      });
      return { group, materials, nearest, set };
    });
  }, [sets, scene, dolly]);

  useEffect(() => {
    const r = root.current;
    if (!r) return;
    built.forEach((b, i) => {
      b.group.children.forEach((m) => ((m as THREE.Mesh).renderOrder = i * 10 + (m as THREE.Mesh).renderOrder));
      r.add(b.group);
    });
    return () => {
      built.forEach((b) => {
        r.remove(b.group);
        b.group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.geometry.dispose();
            const mat = m.material as THREE.MeshBasicMaterial;
            mat.map?.dispose();
            mat.dispose();
          }
        });
      });
    };
  }, [built]);

  useFrame(() => {
    if (!built.length) return;
    const s = time.s;
    const k = indexAt(built.map((b) => b.set), s);
    const cur = built[k];
    const next = built[k + 1];
    const span = next ? next.set.s - cur.set.s : 1;
    const u = THREE.MathUtils.clamp((s - cur.set.s) / span, 0, next ? 1 : 1.4);
    const a = next ? THREE.MathUtils.smoothstep(u, 1 - fade, 1) : 0;

    // The current set's back layer stays opaque so the crossfade never dips toward black.
    built.forEach((b, i) => {
      const o = i === k ? 1 - a : i === k + 1 ? a : 0;
      b.materials.forEach((m, j) => (m.opacity = i === k && j === 0 ? 1 : o));
      b.group.visible = i === k || o > 0.001;
    });

    // Camera flies from this set's origin toward the next one, plus pointer parallax.
    const near = cur.nearest;
    const z = cur.group.position.z - u * near * dolly;
    camera.position.set(pointer.sx * near * parallax, pointer.sy * near * parallax * 0.6, z);
    camera.quaternion.identity();
    const fov = cur.set.fov / 1.08;
    const viewAspect = size.width / Math.max(1, size.height);
    const imgAspect = cur.set.aspect;
    if (viewAspect >= imgAspect) {
      // Wider than the render: shrink the FOV so the frame always fills.
      const coverFov = THREE.MathUtils.radToDeg(2 * Math.atan((Math.tan(THREE.MathUtils.degToRad(fov) / 2) * imgAspect) / viewAspect));
      if (camera.view?.enabled) camera.clearViewOffset();
      camera.aspect = viewAspect;
      camera.fov = coverFov;
    } else {
      // Narrower (portrait): show a window of the full frame, panned toward the subject.
      const full = 1000;
      const w = full * viewAspect;
      const fw = full * imgAspect;
      const x = THREE.MathUtils.clamp(focus * fw - w / 2, 0, fw - w);
      camera.aspect = imgAspect;
      camera.fov = fov;
      camera.setViewOffset(fw, full, x, 0, w, full);
    }
    camera.updateProjectionMatrix();
  });

  return (
    <>
      <group ref={root} />
      {children}
    </>
  );
}
