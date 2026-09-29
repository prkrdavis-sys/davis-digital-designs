"use client";

import { Suspense, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RoundedBox, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { pointer, useUi } from "@/lib/store";

export interface CoverPanelProps {
  /** Panel width in scene units (height follows the cover's aspect). */
  width: number;
  /**
   * Where the panel sits. "camera" keeps it a fixed distance in front of the
   * camera (offset in camera space); "world" places it at `position`.
   */
  anchor?: "camera" | "world";
  position?: [number, number, number];
  /** Camera-space offset for anchor="camera" (x right, y up, z forward distance). */
  offset?: [number, number, number];
  rotation?: [number, number, number];
  /** Frame color and how much the screen glows (HDR multiplier; >1 blooms). */
  frame?: string;
  glow?: number;
  /** Bezel depth relative to width. */
  depth?: number;
}

const local = new THREE.Vector3();
const q = new THREE.Quaternion();
const tilt = new THREE.Euler();

function Panel({ url, width, anchor = "camera", position = [0, 0, 0], offset = [0.25, 0, 3], rotation = [0, -0.25, 0], frame = "#ffffff", glow = 1.15, depth = 0.04 }: CoverPanelProps & { url: string }) {
  const tex = useTexture(url, (t) => {
    const tt = Array.isArray(t) ? t[0] : t;
    tt.colorSpace = THREE.SRGBColorSpace;
    tt.anisotropy = 8;
  }) as THREE.Texture;
  const img = tex.image as { width?: number; height?: number } | undefined;
  const aspect = img?.width && img?.height ? img.height / img.width : 9 / 16;
  const h = width * aspect;
  const group = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const screen = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(glow, glow, glow) }), [tex, glow]);
  const bezel = useMemo(() => new THREE.MeshPhysicalMaterial({ color: frame, roughness: 0.25, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1, transmission: 0.35, thickness: 0.2 }), [frame]);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    if (anchor === "camera") {
      local.set(offset[0], offset[1], -offset[2]).applyQuaternion(camera.quaternion);
      g.position.copy(camera.position).add(local);
      q.copy(camera.quaternion);
      tilt.set(rotation[0] + pointer.sy * 0.08 + Math.sin(t * 0.5) * 0.02, rotation[1] - pointer.sx * 0.12, rotation[2] + Math.sin(t * 0.37) * 0.01);
      g.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(tilt));
    } else {
      g.position.set(position[0], position[1] + Math.sin(t * 0.6) * h * 0.02, position[2]);
      g.rotation.set(rotation[0] + pointer.sy * 0.06, rotation[1] - pointer.sx * 0.1, rotation[2]);
    }
  });

  return (
    <group ref={group}>
      <RoundedBox args={[width * 1.04, h + width * 0.04, width * depth]} radius={width * 0.018} smoothness={4} material={bezel} position={[0, 0, -width * depth * 0.5]} />
      <mesh material={screen} position={[0, 0, width * 0.001]}>
        <planeGeometry args={[width, h]} />
      </mesh>
    </group>
  );
}

/**
 * The project cover, framed and glowing softly inside a world's parked view.
 * Renders nothing until a project page sets a cover. Loads in its own
 * Suspense boundary so it never delays the scene becoming ready.
 */
export function CoverPanel(props: CoverPanelProps) {
  const cover = useUi((s) => s.cover);
  if (!cover) return null;
  return (
    <Suspense fallback={null}>
      <Panel key={cover} url={cover} {...props} />
    </Suspense>
  );
}
