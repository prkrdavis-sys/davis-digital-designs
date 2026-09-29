"use client";

import { use, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { BloomEffect, DepthOfFieldEffect } from "postprocessing";
import type { SceneComponentProps } from "@/worlds/types";
import { useLook, usePostFX } from "@/components/three/engine/slot";
import { RailCamera, loadRail, useRail } from "@/components/three/engine/rails";
import { preloadWorldGLTF } from "@/components/three/engine/assets";
import { CoverPanel } from "@/components/three/engine/CoverPanel";
import { LayerStack } from "@/worlds/lo/LayerStack";
import { Sky, FollowCamera } from "@/worlds/scenes/garden/Sky";
import { Motes } from "@/worlds/scenes/garden/Motes";
import { BUBBLES } from "@/worlds/scenes/bubbles/palette";
import { loadLayout } from "@/worlds/scenes/bubbles/layout";
import { Flock } from "@/worlds/scenes/bubbles/Flock";
import { Clouds } from "@/worlds/scenes/bubbles/Clouds";

const RAIL = "/worlds/bubbles/rails.json";
/** Shared with the garden (same studio), so the browser fetches it once. */
const HDRI = "/worlds/garden/hi/studio.hdr";

export function preload() {
  void loadRail(RAIL);
  void loadLayout();
  preloadWorldGLTF("bubbles", "bubbles.glb");
}

type Box = [[number, number, number], [number, number, number]];
const MOTE_BOX: Box = [
  [-14, -6, -26],
  [14, 26, 6],
];
const LO_BOX: Box = [
  [-6, -3, -9],
  [6, 4, -2],
];

function Studio({ night }: { night: boolean }) {
  return (
    <Environment files={HDRI} resolution={256} frames={1} environmentIntensity={night ? 0.5 : 1}>
      <Lightformer form="rect" intensity={night ? 1 : 4} color="#fff3ea" position={[8, 10, 6]} scale={[10, 6, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={night ? 0.5 : 1.6} color="#dfe6ff" position={[-9, 3, 4]} scale={[6, 8, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={night ? 2.4 : 1.4} color={night ? "#ff5f9c" : "#ffc2dc"} position={[0, -8, -6]} scale={[16, 6, 1]} target={[0, 0, 0]} />
      <Lightformer form="ring" intensity={night ? 1.2 : 2.5} color="#ffffff" position={[0, 14, 0]} scale={5} target={[0, 0, 0]} />
    </Environment>
  );
}

function Hi({ variant, mode }: SceneComponentProps) {
  const rail = useRail(RAIL);
  const layout = use(loadLayout());
  const night = variant === "night";
  const pal = BUBBLES[variant];
  const drift = useRef(0);
  const camera = useThree((s) => s.camera);

  useLook({ exposure: night ? 1.1 : 1.0, tone: night ? "agx" : "neutral", seam: night ? "#ffa6d0" : "#9dbcff", grain: night ? 0.04 : 0.025, vignette: night ? 0.36 : 0.18 });

  const focus = useMemo(() => new THREE.Vector3(), []);
  usePostFX(
    ({ camera: cam }) => {
      const dof = new DepthOfFieldEffect(cam, { worldFocusRange: 8, bokehScale: night ? 2.6 : 2.4, resolutionScale: 0.5 });
      dof.target = focus;
      const bloom = new BloomEffect({ intensity: night ? 1.35 : 0.3, luminanceThreshold: night ? 0.4 : 0.92, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.75 });
      return [dof, bloom];
    },
    [night, focus],
  );

  const [ax, , az] = layout.axis;
  useFrame((_, dt) => {
    drift.current += Math.min(dt, 0.05);
    // Focus on the flock's axis at eye level (bubbles in front and behind melt into bokeh).
    focus.set(ax, camera.position.y, az);
  });

  const offset = layout.railOffset;
  const remap = useMemo(() => (mode === "parked" ? () => 0.6 + Math.sin(drift.current * 0.1) * 0.08 : (s: number) => s + offset), [mode, offset]);

  return (
    <>
      <RailCamera rail={rail} parallax={0.35} look={0.035} remap={remap} />
      <fog attach="fog" args={[pal.fog, 18, 60]} />
      <Studio night={night} />
      <hemisphereLight args={[night ? "#3a3470" : "#fff4f8", night ? "#1a0f33" : "#ffd6e6", night ? 0.3 : 0.9]} />
      <directionalLight position={[10, 14, 8]} intensity={night ? 0.25 : 2.0} color={night ? "#aab6ff" : "#fff1e4"} />
      <directionalLight position={[0, -6, -10]} intensity={night ? 0.6 : 0.5} color={night ? "#ff6fa8" : "#ffd0e2"} />
      <FollowCamera>
        <Sky stops={pal.sky} stars={pal.stars} />
      </FollowCamera>
      <Clouds variant={variant} layout={layout} />
      <Flock variant={variant} layout={layout} />
      <Motes night={night} count={night ? 300 : 200} box={MOTE_BOX} size={0.07} colors={pal.motes} />
      {mode === "parked" && <CoverPanel width={1.7} anchor="camera" offset={[0.6, -0.05, 3.1]} rotation={[0, -0.3, 0]} frame={night ? "#2a2152" : "#ffffff"} glow={night ? 1.3 : 1.05} />}
    </>
  );
}

function Lo({ variant }: SceneComponentProps) {
  const night = variant === "night";
  return (
    <LayerStack scene="bubbles" variant={variant} parallax={0.045} dolly={0.1} focus={0.62}>
      <Motes night={night} count={80} box={LO_BOX} size={0.05} colors={BUBBLES[variant].motes} />
    </LayerStack>
  );
}

export default function Scene(props: SceneComponentProps) {
  return props.quality === "lo" ? <Lo {...props} /> : <Hi {...props} />;
}
