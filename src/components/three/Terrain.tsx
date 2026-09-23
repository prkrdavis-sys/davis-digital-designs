"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { sceneState } from "@/components/three/sceneState";

export const TERRAIN_LENGTH = 260;
const WIDTH = 90;

function noise2(x: number, z: number): number {
  // Layered sines: cheap, deterministic, and plenty for low-poly hills.
  return (
    Math.sin(x * 0.11) * Math.cos(z * 0.09) * 2.2 +
    Math.sin(x * 0.23 + z * 0.17) * 1.1 +
    Math.sin(x * 0.51 - z * 0.37) * 0.45 +
    Math.cos(z * 0.05) * 1.6
  );
}

const TREE_COUNT = 140;

/** Deterministic tree placement so the forest is identical on every visit. */
function buildTreeMatrices(count: number): THREE.Matrix4[] {
  const dummy = new THREE.Object3D();
  const list: THREE.Matrix4[] = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < count; i++) {
    const side = rand() > 0.5 ? 1 : -1;
    const x = side * (10 + rand() * 28);
    const z = -rand() * TERRAIN_LENGTH + TERRAIN_LENGTH / 2;
    const valley = Math.exp(-Math.pow(x / 9, 2)) * 3.2;
    const edgeRise = Math.pow(Math.abs(x) / (WIDTH / 2), 2.2) * 6;
    const y = noise2(x, z) - valley + edgeRise;
    if (y < -0.3) continue;
    const s = 0.7 + rand() * 1.3;
    dummy.position.set(x, y + s * 0.9, z);
    dummy.scale.set(s, s * 1.6, s);
    dummy.rotation.y = rand() * Math.PI;
    dummy.updateMatrix();
    list.push(dummy.matrix.clone());
  }
  return list;
}

/**
 * Low-poly rolling hills the camera flies over. A flat "water" plane sits
 * beneath so valleys read as lakes. Colors lerp with season and night.
 */
export function Terrain() {
  const hills = useRef<THREE.MeshStandardMaterial>(null);
  const water = useRef<THREE.MeshStandardMaterial>(null);
  const trees = useRef<THREE.InstancedMesh>(null);
  const treeMat = useRef<THREE.MeshStandardMaterial>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(WIDTH, TERRAIN_LENGTH, 44, 130);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // Carve a gentle valley down the middle so the camera has a path.
      const valley = Math.exp(-Math.pow(x / 9, 2)) * 3.2;
      const edgeRise = Math.pow(Math.abs(x) / (WIDTH / 2), 2.2) * 6;
      pos.setY(i, noise2(x, z) - valley + edgeRise);
    }
    geo.computeVertexNormals();
    return geo;
  }, []);

  const treeMatrices = useMemo(() => buildTreeMatrices(TREE_COUNT), []);

  useFrame(() => {
    if (hills.current) hills.current.color.copy(sceneState.terrainTop);
    if (water.current) water.current.color.copy(sceneState.terrainBottom);
    if (treeMat.current) {
      treeMat.current.color.copy(sceneState.terrainTop).offsetHSL(0.03, 0.05, -0.12);
    }
    const t = trees.current;
    if (t && t.count !== treeMatrices.length) {
      treeMatrices.forEach((m, i) => t.setMatrixAt(i, m));
      t.count = treeMatrices.length;
      t.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group position={[0, -3.2, -TERRAIN_LENGTH / 2 + 30]}>
      <mesh geometry={geometry} receiveShadow>
        <meshStandardMaterial ref={hills} flatShading roughness={0.95} metalness={0} />
      </mesh>
      <mesh position={[0, -1.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[WIDTH * 2, TERRAIN_LENGTH * 1.5]} />
        <meshStandardMaterial ref={water} roughness={0.2} metalness={0.1} transparent opacity={0.92} />
      </mesh>
      <instancedMesh ref={trees} args={[undefined, undefined, TREE_COUNT]} frustumCulled={false}>
        <coneGeometry args={[1, 2, 6]} />
        <meshStandardMaterial ref={treeMat} flatShading roughness={0.9} />
      </instancedMesh>
    </group>
  );
}
