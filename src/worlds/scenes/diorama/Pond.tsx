"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface PondProps {
  center: [number, number, number];
  rx: number;
  rz: number;
  tint: string;
  night: boolean;
}

/** Small reflecting oval in the island. Live-lit; the terrain bake stays dry. */
export function Pond({ center, rx, rz, tint, night }: PondProps) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(tint),
        roughness: night ? 0.12 : 0.06,
        metalness: 0.08,
        transmission: night ? 0.35 : 0.62,
        thickness: 0.45,
        ior: 1.333,
        clearcoat: 0.7,
        clearcoatRoughness: 0.08,
        envMapIntensity: night ? 0.55 : 1.15,
        transparent: true,
        opacity: 0.94,
      }),
    [tint, night],
  );

  useFrame((state) => {
    const m = mesh.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    m.position.y = center[1] + Math.sin(t * 0.35) * 0.004;
    material.roughness = (night ? 0.12 : 0.06) + Math.sin(t * 0.5) * 0.01;
  });

  return (
    <group position={[center[0], 0, center[2]]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, center[1] - 0.04, 0]}>
        <circleGeometry args={[1, 48]} />
        <meshStandardMaterial color={night ? "#050814" : "#2a4060"} roughness={1} />
      </mesh>
      <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} position={[0, center[1], 0]} material={material} scale={[rx, 1, rz]}>
        <circleGeometry args={[1, 64]} />
      </mesh>
    </group>
  );
}
