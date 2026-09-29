"use client";

import { useEffect, useMemo, useRef } from "react";
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
import { Sky } from "@/worlds/scenes/planes/Sky";
import { Clouds, loadCloudAtlas } from "@/worlds/scenes/planes/Clouds";
import { Flock, PAPER_TEXTURES } from "@/worlds/scenes/planes/Flock";
import { Wisps } from "@/worlds/scenes/planes/Wisps";
import { LoPlanes } from "@/worlds/scenes/planes/LoPlanes";
import { GodRaysEffect, placeLight } from "@/worlds/scenes/planes/GodRays";
import { lightDir, lin, sky, WORLD } from "@/worlds/scenes/planes/shaders";

const RAIL = "/worlds/planes/rails.json";

export function preload() {
  void loadRail(RAIL);
  void loadCloudAtlas();
  preloadWorldGLTF("planes", "plane.glb");
  useTexture.preload(PAPER_TEXTURES);
}

const LIGHTS = {
  day: { hemi: ["#e4d2ff", "#f7c3b4", 1.25], key: 2.4 },
  night: { hemi: ["#5660a8", "#1d2150", 0.55], key: 0.9 },
} as const;

function Hi({ variant, mode }: SceneComponentProps) {
  const rail = useRail(RAIL);
  const night = variant === "night";
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const flow = useMemo(() => ({ offset: 0, speed: WORLD.clouds.flow }), []);
  const sun = useMemo(() => lightDir(variant), [variant]);
  const drift = useRef(0);

  useLook({ exposure: night ? 1.25 : 1.0, tone: "agx", seam: night ? "#a2acff" : "#ffa684", grain: night ? 0.04 : 0.028, vignette: night ? 0.42 : 0.22 });

  const rays = useRef<GodRaysEffect | null>(null);
  usePostFX(() => {
    const r = new GodRaysEffect({ strength: night ? 0.45 : 0.75, threshold: night ? 0.9 : 1.15, decay: 0.968, density: 0.9, tint: night ? lin("#c2ccff") : lin("#ffd6b0") });
    rays.current = r;
    const bloom = new BloomEffect({ intensity: night ? 1.25 : 0.6, luminanceThreshold: night ? 0.75 : 1.1, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.78 });
    return [r, bloom];
  }, [night]);

  useEffect(() => {
    camera.near = 0.05;
    camera.far = 12000;
    camera.updateProjectionMatrix();
  }, [camera]);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    drift.current += d;
    flow.offset += flow.speed * d;
    if (rays.current) placeLight(rays.current, state.camera, sun, night ? 0.45 : 0.75);
  });

  const remap = useMemo(() => (mode === "parked" ? () => 0.55 + Math.sin(drift.current * 0.1) * 0.06 : undefined), [mode]);
  const L = LIGHTS[variant];

  return (
    <>
      <RailCamera rail={rail} parallax={0.5} look={0.03} remap={remap} />
      <Sky variant={variant} />
      <hemisphereLight args={[L.hemi[0], L.hemi[1], L.hemi[2]]} />
      <directionalLight position={sun.clone().multiplyScalar(100)} color={sky(variant).light.color} intensity={L.key} />
      {false && <Clouds variant={variant} flow={flow} />}
      <Wisps variant={variant} flow={flow} />
      <Flock variant={variant} flow={flow} />
      {mode === "parked" && <CoverPanel width={1.5} anchor="camera" offset={[0.72, 0.04, 3.1]} rotation={[0, -0.34, 0]} frame={night ? "#2b2f66" : "#fff4ea"} glow={night ? 1.3 : 1.08} />}
    </>
  );
}

function Lo({ variant }: SceneComponentProps) {
  return (
    <LayerStack scene="planes" variant={variant} parallax={0.04} dolly={0.1}>
      <LoPlanes variant={variant} />
    </LayerStack>
  );
}

export default function Scene(props: SceneComponentProps) {
  return props.quality === "lo" ? <Lo {...props} /> : <Hi {...props} />;
}
