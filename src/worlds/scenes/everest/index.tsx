"use client";

import { use, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { BloomEffect } from "postprocessing";
import type { SceneComponentProps } from "@/worlds/types";
import { useLook, usePostFX } from "@/components/three/engine/slot";
import { RailCamera, loadRail, useRail } from "@/components/three/engine/rails";
import { preloadWorldGLTF } from "@/components/three/engine/assets";
import { CoverPanel } from "@/components/three/engine/CoverPanel";
import { LayerStack } from "@/worlds/lo/LayerStack";
import { groundY, loadEverest, type EverestData } from "@/worlds/scenes/everest/data";
import { LOOKS } from "@/worlds/scenes/everest/look";
import { TERRAIN_TEX, Terrain } from "@/worlds/scenes/everest/Terrain";
import { Sky } from "@/worlds/scenes/everest/Sky";
import { Labels, RouteLine } from "@/worlds/scenes/everest/Route";
import { Glints, NightLights, SummitPlume } from "@/worlds/scenes/everest/Atmosphere";
import { Clouds } from "@/worlds/scenes/everest/Clouds";
import { LoDrift } from "@/worlds/scenes/everest/LoDrift";

const RAIL = "/worlds/everest/rails.json";

export function preload() {
  void loadEverest();
  void loadRail(RAIL);
  preloadWorldGLTF("everest", "terrain.glb");
  useTexture.preload(TERRAIN_TEX.normal);
}

/** Near plane tracks height above the ground: centimetre-true up close, no z-fighting from orbit. */
function DepthRange({ data }: { data: EverestData }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useFrame(() => {
    const above = Math.max(0.5, camera.position.y - groundY(data, camera.position.x, camera.position.z));
    const near = THREE.MathUtils.clamp(above * 0.04, 0.05, 6);
    const far = 3600;
    if (Math.abs(camera.near - near) / near > 0.05 || camera.far !== far) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

function Hi({ variant, mode }: SceneComponentProps) {
  const data = use(loadEverest());
  const rail = useRail(RAIL);
  const night = variant === "night";
  const look = LOOKS[variant];
  const drift = useRef(0);

  useLook({ exposure: look.exposure, tone: look.tone, seam: look.gold, grain: night ? 0.04 : 0.025, vignette: night ? 0.4 : 0.24 });
  usePostFX(
    // Threshold above the brightest baked snow: only the gold line, lamps and sun glints bloom.
    () => [new BloomEffect({ intensity: night ? 1.1 : 0.7, luminanceThreshold: night ? 0.55 : 1.35, luminanceSmoothing: 0.15, mipmapBlur: true, radius: 0.7 })],
    [night],
  );

  useFrame((_, dt) => {
    drift.current += Math.min(dt, 0.05);
  });
  // Parked (project pages): a slow bird's-eye drift over the range.
  const remap = useMemo(() => (mode === "parked" ? () => 0.3 + Math.sin(drift.current * 0.08) * 0.18 : undefined), [mode]);

  return (
    <>
      <RailCamera rail={rail} parallax={1.4} look={0.025} remap={remap} />
      <DepthRange data={data} />
      <Sky variant={variant} />
      <Terrain data={data} variant={variant} />
      <RouteLine data={data} variant={variant} />
      <Labels data={data} variant={variant} />
      <Clouds data={data} variant={variant} />
      <SummitPlume data={data} variant={variant} />
      <Glints variant={variant} />
      {night && <NightLights data={data} />}
      {mode === "parked" && <CoverPanel width={5.2} anchor="camera" offset={[2.3, -0.2, 11]} rotation={[0, -0.3, 0]} frame={night ? "#1c2c4c" : "#f6efe2"} glow={night ? 1.3 : 1.05} />}
    </>
  );
}

function Lo({ variant }: SceneComponentProps) {
  return (
    <LayerStack scene="everest" variant={variant} parallax={0.03} dolly={0.1}>
      <LoDrift variant={variant} />
    </LayerStack>
  );
}

export default function Scene(props: SceneComponentProps) {
  return props.quality === "lo" ? <Lo {...props} /> : <Hi {...props} />;
}
