"use client";

import { use, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BloomEffect, DepthOfFieldEffect } from "postprocessing";
import type { SceneComponentProps, Variant } from "@/worlds/types";
import { useLook, usePostFX } from "@/components/three/engine/slot";
import { RailCamera, loadRail, useRail } from "@/components/three/engine/rails";
import { preloadWorldGLTF } from "@/components/three/engine/assets";
import { LayerStack } from "@/worlds/lo/LayerStack";
import { PanoEnvironment } from "@/worlds/scenes/doors/shared/panoEnv";
import { Dust } from "@/worlds/scenes/doors/shared/Dust";
import { LoGlints } from "@/worlds/scenes/doors/shared/LoGlints";
import { GradeEffect, type GradeOptions } from "@/worlds/scenes/doors/shared/Grade";
import { RAIL, loadLayout } from "@/worlds/scenes/monolith/layout";
import { Room } from "@/worlds/scenes/monolith/Room";
import { Monolith } from "@/worlds/scenes/monolith/Monolith";
import { Light } from "@/worlds/scenes/monolith/Light";
import { Spectrum } from "@/worlds/scenes/monolith/Spectrum";

export function preload() {
  void loadRail(RAIL);
  void loadLayout();
  preloadWorldGLTF("monolith", "facets.glb");
  preloadWorldGLTF("monolith", "room-day.glb");
  preloadWorldGLTF("monolith", "room-night.glb");
}

const LOOK: Record<Variant, { exposure: number; seam: string; grain: number; vignette: number; fog: [string, number]; hemi: [string, string, number]; grade: GradeOptions }> = {
  day: { exposure: 0.92, seam: "#d5dedc", grain: 0.028, vignette: 0.32, fog: ["#d5e0e2", 0.01], hemi: ["#e7eef2", "#c5cfcb", 0.28], grade: { contrast: 1.32, saturation: 1.02 } },
  night: { exposure: 1.2, seam: "#9eb0c8", grain: 0.04, vignette: 0.42, fog: ["#070b14", 0.014], hemi: ["#1a2744", "#07080c", 0.18], grade: { contrast: 1.18, saturation: 1.08 } },
};

function Hi({ variant, mode }: SceneComponentProps) {
  const layout = use(loadLayout());
  const rail = useRail(RAIL);
  const night = variant === "night";
  const look = LOOK[variant];
  const drift = useRef(0);
  const focus = useMemo(() => new THREE.Vector3(...layout.focus), [layout]);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;

  useFrame(() => {
    if (camera.near !== 0.08 || camera.far !== 80) {
      camera.near = 0.08;
      camera.far = 80;
      camera.updateProjectionMatrix();
    }
  });

  useLook({ exposure: look.exposure, tone: "agx", seam: look.seam, grain: look.grain, vignette: look.vignette });
  usePostFX(
    ({ camera: cam }) => {
      const dof = new DepthOfFieldEffect(cam, { worldFocusRange: 8, bokehScale: night ? 1.4 : 1.1, resolutionScale: 1 });
      dof.target = focus;
      const bloom = new BloomEffect({ intensity: night ? 0.85 : 0.16, luminanceThreshold: night ? 0.72 : 1.25, luminanceSmoothing: 0.3, mipmapBlur: true, radius: 0.55 });
      const grade = new GradeEffect(look.grade);
      return [dof, bloom, grade];
    },
    [night, focus, look.grade],
  );

  useFrame((_, dt) => {
    drift.current += Math.min(dt, 0.05);
  });

  const remap = useMemo(
    () => (mode === "parked" ? () => 0.08 + Math.sin(drift.current * 0.12) * 0.04 : (s: number) => s),
    [mode],
  );

  const slot = layout.slot;
  return (
    <>
      <RailCamera rail={rail} parallax={0.16} look={0.02} remap={remap} />
      <fogExp2 attach="fog" args={look.fog} />
      <PanoEnvironment url={`/worlds/monolith/pano-${variant}.webp`} intensity={night ? 0.55 : 0.85} />
      <hemisphereLight args={[look.hemi[0], look.hemi[1], look.hemi[2]]} />
      <Room variant={variant}>
        <Monolith layout={layout} night={night} mirror />
      </Room>
      <Monolith layout={layout} night={night} />
      <Light layout={layout} night={night} />
      <Spectrum layout={layout} night={night} />
      <Dust
        min={[-6.5, 0.15, -14]}
        max={[7.5, 4.6, 4]}
        count={night ? 500 : 700}
        colors={night ? ["#c5d4ff", "#ffe2c2"] : ["#f4f7fb", "#e7eef2"]}
        gain={night ? 1.6 : 1.15}
        opacity={night ? 0.55 : 0.4}
        size={0.028}
        rise={0.008}
        shafts={{ rects: [[slot.x0, slot.z0, slot.x1, slot.z1]], ceil: slot.ceil, sun: layout.sun }}
      />
    </>
  );
}

function Lo({ variant }: SceneComponentProps) {
  return (
    <LayerStack scene="monolith" variant={variant} parallax={0.035} dolly={0.08} focus={0.72}>
      <LoGlints colors={variant === "night" ? ["#d5e2ff", "#ffe6c8"] : ["#ffffff", "#d5e4ee"]} opacity={variant === "night" ? 0.7 : 0.45} />
    </LayerStack>
  );
}

export default function Scene(props: SceneComponentProps) {
  return props.quality === "lo" ? <Lo {...props} /> : <Hi {...props} />;
}
