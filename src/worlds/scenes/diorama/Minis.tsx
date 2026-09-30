"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { KTX2Loader, type GLTFLoader } from "three-stdlib";
import type { Variant } from "@/worlds/types";
import { MINI_IDS, type MiniId, type Plot } from "@/worlds/scenes/diorama/layout";

type Probe = "pending" | "missing" | "ready";

const probes = new Map<string, Promise<boolean>>();

function headOk(url: string): Promise<boolean> {
  let p = probes.get(url);
  if (!p) {
    p = fetch(url, { method: "HEAD" })
      .then((r) => r.ok)
      .catch(() => false);
    probes.set(url, p);
  }
  return p;
}

function useMiniProbe(id: MiniId): Probe {
  const url = `/worlds/${id}/lo/mini.glb`;
  const [state, setState] = useState<Probe>("pending");
  useEffect(() => {
    let cancelled = false;
    void headOk(url).then((ok) => {
      if (!cancelled) setState(ok ? "ready" : "missing");
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state;
}

function Placeholder({ plot, variant }: { plot: Plot; variant: Variant }) {
  const night = variant === "night";
  const color = night ? plot.night : plot.day;
  const body = useMemo(() => {
    switch (plot.kind) {
      case "star":
        return <icosahedronGeometry args={[0.28, 1]} />;
      case "arch":
        return <torusGeometry args={[0.22, 0.055, 8, 20]} />;
      case "frame":
        return <boxGeometry args={[0.38, 0.48, 0.06]} />;
      case "sphere":
        return <sphereGeometry args={[0.26, 20, 12]} />;
      case "glass":
        return <boxGeometry args={[0.32, 0.38, 0.22]} />;
      case "helix":
        return <torusKnotGeometry args={[0.16, 0.04, 64, 8, 2, 3]} />;
      case "table":
        return <boxGeometry args={[0.42, 0.08, 0.24]} />;
      case "globe":
        return <sphereGeometry args={[0.22, 18, 12]} />;
      case "peak":
        return <coneGeometry args={[0.28, 0.62, 8]} />;
      case "cone":
        return <coneGeometry args={[0.3, 0.28, 12]} />;
      case "plane":
        return <boxGeometry args={[0.42, 0.03, 0.18]} />;
      default: {
        const _never: never = plot.kind;
        throw new Error(`unknown placeholder kind: ${String(_never)}`);
      }
    }
  }, [plot.kind]);

  const y = plot.kind === "arch" || plot.kind === "helix" ? 0.28 : 0.42;
  const rot: [number, number, number] = plot.kind === "arch" ? [Math.PI / 2, 0, 0] : [0, 0, 0];

  return (
    <group>
      <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.3, 0.32, 0.08, 20]} />
        <meshPhysicalMaterial color={night ? "#6a5a62" : "#e8d4c4"} roughness={0.62} sheen={0.3} sheenColor="#fff0e4" />
      </mesh>
      <mesh position={[0, y, 0]} rotation={rot} castShadow>
        {body}
        <meshPhysicalMaterial
          color={color}
          roughness={plot.kind === "glass" || plot.kind === "globe" ? 0.04 : 0.16}
          metalness={0.08}
          clearcoat={0.75}
          clearcoatRoughness={0.08}
          transmission={plot.kind === "glass" || plot.kind === "globe" ? 0.85 : 0}
          ior={1.45}
          thickness={0.25}
          emissive={night ? plot.glow : "#000000"}
          emissiveIntensity={night ? 1.4 : 0}
        />
      </mesh>
    </group>
  );
}

function MiniGltf({ url }: { url: string }) {
  const gl = useThree((s) => s.gl);
  const gltf = useGLTF(url, false, true, (loader) => {
    const ktx = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(gl);
    (loader as GLTFLoader).setKTX2Loader(ktx);
  });
  const root = useMemo(() => {
    const g = gltf.scene.clone(true);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    return g;
  }, [gltf]);
  return <primitive object={root} />;
}

function Mini({ plot, variant }: { plot: Plot; variant: Variant }) {
  const probe = useMiniProbe(plot.id);
  if (probe === "pending") return null;
  return (
    <group position={plot.p} rotation={[0, plot.yaw, 0]}>
      {probe === "ready" ? (
        <Suspense fallback={<Placeholder plot={plot} variant={variant} />}>
          <MiniGltf url={`/worlds/${plot.id}/lo/mini.glb`} />
        </Suspense>
      ) : (
        <Placeholder plot={plot} variant={variant} />
      )}
    </group>
  );
}

export function Minis({ plots, variant }: { plots: Plot[]; variant: Variant }) {
  return (
    <>
      {plots.map((plot) => (
        <Mini key={plot.id} plot={plot} variant={variant} />
      ))}
    </>
  );
}

export function NightLamps({ plots, night }: { plots: Plot[]; night: boolean }) {
  if (!night) return null;
  return (
    <>
      {plots.map((plot) => (
        <pointLight key={plot.id} position={[plot.p[0], plot.p[1] + 0.55, plot.p[2]]} color={plot.glow} intensity={4.5} distance={3.4} decay={2} />
      ))}
    </>
  );
}

export function preloadMinis() {
  for (const id of MINI_IDS) {
    const url = `/worlds/${id}/lo/mini.glb`;
    void headOk(url).then((ok) => {
      if (ok) useGLTF.preload(url, false, true);
    });
  }
}
