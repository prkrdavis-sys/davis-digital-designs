"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { BloomEffect, TiltShiftEffect } from "postprocessing";
import type { SceneComponentProps, Variant } from "@/worlds/types";
import { useLook, usePostFX, useSceneTime } from "@/components/three/engine/slot";
import { RailCamera, loadRail, useRail } from "@/components/three/engine/rails";
import { preloadWorldGLTF, useWorldGLTF } from "@/components/three/engine/assets";
import { CoverPanel } from "@/components/three/engine/CoverPanel";
import { LayerStack } from "@/worlds/lo/LayerStack";
import { LAYOUT, PALETTE, type DioramaLayout } from "@/worlds/scenes/diorama/layout";
import { FollowCamera, Sky } from "@/worlds/scenes/diorama/Sky";
import { Pond } from "@/worlds/scenes/diorama/Pond";
import { Dust } from "@/worlds/scenes/diorama/Dust";
import { LoSparkle } from "@/worlds/scenes/diorama/LoSparkle";
import { Minis, NightLamps, preloadMinis } from "@/worlds/scenes/diorama/Minis";

const RAIL = "/worlds/diorama/rails.json";

export function preload() {
  void loadRail(RAIL);
  preloadWorldGLTF("diorama", "terrain-day.glb");
  preloadMinis();
}

function focusAt(layout: DioramaLayout, s: number, out: THREE.Vector3) {
  const foci = layout.focus;
  let k = 0;
  while (k < foci.length - 1 && s > foci[k + 1].s) k++;
  const a = foci[k];
  const b = foci[Math.min(k + 1, foci.length - 1)];
  const t = a === b ? 0 : THREE.MathUtils.smoothstep(s, a.s + (b.s - a.s) * 0.4, b.s);
  return out.set(a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t);
}

function Table({ night }: { night: boolean }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.12, 0]} receiveShadow>
      <cylinderGeometry args={[8.4, 8.4, 0.22, 72]} />
      <meshPhysicalMaterial color={night ? "#2a1c18" : "#6b3f24"} roughness={0.52} sheen={0.15} sheenColor="#c49862" />
    </mesh>
  );
}

function Terrain({ variant }: { variant: Variant }) {
  const gltf = useWorldGLTF("diorama", `terrain-${variant}.glb`);
  useEffect(() => {
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.receiveShadow = true;
      const m = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (m && "envMapIntensity" in m) {
        m.envMapIntensity = variant === "night" ? 0.2 : 0.4;
      }
    });
  }, [gltf, variant]);
  return <primitive object={gltf.scene} />;
}

function Studio({ night }: { night: boolean }) {
  return (
    <Environment resolution={256} frames={1} environmentIntensity={night ? 0.45 : 0.95}>
      <Lightformer form="rect" intensity={night ? 0.8 : 3.4} color="#ffd2a8" position={[8, 9, 6]} scale={[12, 7, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={night ? 0.7 : 1.3} color="#c8d4ff" position={[-9, 4, 3]} scale={[7, 8, 1]} target={[0, 0.4, 0]} />
      <Lightformer form="rect" intensity={night ? 1.8 : 1.5} color={night ? "#ff5fb0" : "#ff8a7a"} position={[2, 1.2, -10]} scale={[14, 4, 1]} target={[0, 0.4, 0]} />
      <Lightformer form="ring" intensity={night ? 1.1 : 2.4} color="#fff4e8" position={[0, 11, 0]} scale={5} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={night ? 0.25 : 0.9} color="#ffe6c4" position={[0, -2.4, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[24, 24, 1]} />
    </Environment>
  );
}

function Hi({ variant, mode }: SceneComponentProps) {
  const rail = useRail(RAIL);
  const time = useSceneTime();
  const night = variant === "night";
  const pal = PALETTE[variant];
  const layout = LAYOUT;
  const drift = useRef(0);
  const tilt = useRef<TiltShiftEffect | null>(null);

  useLook({
    exposure: night ? 1.08 : 1.02,
    tone: night ? "agx" : "neutral",
    seam: pal.seam,
    grain: night ? 0.042 : 0.028,
    vignette: night ? 0.4 : 0.22,
  });

  const focus = useMemo(() => new THREE.Vector3(), []);
  usePostFX(
    () => {
      const ts = new TiltShiftEffect({
        focusArea: night ? 0.2 : 0.24,
        feather: 0.38,
        offset: 0.04,
        rotation: 0.04,
        resolutionScale: 0.5,
      });
      tilt.current = ts;
      const bloom = new BloomEffect({
        intensity: night ? 1.15 : 0.28,
        luminanceThreshold: night ? 0.38 : 0.88,
        luminanceSmoothing: 0.28,
        mipmapBlur: true,
        radius: 0.72,
      });
      return [ts, bloom];
    },
    [night],
  );

  useFrame((_, dt) => {
    drift.current += Math.min(dt, 0.05);
    const s = mode === "parked" ? 1.72 : time.s;
    focusAt(layout, s, focus);
    const fx = tilt.current;
    if (fx) {
      // Tighten the band while we are close on the garden; open it as we pull back.
      fx.focusArea = THREE.MathUtils.lerp(0.16, 0.34, THREE.MathUtils.smoothstep(s, 0.2, 1.8));
      fx.offset = THREE.MathUtils.lerp(0.06, 0.0, THREE.MathUtils.smoothstep(s, 0.4, 1.6));
    }
  });

  const remap = useMemo(() => (mode === "parked" ? () => 1.72 + Math.sin(drift.current * 0.09) * 0.06 : undefined), [mode]);

  return (
    <>
      <RailCamera rail={rail} parallax={0.22} look={0.03} remap={remap} />
      <fog attach="fog" args={[pal.fog, 18, 48]} />
      <Studio night={night} />
      <hemisphereLight args={[night ? "#2a2458" : "#ffd8c4", night ? "#080610" : "#c8b090", night ? 0.28 : 0.75]} />
      <directionalLight position={[7, 8, 6]} intensity={night ? 0.28 : 2.0} color={night ? "#aab6ff" : "#ffd2a0"} />
      <directionalLight position={[-6, 3, 4]} intensity={night ? 0.12 : 0.45} color="#c8d4ff" />
      <NightLamps plots={layout.plots} night={night} />
      <FollowCamera>
        <Sky stops={pal.sky} stars={pal.stars} />
      </FollowCamera>
      <Table night={night} />
      <Terrain variant={variant} />
      <Pond center={layout.pond.c} rx={layout.pond.rx} rz={layout.pond.rz} tint={pal.water} night={night} />
      <Minis plots={layout.plots} variant={variant} />
      <Dust night={night} count={night ? 320 : 240} />
      {mode === "parked" && (
        <CoverPanel width={1.5} anchor="camera" offset={[0.58, -0.06, 3.2]} rotation={[0, -0.28, 0]} frame={night ? "#241838" : "#fff1e4"} glow={night ? 1.28 : 1.06} />
      )}
    </>
  );
}

function Lo({ variant }: SceneComponentProps) {
  return (
    <LayerStack scene="diorama" variant={variant} parallax={0.04} dolly={0.13} focus={0.66}>
      <LoSparkle variant={variant} />
    </LayerStack>
  );
}

export default function Scene(props: SceneComponentProps) {
  return props.quality === "lo" ? <Lo {...props} /> : <Hi {...props} />;
}
