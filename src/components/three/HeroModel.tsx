"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Float, MeshDistortMaterial } from "@react-three/drei";
import * as THREE from "three";
import { sceneState } from "@/components/three/sceneState";

/**
 * Hero object slot.
 *
 * Today this is a procedural "seed": a softly distorting blob that floats over
 * the valley near the start of the journey. When you have a Spline or Blender
 * model, export it as .glb into /public/models and swap the contents of this
 * component for:
 *
 *   const { scene } = useGLTF("/models/hero.glb");
 *   return <primitive object={scene} />;
 */
export function HeroModel() {
  const mat = useRef<THREE.MeshPhysicalMaterial & { distort: number }>(null);
  const group = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (mat.current) {
      mat.current.color.copy(sceneState.particleColors[0]).lerp(new THREE.Color("#ffffff"), 0.25);
      mat.current.emissive.copy(sceneState.particleColors[1]).multiplyScalar(sceneState.night * 0.6);
    }
    if (group.current) {
      group.current.rotation.y = state.clock.elapsedTime * 0.15 + state.pointer.x * 0.3;
      group.current.rotation.x = state.pointer.y * -0.15;
      // Fade the hero out as we travel away from the start.
      const s = THREE.MathUtils.clamp(1 - Math.abs(sceneState.cameraZ) / 30, 0, 1);
      group.current.scale.setScalar(s);
      group.current.visible = s > 0.01;
    }
  });

  return (
    <group ref={group} position={[5.2, 1.8, -12]}>
      <Float speed={1.6} rotationIntensity={0.6} floatIntensity={1.4}>
        <mesh castShadow>
          <icosahedronGeometry args={[1.5, 24]} />
          <MeshDistortMaterial ref={mat as never} distort={0.38} speed={2} roughness={0.15} metalness={0.05} clearcoat={0.6} />
        </mesh>
        <mesh position={[-1.9, -0.6, 0.6]}>
          <torusGeometry args={[0.55, 0.16, 12, 48]} />
          <meshStandardMaterial color="#ffd27a" roughness={0.4} />
        </mesh>
      </Float>
    </group>
  );
}
