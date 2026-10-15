"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { BloomEffect, DepthOfFieldEffect } from "postprocessing";
import type { SceneComponentProps } from "@/worlds/types";
import { useLook, usePostFX, useSceneTime } from "@/components/three/engine/slot";
import { RailCamera, loadRail, useRail } from "@/components/three/engine/rails";
import { preloadWorldGLTF } from "@/components/three/engine/assets";
import { CoverPanel } from "@/components/three/engine/CoverPanel";
import { useUi } from "@/lib/store";
import { GARDEN } from "@/worlds/scenes/garden/palette";
import { Sky, FollowCamera } from "@/worlds/scenes/garden/Sky";
import { Motes } from "@/worlds/scenes/garden/Motes";
import { Meadow, NATURE_FILES } from "@/worlds/scenes/garden/Meadow";

const RAIL = "/worlds/garden/rails.json";
const HDRI = "/worlds/garden/hi/studio.hdr";

export function preload() {
  void loadRail(RAIL);
  for (const file of NATURE_FILES) preloadWorldGLTF("garden", file);
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
  const isTouch = useUi((s) => s.isTouch);
  const reducedMotion = useUi((s) => s.reducedMotion);

  useLook({ exposure: night ? 1.15 : 1.05, tone: night ? "agx" : "neutral", seam: night ? "#cdb0ff" : "#ff9cc2", grain: night ? 0.04 : 0.025, vignette: night ? 0.38 : 0.2 });

  const focus = useMemo(() => new THREE.Vector3(4.4, 1.5, 0.4), []);
  usePostFX(
    ({ camera }) => {
      const dof = new DepthOfFieldEffect(camera, { worldFocusRange: 8, bokehScale: night ? 2.2 : 1.8, resolutionScale: 0.5 });
      dof.target = focus;
      const bloom = new BloomEffect({ intensity: night ? 0.85 : 0.22, luminanceThreshold: night ? 0.55 : 0.94, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.7 });
      return [dof, bloom];
    },
    [night, focus],
  );

  useFrame((_, dt) => {
    drift.current += Math.min(dt, 0.05);
    const s = mode === "parked" ? 0.35 : time.s;
    focus.set(4.2 + s * 0.4, 1.45, 0.6 - s * 0.8);
  });

  const remap = useMemo(() => (mode === "parked" ? () => 0.35 + Math.sin(drift.current * 0.1) * 0.04 : undefined), [mode]);

  return (
    <>
      <RailCamera rail={rail} parallax={0.22} look={0.03} remap={remap} />
      <fog attach="fog" args={[pal.fog, 16, 46]} />
      <Studio night={night} />
      <hemisphereLight args={[night ? "#3a3470" : "#fff4f8", night ? "#0c1420" : "#b7c98a", night ? 0.45 : 0.85]} />
      <directionalLight position={[8, 12, 6]} intensity={night ? 0.45 : 1.8} color={night ? "#c5d0ff" : "#fff6ea"} />
      <directionalLight position={[-6, 4, 8]} intensity={night ? 0.2 : 0.45} color="#ffe4ef" />
      {night && <pointLight position={[4.4, 2.2, 0.6]} color="#ffd98a" intensity={8} distance={14} decay={2} />}
      <FollowCamera>
        <Sky stops={pal.sky} stars={pal.stars} />
      </FollowCamera>
      <Meadow night={night} blades={4800} interactive={!isTouch && !reducedMotion} />
      <Motes night={night} count={night ? 280 : 160} />
      {mode === "parked" && <CoverPanel width={1.7} anchor="camera" offset={[0.62, -0.05, 3.1]} rotation={[0, -0.3, 0]} frame={night ? "#2a2152" : "#fff3f8"} glow={night ? 1.3 : 1.05} />}
    </>
  );
}

function Lo({ variant }: SceneComponentProps) {
  const rail = useRail(RAIL);
  const night = variant === "night";
  const pal = GARDEN[variant];
  const isTouch = useUi((s) => s.isTouch);
  const reducedMotion = useUi((s) => s.reducedMotion);

  useLook({ exposure: night ? 1.15 : 1.05, tone: night ? "agx" : "neutral", seam: night ? "#cdb0ff" : "#ff9cc2", grain: 0.02, vignette: night ? 0.3 : 0.16 });

  return (
    <>
      <RailCamera rail={rail} parallax={0.12} look={0.02} />
      <fog attach="fog" args={[pal.fog, 16, 46]} />
      <hemisphereLight args={[night ? "#3a3470" : "#fff4f8", night ? "#0c1420" : "#b7c98a", night ? 0.7 : 1.1]} />
      <directionalLight position={[8, 12, 6]} intensity={night ? 0.7 : 1.6} color={night ? "#c5d0ff" : "#fff6ea"} />
      <FollowCamera>
        <Sky stops={pal.sky} stars={pal.stars} />
      </FollowCamera>
      <Meadow night={night} blades={1100} interactive={!isTouch && !reducedMotion} />
      <Motes night={night} count={70} />
    </>
  );
}

export default function Scene(props: SceneComponentProps) {
  return props.quality === "lo" ? <Lo {...props} /> : <Hi {...props} />;
}
