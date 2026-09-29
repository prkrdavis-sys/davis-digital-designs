"use client";

import { use, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BloomEffect, DepthOfFieldEffect } from "postprocessing";
import type { SceneComponentProps, Variant } from "@/worlds/types";
import { useLook, usePostFX, useSceneTime } from "@/components/three/engine/slot";
import { RailCamera, loadRail, useRail } from "@/components/three/engine/rails";
import { preloadWorldGLTF } from "@/components/three/engine/assets";
import { CoverPanel } from "@/components/three/engine/CoverPanel";
import { LayerStack } from "@/worlds/lo/LayerStack";
import { bgUrl, envUrl, loadHDR, loadMeta, loadSparkle, sampleVec3, type SnowMeta } from "@/worlds/scenes/snowglobe/data";
import { World, type WorldHandles } from "@/worlds/scenes/snowglobe/World";
import { Glass } from "@/worlds/scenes/snowglobe/Glass";
import { Snow } from "@/worlds/scenes/snowglobe/Snow";
import { Sparkle } from "@/worlds/scenes/snowglobe/Sparkle";
import { Aurora } from "@/worlds/scenes/snowglobe/Aurora";
import { Motes } from "@/worlds/scenes/snowglobe/Motes";
import { LoSnow } from "@/worlds/scenes/snowglobe/LoSnow";
import { GlassEffect } from "@/worlds/scenes/snowglobe/GlassEffect";

const RAIL = "/worlds/snowglobe/rails.json";

export function preload() {
  void loadMeta();
  void loadRail(RAIL);
  void loadSparkle();
  preloadWorldGLTF("snowglobe", "desk.glb");
  preloadWorldGLTF("snowglobe", "village.glb");
}

/** Room HDR as backdrop (the Cycles world, seen from the globe) and the desk as reflections. */
function Environment({ variant }: { variant: Variant }) {
  const env = use(loadHDR(envUrl(variant)));
  const bg = use(loadHDR(bgUrl(variant)));
  const scene = useThree((s) => s.scene);
  useLayoutEffect(() => {
    scene.environment = env;
    scene.background = bg;
    scene.backgroundIntensity = 1;
    scene.environmentIntensity = 1;
    return () => {
      scene.environment = null;
      scene.background = null;
    };
  }, [scene, env, bg]);
  return null;
}

/**
 * Per-frame camera bookkeeping: tight near/far for the miniature, how far we
 * are from the glass wall (drives the refraction pass), inside-the-water fog.
 */
function useGlobeState(meta: SnowMeta) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const scene = useThree((s) => s.scene);
  const center = useMemo(() => new THREE.Vector3(...meta.globe.center), [meta]);
  const state = useMemo(() => ({ dist: 10, inside: 0, crossing: 0 }), []);
  const fog = useMemo(() => new THREE.FogExp2("#cfe6f5", 0), []);
  useLayoutEffect(() => {
    scene.fog = fog;
    return () => {
      scene.fog = null;
    };
  }, [scene, fog]);
  useFrame((_, dt) => {
    const d = camera.position.distanceTo(center);
    state.dist = d;
    const gap = Math.abs(d - meta.globe.rOut);
    state.crossing = 1 - THREE.MathUtils.smoothstep(gap, 0.02, 0.3);
    const inside = d < meta.globe.rIn ? 1 : 0;
    state.inside += (inside - state.inside) * (1 - Math.exp(-Math.min(dt, 0.05) * 6));
    fog.density = state.inside * 0.22;
    const near = inside ? 0.002 : THREE.MathUtils.clamp(gap * 0.25, 0.004, 0.2);
    const far = inside ? 80 : 200;
    if (Math.abs(camera.near - near) / near > 0.05 || camera.far !== far) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  });
  return state;
}

function Hi({ variant, mode }: SceneComponentProps) {
  const meta = use(loadMeta());
  const rail = useRail(RAIL);
  const time = useSceneTime();
  const night = variant === "night";
  const parked = mode === "parked";
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const globe = useGlobeState(meta);

  useLook({ exposure: night ? 1.05 : 1.0, tone: "aces", seam: night ? "#86e8cc" : "#a9dcff", grain: night ? 0.04 : 0.028, vignette: night ? 0.42 : 0.26 });

  const focusTarget = useMemo(() => new THREE.Vector3(), []);
  const focus = useMemo(() => ({ distance: 5 }), []);
  const fx = useRef<{ glass: GlassEffect; dof: DepthOfFieldEffect } | null>(null);
  usePostFX(
    ({ camera: cam }) => {
      const dof = new DepthOfFieldEffect(cam, { focusRange: 2, bokehScale: 2.5, resolutionScale: 0.5 });
      dof.target = focusTarget;
      const bloom = new BloomEffect({ intensity: night ? 1.3 : 0.45, luminanceThreshold: night ? 0.55 : 0.9, luminanceSmoothing: 0.3, mipmapBlur: true, radius: 0.75 });
      const glass = new GlassEffect();
      fx.current = { glass, dof };
      // The UV-warping glass pass must come first in the chain.
      return [glass, dof, bloom];
    },
    [night, focusTarget],
  );

  const drift = useRef(0);
  useFrame((state, dt) => {
    drift.current += Math.min(dt, 0.05);
    const s = parked ? parkedS(drift.current) : time.s;
    sampleVec3(meta.focus, s, focusTarget);
    focus.distance = camera.position.distanceTo(focusTarget);
    const f = fx.current;
    if (f) {
      // Outside: the whole globe sits in the focus band and the room melts into bokeh.
      // Inside: a shallow miniature band, like a macro lens on a model village.
      const inside = globe.inside;
      f.dof.cocMaterial.focusRange = THREE.MathUtils.lerp(Math.max(1.2, focus.distance * 0.28), Math.max(0.05, focus.distance * 0.35), inside);
      f.dof.bokehScale = THREE.MathUtils.lerp(3.2, 2.2, inside);
      f.glass.strength = globe.crossing;
      f.glass.time = state.clock.elapsedTime;
    }
  });

  const remap = useMemo(() => (parked ? () => parkedS(drift.current) : undefined), [parked]);
  const [handles, setHandles] = useState<WorldHandles | null>(null);
  const onReady = useCallback((h: WorldHandles) => setHandles(h), []);
  const bb = handles?.billboard;

  return (
    <>
      <RailCamera rail={rail} parallax={0.06} look={0.02} remap={remap} />
      <Environment variant={variant} />
      <World meta={meta} variant={variant} hideBillboard={parked} onReady={onReady} />
      <Glass meta={meta} variant={variant} />
      <Snow meta={meta} variant={variant} focus={focus} />
      <Sparkle variant={variant} />
      <Motes variant={variant} />
      {night && <Aurora meta={meta} />}
      {parked && bb && (
        <CoverPanel
          width={bb.width * 1.02}
          anchor="world"
          position={[bb.center.x + bb.normal.x * 0.004, bb.center.y, bb.center.z + bb.normal.z * 0.004]}
          rotation={[0, Math.atan2(bb.normal.x, bb.normal.z), 0]}
          frame={night ? "#2b3350" : "#f4efe6"}
          glow={night ? 1.5 : 1.15}
          depth={0.03}
        />
      )}
    </>
  );
}

/** Parked (project pages): hover in the square facing the big screen, breathing slightly. */
function parkedS(t: number) {
  return 1.96 + Math.sin(t * 0.11) * 0.04;
}

function Lo({ variant }: SceneComponentProps) {
  return (
    <LayerStack scene="snowglobe" variant={variant} parallax={0.04} dolly={0.1}>
      <LoSnow variant={variant} />
    </LayerStack>
  );
}

export default function Scene(props: SceneComponentProps) {
  return props.quality === "lo" ? <Lo {...props} /> : <Hi {...props} />;
}
