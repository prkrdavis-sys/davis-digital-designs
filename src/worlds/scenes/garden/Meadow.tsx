"use client";

import { useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { LoadedGLTF } from "@/components/three/engine/assets";
import { useWorldGLTF } from "@/components/three/engine/assets";
import { pointer } from "@/lib/store";
import { useSceneTime } from "@/components/three/engine/slot";
import { Grass } from "@/worlds/scenes/garden/Grass";
import { meadowLean, meadowWave } from "@/worlds/scenes/garden/wave";

const NATURE = "nature";

interface Spec {
  file: string;
  x: number;
  z: number;
  y: number;
  scale: number;
  yaw: number;
  /** How far the wave tips this piece. Rocks stay put. */
  lean: number;
}

/** Right of centre: the headline owns the left of the frame. */
const SPECS: Spec[] = [
  { file: "CommonTree_1.gltf", x: 5.4, z: -1.6, y: 0, scale: 0.72, yaw: 0.4, lean: 0.55 },
  { file: "Flower_3_Single.gltf", x: 3.15, z: 1.7, y: 0, scale: 1.45, yaw: 0.2, lean: 1.7 },
  { file: "Flower_4_Single.gltf", x: 6.7, z: 1.15, y: 0, scale: 1.25, yaw: -0.5, lean: 1.55 },
  { file: "Flower_3_Group.gltf", x: 4.35, z: -0.15, y: 0, scale: 1.15, yaw: 0.8, lean: 1.35 },
  { file: "Flower_4_Group.gltf", x: 7.15, z: -0.45, y: 0, scale: 1.05, yaw: 1.4, lean: 1.25 },
  { file: "Bush_Common_Flowers.gltf", x: 2.35, z: -3.2, y: 0, scale: 1.35, yaw: 0.3, lean: 0.9 },
  { file: "Plant_1_Big.gltf", x: 8.1, z: -2.8, y: 0, scale: 0.62, yaw: -0.6, lean: 0.8 },
  { file: "Fern_1.gltf", x: 4.6, z: 3.15, y: 0, scale: 0.22, yaw: 1.1, lean: 1.1 },
  { file: "Clover_1.gltf", x: 1.5, z: 0.4, y: 0, scale: 0.7, yaw: 0.5, lean: 1.2 },
  { file: "Clover_1.gltf", x: -2.4, z: 2.2, y: 0, scale: 0.45, yaw: 1.7, lean: 0.8 },
  { file: "Rock_Medium_1.gltf", x: 2.7, z: 3.35, y: 0.08, scale: 0.38, yaw: 0.6, lean: 0 },
  { file: "Rock_Medium_2.gltf", x: 7.6, z: 2.35, y: 0.04, scale: 0.34, yaw: -0.4, lean: 0 },
  { file: "Pebble_Round_2.gltf", x: 1.9, z: 1.6, y: 0, scale: 2.4, yaw: 0.2, lean: 0 },
  { file: "Pebble_Round_2.gltf", x: 5.9, z: 2.7, y: 0, scale: 1.8, yaw: 1.2, lean: 0 },
  { file: "Grass_Common_Short.gltf", x: 3.8, z: 2.4, y: 0, scale: 0.85, yaw: 0.9, lean: 1.4 },
  { file: "Grass_Common_Short.gltf", x: 6.2, z: -2.4, y: 0, scale: 0.7, yaw: 2.1, lean: 1.2 },
];

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const ray = new THREE.Raycaster();
const hit = new THREE.Vector3();
const lean = new THREE.Vector2();

interface LeanPiece {
  group: THREE.Group;
  x: number;
  z: number;
  amount: number;
}

function usePieces() {
  const tree = useWorldGLTF("garden", `${NATURE}/CommonTree_1.gltf`);
  const flower3 = useWorldGLTF("garden", `${NATURE}/Flower_3_Single.gltf`);
  const flower4 = useWorldGLTF("garden", `${NATURE}/Flower_4_Single.gltf`);
  const group3 = useWorldGLTF("garden", `${NATURE}/Flower_3_Group.gltf`);
  const group4 = useWorldGLTF("garden", `${NATURE}/Flower_4_Group.gltf`);
  const bush = useWorldGLTF("garden", `${NATURE}/Bush_Common_Flowers.gltf`);
  const plant = useWorldGLTF("garden", `${NATURE}/Plant_1_Big.gltf`);
  const fern = useWorldGLTF("garden", `${NATURE}/Fern_1.gltf`);
  const clover = useWorldGLTF("garden", `${NATURE}/Clover_1.gltf`);
  const rock1 = useWorldGLTF("garden", `${NATURE}/Rock_Medium_1.gltf`);
  const rock2 = useWorldGLTF("garden", `${NATURE}/Rock_Medium_2.gltf`);
  const pebble = useWorldGLTF("garden", `${NATURE}/Pebble_Round_2.gltf`);
  const grass = useWorldGLTF("garden", `${NATURE}/Grass_Common_Short.gltf`);

  return useMemo(() => {
    const byFile: Record<string, LoadedGLTF> = {
      "CommonTree_1.gltf": tree,
      "Flower_3_Single.gltf": flower3,
      "Flower_4_Single.gltf": flower4,
      "Flower_3_Group.gltf": group3,
      "Flower_4_Group.gltf": group4,
      "Bush_Common_Flowers.gltf": bush,
      "Plant_1_Big.gltf": plant,
      "Fern_1.gltf": fern,
      "Clover_1.gltf": clover,
      "Rock_Medium_1.gltf": rock1,
      "Rock_Medium_2.gltf": rock2,
      "Pebble_Round_2.gltf": pebble,
      "Grass_Common_Short.gltf": grass,
    };
    const root = new THREE.Group();
    const pieces: LeanPiece[] = [];
    for (const spec of SPECS) {
      const src = byFile[spec.file];
      if (!src) throw new Error(`missing meadow model ${spec.file}`);
      const group = new THREE.Group();
      group.position.set(spec.x, 0, spec.z);
      const model = src.scene.clone(true);
      model.position.y = spec.y;
      model.scale.setScalar(spec.scale);
      model.rotation.y = spec.yaw;
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.frustumCulled = false;
      });
      group.add(model);
      root.add(group);
      pieces.push({ group, x: spec.x, z: spec.z, amount: spec.lean });
    }
    return { root, pieces };
  }, [tree, flower3, flower4, group3, group4, bush, plant, fern, clover, rock1, rock2, pebble, grass]);
}

interface MeadowProps {
  night: boolean;
  blades: number;
  /** Cursor ripples. Wind still plays when this is false. */
  interactive: boolean;
}

/** A clearing of stylized plants. The cursor sends the old water-ripple wave through the grass. */
export function Meadow({ night, blades, interactive }: MeadowProps) {
  const camera = useThree((s) => s.camera);
  const time = useSceneTime();
  const { root, pieces } = usePieces();
  const last = useMemo(() => ({ x: 0, z: 0, t: -10, valid: false }), []);

  const ground = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: night ? "#1a2434" : "#e7f0c9",
      roughness: 1,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(42, 48), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.02;
    mesh.receiveShadow = false;
    return mesh;
  }, [night]);

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    meadowWave.now += d;
    const now = meadowWave.now;

    if (interactive && pointer.active && time.visible) {
      ndc.set(pointer.nx, pointer.ny);
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(groundPlane, hit) && hit.distanceTo(camera.position) < 36) {
        const moved = Math.hypot(hit.x - last.x, hit.z - last.z);
        if (!last.valid || (moved > 0.35 && now - last.t > 0.06)) {
          meadowWave.add(hit.x, hit.z, now, last.valid ? Math.min(1.15, 0.4 + moved * 0.45) : 0.7);
          last.x = hit.x;
          last.z = hit.z;
          last.t = now;
          last.valid = true;
        }
      } else {
        last.valid = false;
      }
    } else {
      last.valid = false;
    }

    for (const piece of pieces) {
      if (piece.amount === 0) continue;
      meadowLean(piece.x, piece.z, now, lean);
      const k = piece.amount * 0.012;
      piece.group.rotation.z = -lean.x * k;
      piece.group.rotation.x = lean.y * k;
    }
  }, 1);

  return (
    <>
      <primitive object={ground} />
      <primitive object={root} />
      <Grass count={blades} night={night} />
    </>
  );
}

export const NATURE_FILES = [
  "nature/CommonTree_1.gltf",
  "nature/Flower_3_Single.gltf",
  "nature/Flower_4_Single.gltf",
  "nature/Flower_3_Group.gltf",
  "nature/Flower_4_Group.gltf",
  "nature/Bush_Common_Flowers.gltf",
  "nature/Plant_1_Big.gltf",
  "nature/Fern_1.gltf",
  "nature/Clover_1.gltf",
  "nature/Rock_Medium_1.gltf",
  "nature/Rock_Medium_2.gltf",
  "nature/Pebble_Round_2.gltf",
  "nature/Grass_Common_Short.gltf",
];
