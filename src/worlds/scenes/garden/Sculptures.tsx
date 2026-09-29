"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { pointer } from "@/lib/store";
import { useSceneTime } from "@/components/three/engine/slot";
import { bakedGeometry, useWorldGLTF } from "@/components/three/engine/assets";
import { GARDEN } from "@/worlds/scenes/garden/palette";
import { chromeMaterial, glassMaterial, makeWobble, vinylMaterial, withWobble, type Wobble } from "@/worlds/scenes/garden/materials";
import { ripples } from "@/worlds/scenes/garden/Pool";

type Kind = "vinyl" | "chrome" | "glass";

interface Piece {
  name: string;
  kind: Kind;
  rest: boolean;
  pivot: THREE.Vector3;
  mesh: THREE.Mesh;
  wobble: Wobble | null;
  radius: number;
  seed: number;
  offset: THREE.Vector3;
  offsetVel: THREE.Vector3;
  lean: THREE.Vector3;
  leanVel: THREE.Vector3;
  jelly: number;
  hovered: boolean;
}

function materialFor(kind: Kind, color: string, variant: Variant): THREE.Material {
  const pal = GARDEN[variant];
  const night = variant === "night";
  switch (kind) {
    case "vinyl":
      return vinylMaterial(pal.vinyl[color] ?? "#ffffff", night);
    case "chrome":
      return chromeMaterial(night);
    case "glass":
      return glassMaterial(pal.glass, night);
    default: {
      const never: never = kind;
      throw new Error(`unknown kind ${String(never)}`);
    }
  }
}

const tmp = new THREE.Vector3();
const fwd = new THREE.Vector3();
const lateral = new THREE.Vector3();
const ndc = new THREE.Vector2();
const ray = new THREE.Raycaster();
const sphere = new THREE.Sphere();

/**
 * The sculptures from garden.glb. Every piece is re-centred on its pivot so it
 * can bob, sway and part around the camera. Scroll velocity leans them back
 * like jelly on a moving tray; the cursor boops them.
 */
export function Sculptures({ variant, onReady }: { variant: Variant; onReady?: (pieces: Piece[]) => void }) {
  const gltf = useWorldGLTF("garden", "garden.glb");
  const camera = useThree((s) => s.camera);
  const time = useSceneTime();
  const night = variant === "night";
  const pal = GARDEN[variant];

  const { group, pieces, cores } = useMemo(() => {
    const group = new THREE.Group();
    const pieces: Piece[] = [];
    const cores: THREE.Mesh[] = [];
    gltf.scene.updateMatrixWorld(true);
    let seed = 0;
    gltf.scene.traverse((o) => {
      const src = o as THREE.Mesh;
      if (!src.isMesh) return;
      const ud = (src.userData ?? {}) as { kind?: Kind; color?: string; pivot?: number[]; rest?: number; sculpture?: string };
      const kind = (ud.kind ?? "vinyl") as Kind;
      const pivot = new THREE.Vector3(...((ud.pivot as [number, number, number]) ?? [0, 0, 0]));
      const geometry = bakedGeometry(src);
      geometry.translate(-pivot.x, -pivot.y, -pivot.z);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const box = geometry.boundingBox!;
      const material = materialFor(kind, ud.color ?? "", variant);
      let wobble: Wobble | null = null;
      if (kind === "vinyl") {
        wobble = makeWobble(seed * 0.137);
        wobble.base.value = box.min.y;
        wobble.height.value = box.max.y - box.min.y;
        if (pal.rim && ud.color && pal.rim[ud.color]) {
          wobble.rim.value.set(pal.rim[ud.color]);
          wobble.rimStrength.value = 1.7;
        }
        withWobble(material, wobble);
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = src.name;
      mesh.position.copy(pivot);
      group.add(mesh);
      pieces.push({
        name: ud.sculpture ?? src.name,
        kind,
        rest: Boolean(ud.rest),
        pivot,
        mesh,
        wobble,
        radius: geometry.boundingSphere!.radius,
        seed: seed++,
        offset: new THREE.Vector3(),
        offsetVel: new THREE.Vector3(),
        lean: new THREE.Vector3(),
        leanVel: new THREE.Vector3(),
        jelly: 0,
        hovered: false,
      });
      if (kind === "glass" && night) {
        // A neon bar inside each frosted slab: the transmission blur turns it into an inner glow.
        const h = box.max.y - Math.max(box.min.y, -pivot.y);
        const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.cores[cores.length % pal.cores.length]).multiplyScalar(7), toneMapped: false });
        const core = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, h * 0.72, 16), coreMat);
        const cy = (box.max.y + Math.max(box.min.y, -pivot.y)) / 2;
        core.position.set(pivot.x + (box.min.x + box.max.x) / 2, pivot.y + cy, pivot.z + (box.min.z + box.max.z) / 2);
        group.add(core);
        cores.push(core);
      }
    });
    return { group, pieces, cores };
  }, [gltf, variant, pal, night]);

  useEffect(() => {
    onReady?.(pieces);
    return () => {
      for (const p of pieces) {
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
      }
      for (const c of cores) {
        c.geometry.dispose();
        (c.material as THREE.Material).dispose();
      }
    };
  }, [pieces, cores, onReady]);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    const t = state.clock.elapsedTime;
    const v = THREE.MathUtils.clamp(time.velocity, -3, 3);
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    ndc.set(pointer.nx, pointer.ny);
    ray.setFromCamera(ndc, camera);

    for (const p of pieces) {
      // Parting: floaters drift aside (and up) as the camera comes through.
      tmp.subVectors(p.pivot, camera.position);
      const dist = tmp.length();
      let part = 0;
      if (!p.rest) {
        part = THREE.MathUtils.smoothstep(8.5 + p.radius, 1.2 + p.radius, dist);
        lateral.set(tmp.x, 0, tmp.z).addScaledVector(fwd, -(tmp.x * fwd.x + tmp.z * fwd.z));
        if (lateral.lengthSq() < 1e-4) lateral.set(fwd.z, 0, -fwd.x);
        lateral.normalize().multiplyScalar(part * 1.6);
        lateral.y = part * 0.6;
      } else {
        lateral.set(0, 0, 0);
      }
      p.offsetVel.addScaledVector(tmp.subVectors(lateral, p.offset), 7 * d).multiplyScalar(Math.exp(-4.5 * d));
      p.offset.addScaledVector(p.offsetVel, d);

      // Inertia lean against the direction of travel, springy.
      const leanTarget = tmp.copy(fwd).multiplyScalar(-v * (p.rest ? 0.12 : 0.22));
      leanTarget.clampLength(0, p.rest ? 0.25 : 0.45);
      p.leanVel.addScaledVector(leanTarget.sub(p.lean), 42 * d).multiplyScalar(Math.exp(-5 * d));
      p.lean.addScaledVector(p.leanVel, d);

      // Cursor boop.
      sphere.set(p.mesh.position, p.radius * 0.8);
      const over = pointer.active && ray.ray.intersectsSphere(sphere);
      if (over && !p.hovered) {
        p.leanVel.addScaledVector(ray.ray.direction, p.rest ? 1.2 : 2.2);
        p.jelly = Math.max(p.jelly, 0.045);
        if (p.rest && p.pivot.y < 0.3) ripples.add(p.pivot.x, p.pivot.z, ripples.now, 0.9);
      }
      p.hovered = over;

      p.jelly = Math.max(p.jelly * Math.exp(-2.2 * d), Math.min(0.05, Math.abs(v) * 0.025));
      const bob = p.rest ? 0 : Math.sin(t * 0.7 + p.seed * 1.9) * 0.09;
      p.mesh.position.set(p.pivot.x + p.offset.x, p.pivot.y + p.offset.y + bob, p.pivot.z + p.offset.z);
      if (!p.rest) {
        p.mesh.rotation.set(Math.sin(t * 0.4 + p.seed) * 0.05 + p.lean.z * 0.3, Math.sin(t * 0.25 + p.seed * 2.3) * 0.12, Math.sin(t * 0.33 + p.seed * 1.3) * 0.05 - p.lean.x * 0.3);
      }
      if (p.wobble) {
        p.wobble.lean.value.copy(p.lean);
        p.wobble.jelly.value = p.jelly;
        p.wobble.time.value = t;
      }
    }
  });

  return <primitive object={group} />;
}

export type { Piece };
