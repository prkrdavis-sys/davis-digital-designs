"use client";

import { use, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BloomEffect, ChromaticAberrationEffect, DepthOfFieldEffect } from "postprocessing";
import type { SceneComponentProps } from "@/worlds/types";
import { useLook, usePostFX, useSceneTime } from "@/components/three/engine/slot";
import { RailCamera, loadRail, useRail } from "@/components/three/engine/rails";
import { preloadWorldGLTF } from "@/components/three/engine/assets";
import { CoverPanel } from "@/components/three/engine/CoverPanel";
import { LayerStack } from "@/worlds/lo/LayerStack";
import { loadMeta, smooth, type PinballMeta } from "@/worlds/scenes/pinball/model";
import { createTableState, stepTable } from "@/worlds/scenes/pinball/state";
import { Balls, Table } from "@/worlds/scenes/pinball/Table";
import { Playfield } from "@/worlds/scenes/pinball/Playfield";
import { Room } from "@/worlds/scenes/pinball/Room";
import { LoGlints, Motes } from "@/worlds/scenes/pinball/Sparkles";

const RAIL = "/worlds/pinball/rails.json";
const PARKED_S = 4.56;
const TABLE_CENTER = new THREE.Vector3(0, 0.3, -6);

export function preload() {
  void loadMeta();
  void loadRail(RAIL);
  preloadWorldGLTF("pinball", "hardware.glb");
}

/** Advances the table (balls, flippers, bumpers) before anything renders this frame. */
function Stepper({ meta, state, parked }: { meta: PinballMeta; state: ReturnType<typeof createTableState>; parked: boolean }) {
  const time = useSceneTime();
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useLayoutEffect(() => {
    camera.near = 0.02;
    camera.far = 260;
    camera.updateProjectionMatrix();
  }, [camera]);
  useFrame((_, dt) => {
    stepTable(state, meta, parked ? 4.0 : Math.min(time.s, 4.0), dt, camera.position);
  });
  return null;
}

function Hi({ variant, mode }: SceneComponentProps) {
  const meta = use(loadMeta());
  const rail = useRail(RAIL);
  const night = variant === "night";
  const parked = mode === "parked";
  const state = useMemo(() => createTableState(meta), [meta]);
  const time = useSceneTime();
  const drift = useRef(0);

  useLook({ exposure: night ? 1.12 : 0.95, tone: "agx", seam: night ? "#ff4fa0" : "#3edcff", grain: night ? 0.04 : 0.025, vignette: night ? 0.42 : 0.22 });

  const focus = useMemo(() => new THREE.Vector3(), []);
  usePostFX(
    ({ camera }) => {
      const dof = new DepthOfFieldEffect(camera, { worldFocusRange: 2.2, bokehScale: night ? 3.2 : 2.0, resolutionScale: 0.5 });
      dof.target = focus;
      const bloom = new BloomEffect({ intensity: night ? 1.5 : 0.45, luminanceThreshold: night ? 0.55 : 1.4, luminanceSmoothing: 0.3, mipmapBlur: true, radius: 0.75 });
      const ca = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0007, 0.0005), radialModulation: true, modulationOffset: 0.4 });
      return [dof, bloom, ca];
    },
    [night, focus],
  );

  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const fwd = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    drift.current += Math.min(dt, 0.05);
    const s = time.s;
    if (parked) {
      focus.set(0, 4.3, -12.1);
      return;
    }
    // Focus on the hero ball while riding, then on the table as the camera cranes away.
    camera.getWorldDirection(fwd);
    const ahead = focus.copy(camera.position).addScaledVector(fwd, 2.2);
    const k = smooth(3.0, 3.5, s);
    const hero = state.focus;
    const heroDist = hero.distanceTo(camera.position);
    const onHero = heroDist < 4.5 ? 1 : 0;
    ahead.lerp(hero, onHero * (1 - k));
    ahead.lerp(TABLE_CENTER, k);
  });

  const remap = useMemo(() => (parked ? () => PARKED_S + Math.sin(drift.current * 0.12) * 0.1 : undefined), [parked]);

  return (
    <>
      <RailCamera rail={rail} parallax={0.06} look={0.025} remap={remap} />
      <Stepper meta={meta} state={state} parked={parked} />
      <hemisphereLight args={[night ? "#3b2a8a" : "#fff8f2", night ? "#05020a" : "#e5d4ee", night ? 0.25 : 0.7]} />
      <directionalLight position={[1.5, 9, -3]} intensity={night ? 0.15 : 1.4} color={night ? "#8a7cff" : "#fff3e8"} />
      {night && (
        <>
          <pointLight position={[-1.75, 0.5, -2.7]} color="#ffb070" intensity={1.4} distance={3} decay={2} />
          <pointLight position={[1.75, 0.5, -2.7]} color="#ffb070" intensity={1.4} distance={3} decay={2} />
          <pointLight position={[0, 1.2, -11.6]} color="#ff5c9d" intensity={2.5} distance={6} decay={2} />
        </>
      )}
      <Table variant={variant} meta={meta} state={state} mode={mode} />
      <Balls state={state} meta={meta} />
      <Room variant={variant} />
      <Motes variant={variant} />
      <Playfield variant={variant} meta={meta} state={state} />
      {parked && <CoverPanel width={3.3} anchor="world" position={[0.15, 4.3, -12.0]} rotation={[0, 0, 0]} frame={night ? "#2a1450" : "#fbe9f3"} glow={night ? 1.3 : 1.08} />}
    </>
  );
}

function Lo({ variant }: SceneComponentProps) {
  return (
    <LayerStack scene="pinball" variant={variant} parallax={0.04} dolly={0.1}>
      <LoGlints variant={variant} />
    </LayerStack>
  );
}

export default function Scene(props: SceneComponentProps) {
  return props.quality === "lo" ? <Lo {...props} /> : <Hi {...props} />;
}
