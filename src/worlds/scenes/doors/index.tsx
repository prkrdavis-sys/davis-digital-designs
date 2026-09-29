"use client";

import { use, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BloomEffect, DepthOfFieldEffect } from "postprocessing";
import type { SceneComponentProps, Variant } from "@/worlds/types";
import { useLook, usePostFX } from "@/components/three/engine/slot";
import { RailCamera, loadRail, useRail } from "@/components/three/engine/rails";
import { preloadWorldGLTF } from "@/components/three/engine/assets";
import { CoverPanel } from "@/components/three/engine/CoverPanel";
import { LayerStack } from "@/worlds/lo/LayerStack";
import { OFFSET, RAIL, loadLayout, type DoorsLayout } from "@/worlds/scenes/doors/layout";
import { Corridor } from "@/worlds/scenes/doors/Corridor";
import { DoorController, Doors, createDoorFx } from "@/worlds/scenes/doors/Doors";
import { Spill } from "@/worlds/scenes/doors/Spill";
import { Sky } from "@/worlds/scenes/doors/Sky";
import { CameraFx } from "@/worlds/scenes/doors/CameraFx";
import { PanoEnvironment } from "@/worlds/scenes/doors/shared/panoEnv";
import { Dust } from "@/worlds/scenes/doors/shared/Dust";
import { LoGlints } from "@/worlds/scenes/doors/shared/LoGlints";

export function preload() {
  void loadRail(RAIL);
  void loadLayout();
  preloadWorldGLTF("doors", "arches.glb");
}

const LOOK: Record<Variant, { exposure: number; seam: string; grain: number; vignette: number; fog: [string, number]; sun: [string, number]; hemi: [string, string, number] }> = {
  day: { exposure: 1.0, seam: "#ffb6d3", grain: 0.025, vignette: 0.22, fog: ["#f3dcea", 0.014], sun: ["#fff0dc", 5.0], hemi: ["#fbe8ff", "#f5d7dc", 0.6] },
  night: { exposure: 1.12, seam: "#b9a4ff", grain: 0.04, vignette: 0.42, fog: ["#0b0e2a", 0.022], sun: ["#bcd0ff", 0.7], hemi: ["#2a3470", "#0a0a18", 0.35] },
};

const DUST_BOX = { min: [-8, 0.2, -40] as [number, number, number], max: [9, 7, 16] as [number, number, number] };
const DUST_COLORS: Record<Variant, [string, string]> = { day: ["#fff3dc", "#ffd6ea"], night: ["#b8c8ff", "#ffe2a8"] };

function Hi({ variant, mode }: SceneComponentProps) {
  const layout = use(loadLayout());
  const rail = useRail(RAIL);
  const night = variant === "night";
  const look = LOOK[variant];
  const fx = useMemo(() => createDoorFx(layout.doors.length), [layout]);
  const focus = useMemo(() => new THREE.Vector3(...layout.doors[1].center), [layout]);
  const drift = useRef(0);

  useLook({ exposure: look.exposure, tone: "agx", seam: look.seam, grain: look.grain, vignette: look.vignette });
  usePostFX(
    ({ camera }) => {
      const dof = new DepthOfFieldEffect(camera, { worldFocusRange: 7, bokehScale: night ? 2.4 : 1.8, resolutionScale: 0.5 });
      dof.target = focus;
      const bloom = new BloomEffect({ intensity: night ? 1.25 : 0.55, luminanceThreshold: night ? 0.55 : 0.92, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.75 });
      return [dof, bloom];
    },
    [night, focus],
  );

  useFrame((_, dt) => {
    drift.current += Math.min(dt, 0.05);
  });
  const remap = useMemo(() => (mode === "parked" ? () => OFFSET + 0.55 + Math.sin(drift.current * 0.1) * 0.06 : (s: number) => s + OFFSET), [mode]);

  return (
    <>
      <RailCamera rail={rail} parallax={0.22} look={0.03} remap={remap} />
      <DoorController layout={layout} fx={fx} variant={variant} />
      <CameraFx layout={layout} fx={fx} focus={focus} />
      <PanoEnvironment url={`/worlds/doors/pano-${variant}.webp`} intensity={night ? 0.6 : 1} />
      <fogExp2 attach="fog" args={[look.fog[0], look.fog[1]]} />
      <hemisphereLight args={[look.hemi[0], look.hemi[1], look.hemi[2]]} />
      <directionalLight position={night ? [-30, 52, -80] : [-78, 55, 30]} intensity={look.sun[1]} color={look.sun[0]} />
      <Sky variant={variant} />
      <Corridor variant={variant} layout={layout} fx={fx} />
      <Doors layout={layout} fx={fx} variant={variant} />
      <group scale={[1, -1, 1]}>
        <Doors layout={layout} fx={fx} variant={variant} mirror />
      </group>
      <Spill layout={layout} fx={fx} variant={variant} />
      <Dust min={DUST_BOX.min} max={DUST_BOX.max} count={night ? 700 : 900} colors={DUST_COLORS[variant]} gain={night ? 2.2 : 1.4} opacity={night ? 0.65 : 0.45} size={night ? 0.05 : 0.035} rise={0.015} />
      {mode === "parked" && <ParkedCover layout={layout} night={night} />}
    </>
  );
}

/** Project pages: the cover hangs in front of the Play door, lit by the portal behind it. */
function ParkedCover({ layout, night }: { layout: DoorsLayout; night: boolean }) {
  const door = layout.doors[2];
  const pos = useMemo(() => {
    const p = new THREE.Vector3(...door.center).addScaledVector(new THREE.Vector3(...door.into), -1.6);
    return [p.x, p.y + 0.2, p.z] as [number, number, number];
  }, [door]);
  const yaw = Math.atan2(-door.into[0], -door.into[2]);
  return <CoverPanel width={2.2} anchor="world" position={pos} rotation={[0, yaw, 0]} frame={night ? "#2a2058" : "#fff4f8"} glow={night ? 1.3 : 1.05} />;
}

function Lo({ variant }: SceneComponentProps) {
  return (
    <LayerStack scene="doors" variant={variant} parallax={0.04} dolly={0.1} focus={0.62}>
      <LoGlints colors={variant === "night" ? ["#c9b6ff", "#ffe2a8"] : ["#ffffff", "#ffd3ec"]} opacity={variant === "night" ? 0.85 : 0.6} />
    </LayerStack>
  );
}

export default function Scene(props: SceneComponentProps) {
  return props.quality === "lo" ? <Lo {...props} /> : <Hi {...props} />;
}
