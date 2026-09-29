"use client";

import { use, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BloomEffect, DepthOfFieldEffect } from "postprocessing";
import type { SceneComponentProps, Variant } from "@/worlds/types";
import { useLook, usePostFX } from "@/components/three/engine/slot";
import { RailCamera, loadRail, useRail } from "@/components/three/engine/rails";
import { preloadWorldGLTF } from "@/components/three/engine/assets";
import { CoverPanel } from "@/components/three/engine/CoverPanel";
import { LayerStack } from "@/worlds/lo/LayerStack";
import { OFFSET, RAIL, loadCovers, loadLayout, type MuseumLayout } from "@/worlds/scenes/museum/layout";
import { Hall } from "@/worlds/scenes/museum/Hall";
import { Gallery } from "@/worlds/scenes/museum/Gallery";
import { Shafts } from "@/worlds/scenes/museum/Shafts";
import { PanoEnvironment } from "@/worlds/scenes/doors/shared/panoEnv";
import { Dust } from "@/worlds/scenes/doors/shared/Dust";
import { LoGlints } from "@/worlds/scenes/doors/shared/LoGlints";

export function preload() {
  void loadRail(RAIL);
  void loadLayout();
  void loadCovers();
  preloadWorldGLTF("museum", "gallery.glb");
}

const LOOK: Record<Variant, { exposure: number; seam: string; grain: number; vignette: number; fog: [string, number]; sun: [string, number]; hemi: [string, string, number]; sky: string; far: string }> = {
  day: { exposure: 1.0, seam: "#e7c98a", grain: 0.03, vignette: 0.26, fog: ["#efe3d4", 0.011], sun: ["#fff0dc", 3.2], hemi: ["#fff4e6", "#d9c7bb", 0.45], sky: "#e6efff", far: "#fff1dc" },
  night: { exposure: 1.1, seam: "#ffd27a", grain: 0.045, vignette: 0.5, fog: ["#07060d", 0.02], sun: ["#9fb4ff", 0.5], hemi: ["#1c2240", "#060508", 0.18], sky: "#0b1336", far: "#2a2448" },
};

const DUST_MIN: [number, number, number] = [-6.5, 0.3, -40];
const DUST_MAX: [number, number, number] = [6.5, 9.5, 8];

/** Keeps the camera near plane tight for the close glide past the frames. */
function Clip() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useFrame(() => {
    if (camera.near !== 0.05 || camera.far !== 400) {
      camera.near = 0.05;
      camera.far = 400;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

/** Soft light beyond the far arch (the next gallery) and daylight above the skylights. */
function Beyond({ variant }: { variant: Variant }) {
  const look = LOOK[variant];
  const far = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(look.far).multiplyScalar(variant === "day" ? 2.6 : 1.2), toneMapped: false, fog: false }), [look.far, variant]);
  const sky = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(look.sky).multiplyScalar(variant === "day" ? 2.2 : 0.6), toneMapped: false, fog: false, side: THREE.DoubleSide }), [look.sky, variant]);
  return (
    <>
      <mesh material={far} position={[0, 4, -43]}>
        <planeGeometry args={[16, 14]} />
      </mesh>
      <mesh material={sky} position={[0, 16, -15]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[30, 70]} />
      </mesh>
    </>
  );
}

function shaftRects(layout: MuseumLayout): { rects: [number, number, number, number][]; ceil: number } {
  const rects = layout.shafts.map((s) => {
    const xs = s.top.map((p) => p[0]);
    const zs = s.top.map((p) => p[2]);
    return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] as [number, number, number, number];
  });
  return { rects, ceil: layout.shafts[0]?.top[0][1] ?? 9.9 };
}

function Hi({ variant, mode }: SceneComponentProps) {
  const layout = use(loadLayout());
  const covers = use(loadCovers());
  const rail = useRail(RAIL);
  const night = variant === "night";
  const look = LOOK[variant];
  const drift = useRef(0);
  const fog = useMemo(() => new THREE.FogExp2(look.fog[0], look.fog[1]), [look.fog]);
  const focus = useMemo(() => new THREE.Vector3(...layout.art[0].center), [layout]);
  const shafts = useMemo(() => ({ ...shaftRects(layout), sun: layout.sun[variant] }), [layout, variant]);
  const camera = useThree((s) => s.camera);
  const centers = useMemo(() => layout.art.map((a) => new THREE.Vector3(...a.center)), [layout]);
  const tmp = useMemo(() => ({ fwd: new THREE.Vector3(), d: new THREE.Vector3() }), []);

  useLook({ exposure: look.exposure, tone: "agx", seam: look.seam, grain: look.grain, vignette: look.vignette });
  usePostFX(
    ({ camera: cam }) => {
      const dof = new DepthOfFieldEffect(cam, { worldFocusRange: 6, bokehScale: night ? 2.6 : 2.0, resolutionScale: 0.5 });
      dof.target = focus;
      const bloom = new BloomEffect({ intensity: night ? 1.1 : 0.5, luminanceThreshold: night ? 0.6 : 0.9, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.7 });
      return [dof, bloom];
    },
    [night, focus],
  );

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    drift.current += d;
    // Focus on the artwork closest to the centre of view.
    camera.getWorldDirection(tmp.fwd);
    let best = 0;
    let bestScore = -Infinity;
    centers.forEach((c, i) => {
      tmp.d.copy(c).sub(camera.position);
      const dist = tmp.d.length();
      const score = tmp.d.normalize().dot(tmp.fwd) - dist * 0.02;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    focus.lerp(centers[best], 1 - Math.exp(-d * 3));
  });

  const remap = useMemo(() => (mode === "parked" ? () => OFFSET + 0.42 + Math.sin(drift.current * 0.1) * 0.05 : (s: number) => s + OFFSET), [mode]);

  return (
    <>
      <RailCamera rail={rail} parallax={0.2} look={0.028} remap={remap} />
      <Clip />
      <primitive object={fog} attach="fog" />
      <PanoEnvironment url={`/worlds/museum/pano-${variant}.webp`} intensity={night ? 0.5 : 0.9} />
      <hemisphereLight args={[look.hemi[0], look.hemi[1], look.hemi[2]]} />
      <directionalLight position={[layout.sun[variant][0] * 50, layout.sun[variant][1] * 50, layout.sun[variant][2] * 50]} intensity={look.sun[1]} color={look.sun[0]} />
      <Beyond variant={variant} />
      <Hall variant={variant}>
        <Gallery variant={variant} layout={layout} covers={covers} fog={fog} mirror />
        <Shafts layout={layout} variant={variant} />
        <Beyond variant={variant} />
      </Hall>
      <Gallery variant={variant} layout={layout} covers={covers} fog={fog} />
      <Shafts layout={layout} variant={variant} />
      <Dust min={DUST_MIN} max={DUST_MAX} count={night ? 900 : 1400} colors={night ? ["#c9d6ff", "#ffe6b8"] : ["#fff4dc", "#ffe0b0"]} gain={night ? 1.8 : 2.2} opacity={night ? 0.55 : 0.7} size={0.03} rise={0.01} shafts={shafts} />
      {mode === "parked" && <CoverPanel width={2.0} anchor="world" position={[3.4, 2.3, -6.5]} rotation={[0, -1.2, 0]} frame={night ? "#3a2d1c" : "#f7f1e6"} glow={night ? 1.25 : 1.05} />}
    </>
  );
}

function Lo({ variant }: SceneComponentProps) {
  return (
    <LayerStack scene="museum" variant={variant} parallax={0.035} dolly={0.1} focus={0.64}>
      <LoGlints colors={variant === "night" ? ["#ffe2a8", "#c9d6ff"] : ["#fff4dc", "#ffe0b0"]} opacity={variant === "night" ? 0.7 : 0.55} rise={0.06} />
    </LayerStack>
  );
}

export default function Scene(props: SceneComponentProps) {
  return props.quality === "lo" ? <Lo {...props} /> : <Hi {...props} />;
}
