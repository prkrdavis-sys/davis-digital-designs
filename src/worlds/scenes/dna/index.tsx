"use client";

import { use, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BloomEffect, ChromaticAberrationEffect, DepthOfFieldEffect } from "postprocessing";
import type { SceneComponentProps } from "@/worlds/types";
import { useLook, usePostFX, useSceneTime } from "@/components/three/engine/slot";
import { RailCamera, loadRail, useRail } from "@/components/three/engine/rails";
import { preloadWorldGLTF } from "@/components/three/engine/assets";
import { LayerStack } from "@/worlds/lo/LayerStack";
import { loadDna, sampleTrack, type DnaData } from "@/worlds/scenes/dna/model";
import { Helix, HELIX_PALETTES } from "@/worlds/scenes/dna/Helix";
import { Chromosome, Proteins } from "@/worlds/scenes/dna/Proteins";
import { Medium } from "@/worlds/scenes/dna/Medium";
import { Filaments } from "@/worlds/scenes/dna/Filaments";
import { Organelles } from "@/worlds/scenes/dna/Organelles";
import { LoBokeh } from "@/worlds/scenes/dna/LoBokeh";
import { CoverPanel } from "@/components/three/engine/CoverPanel";

const RAIL = "/worlds/dna/rails.json";
const PROTEIN_FILES = ["histone", "pcna", "helicase", "polymerase", "groel", "chromosome"];
const ORGANELLE_FILES = ["vesicle", "mitochondrion", "er"];

export function preload() {
  void loadDna();
  void loadRail(RAIL);
  for (const f of PROTEIN_FILES) preloadWorldGLTF("dna", `${f}.glb`);
  for (const f of ORGANELLE_FILES) preloadWorldGLTF("dna", `${f}.glb`);
}

/** Keeps the depth range tight around the subject: 0.02 nm up close, microns when pulled back. */
function DepthRange({ data }: { data: DnaData }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const time = useSceneTime();
  useFrame(() => {
    const chromo = sampleTrack(data.meta, "chromosome", time.s);
    const axisDist = Math.max(0.5, Math.hypot(camera.position.x, camera.position.z));
    const c = data.meta.chromosome?.center ?? [1000, -880, 370];
    const chromoDist = Math.hypot(camera.position.x - c[0], camera.position.y - c[1], camera.position.z - c[2]);
    const subject = chromo > 0.05 ? Math.min(axisDist, chromoDist * 0.5) : axisDist;
    const near = THREE.MathUtils.clamp(subject * 0.02, 0.02, 40);
    const far = Math.max(near * 8000, chromoDist * 2.5, 400);
    if (Math.abs(camera.near - near) / near > 0.05 || Math.abs(camera.far - far) / far > 0.05) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

function Hi({ variant, mode }: SceneComponentProps) {
  const data = use(loadDna());
  const rail = useRail(RAIL);
  const time = useSceneTime();
  const night = variant === "night";
  const fog = HELIX_PALETTES[variant].fog;
  const drift = useRef(0);

  useLook({ exposure: night ? 1.15 : 1.05, tone: night ? "agx" : "aces", seam: night ? "#6dffab" : "#5cc3d2", grain: night ? 0.045 : 0.03, vignette: night ? 0.45 : 0.24 });

  const focus = useMemo(() => new THREE.Vector3(), []);
  usePostFX(
    ({ camera }) => {
      const dof = new DepthOfFieldEffect(camera, { worldFocusRange: 5, bokehScale: night ? 3 : 2.2, resolutionScale: 0.5 });
      dof.target = focus;
      const bloom = new BloomEffect({ intensity: night ? 1.6 : 0.35, luminanceThreshold: night ? 0.35 : 0.85, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.8 });
      const ca = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0009, 0.0007), radialModulation: true, modulationOffset: 0.35 });
      return [dof, bloom, ca];
    },
    [night, focus],
  );

  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const fwd = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    drift.current += Math.min(dt, 0.05);
    const chromo = sampleTrack(data.meta, "chromosome", time.s);
    if (chromo > 0.5 && data.meta.chromosome) {
      focus.set(...data.meta.chromosome.center);
      return;
    }
    // Focus where the view ray passes closest to the helix axis, pulled 1 nm toward us (the near face).
    camera.getWorldDirection(fwd);
    const p = camera.position;
    const dxz = fwd.x * fwd.x + fwd.z * fwd.z;
    const t = dxz > 1e-4 ? Math.max(0.5, -(p.x * fwd.x + p.z * fwd.z) / dxz) : 4;
    focus.copy(p).addScaledVector(fwd, Math.max(0.5, t - 1));
  });

  const remap = useMemo(() => (mode === "parked" ? () => 0.42 + Math.sin(drift.current * 0.12) * 0.08 : undefined), [mode]);

  return (
    <>
      <RailCamera rail={rail} parallax={0.25} look={0.03} remap={remap} />
      <DepthRange data={data} />
      <hemisphereLight args={[night ? "#223355" : "#f5efff", night ? "#000000" : "#f2d8c8", night ? 0.2 : 1.1]} />
      <directionalLight position={[6, 8, 5]} intensity={night ? 0.2 : 2.2} color="#fff1e2" />
      <directionalLight position={[-6, -2, -8]} intensity={night ? 0.1 : 1.2} color="#cfdcff" />
      <Medium variant={variant} />
      <Filaments variant={variant} />
      <Organelles variant={variant} center={data.meta.chromosome?.center ?? [1000, -880, 370]} />
      <Helix data={data} variant={variant} />
      <Proteins data={data} variant={variant} fog={fog} />
      <Chromosome data={data} variant={variant} fog={fog} />
      {mode === "parked" && <CoverPanel width={1.6} anchor="camera" offset={[0.55, -0.1, 2.6]} rotation={[0, -0.32, 0]} frame={night ? "#1b3b66" : "#f3e7f7"} glow={night ? 1.35 : 1.05} />}
    </>
  );
}

function Lo({ variant }: SceneComponentProps) {
  return (
    <LayerStack scene="dna" variant={variant} parallax={0.05} dolly={0.12}>
      <LoBokeh variant={variant} />
    </LayerStack>
  );
}

export default function Scene(props: SceneComponentProps) {
  return props.quality === "lo" ? <Lo {...props} /> : <Hi {...props} />;
}
