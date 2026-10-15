"use client";

import { useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { pointer, useUi } from "@/lib/store";
import { useSceneTime } from "@/components/three/engine/slot";
import { useWorldGLTF } from "@/components/three/engine/assets";
import { meshesByName } from "@/worlds/scenes/doors/shared/baked";
import type { MonolithLayout } from "@/worlds/scenes/monolith/layout";
import { drive, smoothstep } from "@/worlds/scenes/monolith/drive";
import { facetReadout } from "@/worlds/scenes/monolith/labels";

const BASE = new THREE.Color("#d7e4ee");

function glassMaterial(night: boolean, mirror: boolean) {
  if (mirror) {
    return new THREE.MeshPhysicalMaterial({
      color: night ? "#9aabbc" : "#d5dee8",
      metalness: 0.18,
      roughness: 0.06,
      envMapIntensity: 1.15,
      clearcoat: 0.4,
      clearcoatRoughness: 0.08,
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: night ? "#e7eef6" : "#f4f8fb",
    metalness: 0,
    roughness: 0.02,
    transmission: 1,
    thickness: 0.24,
    ior: 1.5,
    dispersion: 0.55,
    attenuationColor: BASE.clone(),
    attenuationDistance: 2.6,
    specularIntensity: 1,
    envMapIntensity: night ? 1.45 : 1.15,
    clearcoat: 0.25,
    clearcoatRoughness: 0.05,
  });
}

interface Piece {
  group: THREE.Group;
  home: THREE.Vector3;
  quat: THREE.Quaternion;
  mat: THREE.MeshPhysicalMaterial;
  tint: THREE.Color;
  index: number;
}

/**
 * Five glass slices. Scroll fans them apart and tints each one.
 * The cursor turns the whole slab, slowly, like something with real mass.
 */
export function Monolith({ layout, night, mirror = false }: { layout: MonolithLayout; night: boolean; mirror?: boolean }) {
  const gltf = useWorldGLTF("monolith", "facets.glb");
  const camera = useThree((s) => s.camera);
  const time = useSceneTime();
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);

  const { root, pieces, pivot } = useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    const meshes = meshesByName(gltf);
    const pivot = new THREE.Group();
    const pieces: Piece[] = [];
    layout.facets.forEach((spec, index) => {
      const src = meshes.get(spec.name);
      if (!src) return;
      const home = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      src.matrixWorld.decompose(home, quat, scl);
      const mat = glassMaterial(night, mirror);
      const mesh = new THREE.Mesh(src.geometry, mat);
      mesh.scale.copy(scl);
      const group = new THREE.Group();
      group.quaternion.copy(quat);
      group.add(mesh);
      pivot.add(group);
      pieces.push({ group, home, quat, mat, tint: new THREE.Color(spec.tint), index });
      facetReadout[index].label = spec.label;
    });
    const root = new THREE.Group();
    root.add(pivot);
    return { root, pieces, pivot };
  }, [gltf, layout, night, mirror]);

  const center = useMemo(() => {
    const c = new THREE.Vector3();
    if (!pieces.length) return c;
    for (const p of pieces) c.add(p.home);
    return c.multiplyScalar(1 / pieces.length);
  }, [pieces]);

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    if (!mirror) {
      const { isTouch, reducedMotion } = useUi.getState();
      const calm = isTouch || reducedMotion || !pointer.active;
      const clock = time.s;
      drive.split = reducedMotion ? 0 : smoothstep(0.48, 0.9, clock);
      const rest = Math.sin(clock * 0.35 + performance.now() * 0.00015) * 0.22;
      const aim = calm ? rest : pointer.sx * 0.42;
      drive.yaw += (aim - drive.yaw) * (1 - Math.exp(-d * (calm ? 0.6 : 2.2)));
      const turnAim = calm ? Math.sin(performance.now() * 0.00012) * 0.03 : pointer.sx * 0.07;
      drive.turn += (turnAim - drive.turn) * (1 - Math.exp(-d * 1.1));
    }

    pivot.position.copy(center);
    pivot.rotation.y = drive.turn;
    const spread = drive.split * 0.46;
    for (const piece of pieces) {
      right.set(1, 0, 0).applyQuaternion(piece.quat);
      const along = (piece.index - 2) * spread;
      tmp.copy(piece.home).addScaledVector(right, along);
      // A little stagger in depth so the slices read as separate panes, not a blur.
      tmp.z += (piece.index - 2) * drive.split * 0.06;
      piece.group.position.copy(tmp).sub(center);
      piece.group.quaternion.copy(piece.quat);
      piece.group.rotateY((piece.index - 2) * drive.split * 0.14);
      if (!mirror) {
        const atten = piece.mat.attenuationColor;
        atten.copy(BASE).lerp(piece.tint, drive.split * 0.9);
        piece.mat.attenuationDistance = THREE.MathUtils.lerp(2.6, 0.85, drive.split);
        piece.group.updateWorldMatrix(true, true);
        piece.group.getWorldPosition(tmp);
        tmp.y += 1.35;
        tmp.project(camera);
        const readout = facetReadout[piece.index];
        readout.x = tmp.x * 0.5 + 0.5;
        readout.y = -tmp.y * 0.5 + 0.5;
        const on = drive.split > 0.12 && tmp.z < 1;
        readout.a = on ? Math.min(1, (drive.split - 0.12) / 0.3) : 0;
      }
    }
  }, mirror ? 0 : 1);

  return <primitive object={root} />;
}
