"use client";

import { use, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { BloomEffect } from "postprocessing";
import type { SceneComponentProps, Variant } from "@/worlds/types";
import { useLook, usePostFX } from "@/components/three/engine/slot";
import { RailCamera, loadRail, useRail } from "@/components/three/engine/rails";
import { preloadWorldGLTF, useWorldGLTF } from "@/components/three/engine/assets";
import { CoverPanel } from "@/components/three/engine/CoverPanel";
import { LayerStack } from "@/worlds/lo/LayerStack";
import type { AtmosphereUniforms } from "@/worlds/scenes/dunes/atmosphere";
import { BASE, discDir, heightAt, lightDir, loadDunes, type DunesData } from "@/worlds/scenes/dunes/data";
import { PALETTES } from "@/worlds/scenes/dunes/palette";
import { Sky } from "@/worlds/scenes/dunes/Sky";
import { Terrain } from "@/worlds/scenes/dunes/Terrain";
import { Monoliths, panelLights } from "@/worlds/scenes/dunes/Monoliths";
import { Props } from "@/worlds/scenes/dunes/Props";
import { Footprints } from "@/worlds/scenes/dunes/Footprints";
import { BlowingSand } from "@/worlds/scenes/dunes/BlowingSand";
import { useSkyEnvironment } from "@/worlds/scenes/dunes/Environment";
import { HeatShimmerEffect } from "@/worlds/scenes/dunes/HeatShimmer";
import { LoSand } from "@/worlds/scenes/dunes/LoSand";

const RAIL = `${BASE}/rails.json`;
const skyUrl = (v: Variant) => `${BASE}/hi/sky-${v}.webp`;
/** Parked view: gliding slowly past the row, the covered slab on the right. */
const PARK_S = 2.46;
const PARK_SLAB = "m7";

export function preload() {
  void loadDunes();
  void loadRail(RAIL);
  for (const f of ["terrain.glb", "monoliths.glb", "props.glb"]) preloadWorldGLTF("dunes", f);
}

function useAtmosphere(data: DunesData, variant: Variant): AtmosphereUniforms {
  const sky = useTexture(skyUrl(variant)) as THREE.Texture;
  const pal = PALETTES[variant];
  useEffect(() => {
    sky.colorSpace = THREE.NoColorSpace;
    // Magnified almost everywhere; no mips also avoids a seam where the equirect wraps.
    sky.generateMipmaps = false;
    sky.minFilter = THREE.LinearFilter;
    sky.wrapS = THREE.RepeatWrapping;
    sky.needsUpdate = true;
  }, [sky]);
  return useMemo(
    () => ({
      uSky: { value: sky },
      uSkyStrength: { value: pal.skyStrength },
      uHazeTint: { value: new THREE.Vector3(...pal.hazeTint) },
      uFogDensity: { value: pal.fogDensity },
      uFogHeight: { value: pal.fogHeight },
      uSunDir: { value: lightDir(data) },
      uSunColor: { value: new THREE.Color(pal.sun) },
    }),
    [sky, pal, data],
  );
}

/** Near plane follows the height above the sand: crisp ripples at 4 m, no z-fighting from 130 m up. */
function DepthRange({ data }: { data: DunesData }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useFrame(() => {
    const above = Math.max(0.5, camera.position.y - heightAt(data, camera.position.x, camera.position.z));
    const near = THREE.MathUtils.clamp(above * 0.04, 0.12, 5);
    const far = 32000;
    if (Math.abs(camera.near - near) / near > 0.05 || camera.far !== far) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

function Hi({ variant, mode }: SceneComponentProps) {
  const data = use(loadDunes());
  const rail = useRail(RAIL);
  const night = variant === "night";
  const pal = PALETTES[variant];
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const atmosphere = useAtmosphere(data, variant);
  const disc = useMemo(() => ({ dir: discDir(data, night), color: pal.disc, strength: pal.discStrength, radius: pal.discRadius }), [data, night, pal]);
  const envMap = useSkyEnvironment(atmosphere, disc);
  const slabs = useWorldGLTF("dunes", "monoliths.glb");
  const panels = useMemo(() => panelLights(slabs, data), [slabs, data]);
  const sun = useMemo(() => lightDir(data).multiplyScalar(2000), [data]);
  const drift = useRef(0);
  const shimmer = useRef<HeatShimmerEffect | null>(null);

  useLook({ exposure: night ? 1.25 : 1.0, tone: "agx", seam: night ? "#8e98ff" : "#ffb85f", grain: night ? 0.04 : 0.028, vignette: night ? 0.42 : 0.3 });
  usePostFX(() => {
    const heat = new HeatShimmerEffect(night ? 0 : 1);
    shimmer.current = heat;
    const bloom = new BloomEffect({ intensity: night ? 1.15 : 0.55, luminanceThreshold: night ? 0.5 : 0.95, luminanceSmoothing: 0.3, mipmapBlur: true, radius: 0.75 });
    return [heat, bloom];
  }, [night]);

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    drift.current += d;
    const heat = shimmer.current;
    if (heat) {
      heat.time = drift.current;
      heat.track(camera);
    }
  });

  const remap = useMemo(() => (mode === "parked" ? () => PARK_S + Math.sin(drift.current * 0.1) * 0.025 : undefined), [mode]);
  const cover = useMemo(() => {
    const p = panels.find((x) => x.id === PARK_SLAB) ?? panels[0];
    if (!p) return null;
    return { position: p.pos.clone().addScaledVector(p.normal, 0.1).toArray() as [number, number, number], yaw: Math.atan2(p.normal.x, p.normal.z), width: p.width };
  }, [panels]);

  return (
    <>
      <RailCamera rail={rail} parallax={0.6} look={0.02} remap={remap} />
      <DepthRange data={data} />
      <directionalLight position={sun} intensity={pal.sunIntensity} color={pal.sun} />
      <Sky variant={variant} atmosphere={atmosphere} disc={disc} />
      <Terrain data={data} variant={variant} atmosphere={atmosphere} panels={panels} />
      <Monoliths data={data} variant={variant} atmosphere={atmosphere} envMap={envMap} />
      <Props atmosphere={atmosphere} envMap={envMap} night={night} />
      <Footprints data={data} variant={variant} />
      <BlowingSand data={data} variant={variant} atmosphere={atmosphere} />
      {mode === "parked" && cover && <CoverPanel width={cover.width} anchor="world" position={cover.position} rotation={[0, cover.yaw, 0]} frame={night ? "#2a2440" : "#f3dcb8"} glow={night ? 1.6 : 1.2} />}
    </>
  );
}

function Lo({ variant }: SceneComponentProps) {
  return (
    <LayerStack scene="dunes" variant={variant} parallax={0.04} dolly={0.14} focus={0.66}>
      <LoSand variant={variant} />
    </LayerStack>
  );
}

export default function Scene(props: SceneComponentProps) {
  return props.quality === "lo" ? <Lo {...props} /> : <Hi {...props} />;
}
