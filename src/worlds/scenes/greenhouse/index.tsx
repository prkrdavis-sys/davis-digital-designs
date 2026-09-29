"use client";

import { use, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BloomEffect, ChromaticAberrationEffect } from "postprocessing";
import type { SceneComponentProps } from "@/worlds/types";
import { useLook, usePostFX } from "@/components/three/engine/slot";
import { RailCamera, loadRail, sampleRail, useRail } from "@/components/three/engine/rails";
import { preloadWorldGLTF } from "@/components/three/engine/assets";
import { CoverPanel } from "@/components/three/engine/CoverPanel";
import { LayerStack } from "@/worlds/lo/LayerStack";
import { loadMeta } from "@/worlds/scenes/greenhouse/data";
import { Architecture } from "@/worlds/scenes/greenhouse/Architecture";
import { Foliage } from "@/worlds/scenes/greenhouse/Foliage";
import { Atmosphere } from "@/worlds/scenes/greenhouse/Atmosphere";
import { Panels } from "@/worlds/scenes/greenhouse/Panels";
import { NightLights } from "@/worlds/scenes/greenhouse/NightLights";
import { LoMotes } from "@/worlds/scenes/greenhouse/LoMotes";

const RAIL = "/worlds/greenhouse/rails.json";

export function preload() {
  void loadMeta();
  void loadRail(RAIL);
  preloadWorldGLTF("greenhouse", "arch.glb");
  preloadWorldGLTF("greenhouse", "live.glb");
}

const LIGHT = {
  day: { sun: "#ffc98f", sunI: 2.6, hemiSky: "#cfe2ff", hemiGround: "#b98a5a", hemiI: 0.55, fog: "#e9c79a", fogD: 0.034, exposure: 1.0, bloom: 0.55, threshold: 0.9 },
  night: { sun: "#8aa6ff", sunI: 0.35, hemiSky: "#26345c", hemiGround: "#1a1410", hemiI: 0.28, fog: "#1a2340", fogD: 0.03, exposure: 1.15, bloom: 1.2, threshold: 0.6 },
};

function Hi({ variant, mode }: SceneComponentProps) {
  const meta = use(loadMeta());
  const rail = useRail(RAIL);
  const night = variant === "night";
  const L = LIGHT[variant];
  const sky = meta[variant];
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const drift = useRef(0);

  useLook({ exposure: L.exposure, tone: "agx", seam: night ? "#f3d58f" : "#8fd08a", grain: night ? 0.04 : 0.028, vignette: night ? 0.42 : 0.26 });
  usePostFX(
    () => [
      new BloomEffect({ intensity: L.bloom, luminanceThreshold: L.threshold, luminanceSmoothing: 0.3, mipmapBlur: true, radius: 0.78 }),
      new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0006, 0.0005), radialModulation: true, modulationOffset: 0.4 }),
    ],
    [L],
  );

  const lightDir = useMemo(() => new THREE.Vector3(...sky.lightDir).normalize(), [sky]);
  const lightColor = useMemo(() => new THREE.Color(L.sun), [L]);
  const atmos = useMemo(() => ({ fogColor: new THREE.Color(L.fog), fogDensity: L.fogD }), [L]);

  useLayoutEffect(() => {
    camera.near = 0.05;
    camera.far = 450;
    camera.updateProjectionMatrix();
  }, [camera]);

  useFrame((_, dt) => {
    drift.current += Math.min(dt, 0.05);
  });

  const parkedS = meta.parked.s;
  const remap = useMemo(() => (mode === "parked" ? () => parkedS + Math.sin(drift.current * 0.1) * 0.12 : undefined), [mode, parkedS]);

  // Parked: the cover leans on the bench under the dome, turned toward the camera.
  const parkedPanel = useMemo(() => {
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    sampleRail(rail, parkedS, p, q);
    const [x, y, z] = meta.parked.panel.p;
    return { position: [x, y, z] as [number, number, number], rotation: [-0.12, Math.atan2(p.x - x, p.z - z), 0] as [number, number, number] };
  }, [rail, parkedS, meta]);

  return (
    <>
      <RailCamera rail={rail} parallax={0.18} look={0.03} remap={remap} />
      <hemisphereLight args={[L.hemiSky, L.hemiGround, L.hemiI]} />
      <directionalLight position={[lightDir.x * 30, lightDir.y * 30, lightDir.z * 30]} intensity={L.sunI} color={L.sun} />
      <Architecture meta={meta} variant={variant} atmos={atmos} lightDir={lightDir} lightColor={lightColor} />
      <Foliage variant={variant} lightDir={lightDir} />
      <NightLights bulbs={meta.bulbs} flames={meta.flames} variant={variant} />
      <Atmosphere variant={variant} atmos={atmos} beams={sky.beams} lightDir={lightDir} lightColor={lightColor} />
      {mode === "tour" && <Panels panels={meta.panels} variant={variant} />}
      {mode === "parked" && <CoverPanel width={1.15} anchor="world" position={parkedPanel.position} rotation={parkedPanel.rotation} frame={night ? "#2b3552" : "#f4efe4"} glow={night ? 1.3 : 1.05} />}
    </>
  );
}

function Lo({ variant }: SceneComponentProps) {
  return (
    <LayerStack scene="greenhouse" variant={variant} parallax={0.04} dolly={0.12}>
      <LoMotes variant={variant} />
    </LayerStack>
  );
}

export default function Scene(props: SceneComponentProps) {
  return props.quality === "lo" ? <Lo {...props} /> : <Hi {...props} />;
}
