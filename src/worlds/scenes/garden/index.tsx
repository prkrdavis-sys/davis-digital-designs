"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { BloomEffect, DepthOfFieldEffect } from "postprocessing";
import type { SceneComponentProps, Variant } from "@/worlds/types";
import { useLook, usePostFX, useSceneTime } from "@/components/three/engine/slot";
import { RailCamera, loadRail, useRail } from "@/components/three/engine/rails";
import { preloadWorldGLTF, useWorldGLTF } from "@/components/three/engine/assets";
import { CoverPanel } from "@/components/three/engine/CoverPanel";
import { LayerStack } from "@/worlds/lo/LayerStack";
import { GARDEN } from "@/worlds/scenes/garden/palette";
import { Sky, FollowCamera } from "@/worlds/scenes/garden/Sky";
import { Pool } from "@/worlds/scenes/garden/Pool";
import { Sculptures } from "@/worlds/scenes/garden/Sculptures";
import { Motes } from "@/worlds/scenes/garden/Motes";

const RAIL = "/worlds/garden/rails.json";
const HDRI = "/worlds/garden/hi/studio.hdr";

export function preload() {
  void loadRail(RAIL);
  preloadWorldGLTF("garden", "garden.glb");
  preloadWorldGLTF("garden", "plinths-day.glb");
}

/** Water-line rings around the pieces standing in the pool: [x, z, radius, strength] (three.js coords). */
const CONTACTS: [number, number, number, number][] = [
  [1.05, 7.4, 1.25, 0.07],
  [-1.35, -3.0, 0.55, 0.05],
  [2.05, -3.0, 0.55, 0.05],
  [-3.4, 2.6, 0.8, 0.04],
  [-2.6, -8.2, 0.65, 0.04],
  [5.4, 1.2, 1.05, 0.05],
  [4.6, 8.2, 0.72, 0.05],
  [1.9, -15.2, 2.65, 0.06],
  [-9.0, -26.0, 4.18, 0.05],
  [5.4, -10.4, 1.3, 0.04],
];

/** Focus pulls from the star, to the arch, to the D as the camera pushes up the pool. */
const FOCI: [number, [number, number, number]][] = [
  [0.0, [2.9, 2.75, 4.2]],
  [0.42, [0.35, 2.6, -3.0]],
  [0.8, [1.9, 2.2, -15.2]],
];

function focusAt(s: number, out: THREE.Vector3) {
  let k = 0;
  while (k < FOCI.length - 1 && s > FOCI[k + 1][0]) k++;
  const a = FOCI[k];
  const b = FOCI[Math.min(k + 1, FOCI.length - 1)];
  const t = a === b ? 0 : THREE.MathUtils.smoothstep(s, a[0] + (b[0] - a[0]) * 0.55, b[0]);
  return out.set(a[1][0] + (b[1][0] - a[1][0]) * t, a[1][1] + (b[1][1] - a[1][1]) * t, a[1][2] + (b[1][2] - a[1][2]) * t);
}

function Plinths({ variant }: { variant: Variant }) {
  const gltf = useWorldGLTF("garden", `plinths-${variant}.glb`);
  useEffect(() => {
    gltf.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && "envMapIntensity" in m) {
        m.envMapIntensity = variant === "night" ? 0.15 : 0.35;
        m.roughness = 0.7;
      }
    });
  }, [gltf, variant]);
  return <primitive object={gltf.scene} />;
}

/** Studio: the Poly Haven HDRI plus softboxes and pastel bounce cards, baked once into the env map. */
function Studio({ night }: { night: boolean }) {
  return (
    <Environment files={HDRI} resolution={256} frames={1} environmentIntensity={night ? 0.55 : 1}>
      <Lightformer form="rect" intensity={night ? 1.2 : 4} color="#fff3ea" position={[6, 9, 5]} scale={[10, 6, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={night ? 0.6 : 1.6} color="#dfe6ff" position={[-9, 4, 3]} scale={[6, 8, 1]} target={[0, 1, 0]} />
      <Lightformer form="rect" intensity={night ? 2.2 : 1.4} color={night ? "#ff5fb0" : "#ffb6d3"} position={[4, 1.5, -18]} scale={[14, 4, 1]} target={[0, 1, 0]} />
      <Lightformer form="rect" intensity={night ? 2 : 1.2} color={night ? "#6f86ff" : "#b9c8ff"} position={[-6, 1, 12]} scale={[12, 3, 1]} target={[0, 1, 0]} />
      <Lightformer form="ring" intensity={night ? 1.5 : 3} color="#ffffff" position={[0, 12, 0]} scale={4} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={night ? 0.3 : 1.2} color="#ffe6c9" position={[0, -3, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[30, 30, 1]} />
    </Environment>
  );
}

function Hi({ variant, mode }: SceneComponentProps) {
  const rail = useRail(RAIL);
  const time = useSceneTime();
  const night = variant === "night";
  const pal = GARDEN[variant];
  const drift = useRef(0);

  useLook({ exposure: night ? 1.1 : 1.0, tone: night ? "agx" : "neutral", seam: night ? "#cdb0ff" : "#ff9cc2", grain: night ? 0.04 : 0.025, vignette: night ? 0.38 : 0.2 });

  const focus = useMemo(() => new THREE.Vector3(), []);
  usePostFX(
    ({ camera }) => {
      const dof = new DepthOfFieldEffect(camera, { worldFocusRange: 7, bokehScale: night ? 2.6 : 2.2, resolutionScale: 0.5 });
      dof.target = focus;
      const bloom = new BloomEffect({ intensity: night ? 1.25 : 0.3, luminanceThreshold: night ? 0.45 : 0.92, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.75 });
      return [dof, bloom];
    },
    [night, focus],
  );

  useFrame((_, dt) => {
    drift.current += Math.min(dt, 0.05);
    focusAt(mode === "parked" ? 0.3 : time.s, focus);
  });

  const remap = useMemo(() => (mode === "parked" ? () => 0.3 + Math.sin(drift.current * 0.1) * 0.05 : undefined), [mode]);

  return (
    <>
      <RailCamera rail={rail} parallax={0.3} look={0.035} remap={remap} />
      <fog attach="fog" args={[pal.fog, 30, 150]} />
      <Studio night={night} />
      <hemisphereLight args={[night ? "#3a3470" : "#fff4f8", night ? "#0c0a20" : "#c9d0ff", night ? 0.35 : 0.9]} />
      <directionalLight position={[9, 11, 8]} intensity={night ? 0.35 : 2.1} color={night ? "#aab6ff" : "#fff1e4"} />
      <directionalLight position={[-8, 4, 6]} intensity={night ? 0.15 : 0.6} color="#dfe4ff" />
      {night && (
        <>
          <pointLight position={[2.9, 1.6, 4.2]} color="#ffd98a" intensity={9} distance={9} decay={2} />
          <pointLight position={[1.9, 1.5, -13]} color="#ff7fc0" intensity={14} distance={12} decay={2} />
          <pointLight position={[3.3, 2.2, -7.2]} color="#b99bff" intensity={8} distance={9} decay={2} />
        </>
      )}
      <FollowCamera>
        <Sky stops={pal.sky} stars={pal.stars} />
      </FollowCamera>
      <Pool tint={pal.water} fog={pal.fog} night={night} contacts={CONTACTS} />
      <Plinths variant={variant} />
      <Sculptures variant={variant} />
      <Motes night={night} count={night ? 320 : 220} />
      {mode === "parked" && <CoverPanel width={1.7} anchor="camera" offset={[0.62, -0.05, 3.1]} rotation={[0, -0.3, 0]} frame={night ? "#2a2152" : "#fff3f8"} glow={night ? 1.3 : 1.05} />}
    </>
  );
}

function Lo({ variant }: SceneComponentProps) {
  const night = variant === "night";
  return (
    <LayerStack scene="garden" variant={variant} parallax={0.04} dolly={0.12} focus={0.68}>
      <Motes night={night} count={90} box={LO_BOX} size={0.05} />
    </LayerStack>
  );
}

const LO_BOX: [[number, number, number], [number, number, number]] = [
  [-6, -2.5, -9],
  [6, 3.5, -2],
];

export default function Scene(props: SceneComponentProps) {
  return props.quality === "lo" ? <Lo {...props} /> : <Hi {...props} />;
}
