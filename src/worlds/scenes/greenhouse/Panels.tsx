"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { pointer } from "@/lib/store";
import { useColorTextures } from "@/components/three/engine/assets";
import type { PanelMeta } from "@/worlds/scenes/greenhouse/data";
import { glowMaterial } from "@/worlds/scenes/greenhouse/materials";

const HOSTS: Record<string, string> = {
  "/work/vtcc-redesign/cover.png": "vtcc.org",
  "/work/wunderful-life/cover.png": "wunderful.life",
};

const LOOK: Record<Variant, { frame: string; bar: string; ink: string; pill: string; glow: string; glowAmount: number; screen: number }> = {
  day: { frame: "#f7fbf4", bar: "#f5f2ea", ink: "#3d4a3c", pill: "#e6e1d4", glow: "#ffe7b0", glowAmount: 0.35, screen: 1.05 },
  night: { frame: "#a9bfff", bar: "#1c2233", ink: "#c9d4f5", pill: "#2a3350", glow: "#f3d58f", glowAmount: 0.45, screen: 1.25 },
};

/** A browser toolbar drawn once into a canvas: traffic lights and a URL pill. */
function toolbarTexture(host: string, look: (typeof LOOK)[Variant]) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = look.bar;
    g.fillRect(0, 0, c.width, c.height);
    ["#ff6159", "#ffbd2e", "#28c941"].forEach((col, i) => {
      g.beginPath();
      g.arc(34 + i * 30, 32, 9, 0, Math.PI * 2);
      g.fillStyle = col;
      g.fill();
    });
    g.fillStyle = look.pill;
    const x = 300;
    const w = 424;
    g.beginPath();
    g.roundRect(x, 14, w, 36, 18);
    g.fill();
    g.fillStyle = look.ink;
    g.font = "500 22px ui-sans-serif, system-ui, -apple-system, Helvetica, Arial";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(`🔒  ${host}`, x + w / 2, 33);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function Panel({ meta, tex, look, index }: { meta: PanelMeta; tex: THREE.Texture; look: (typeof LOOK)[Variant]; index: number }) {
  const group = useRef<THREE.Group>(null);
  const img = tex.image as { width?: number; height?: number } | undefined;
  const aspect = img?.width && img?.height ? img.height / img.width : 10 / 16;
  const w = meta.w;
  const h = w * aspect;
  const bar = w * 0.055;
  const barTex = useMemo(() => toolbarTexture(HOSTS[meta.cover] ?? "davisdigital.design", look), [meta.cover, look]);
  const mats = useMemo(
    () => ({
      screen: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(look.screen, look.screen, look.screen) }),
      bar: new THREE.MeshBasicMaterial({ map: barTex, toneMapped: false, color: new THREE.Color(look.screen, look.screen, look.screen) }),
      frame: new THREE.MeshStandardMaterial({ color: look.frame, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.42, envMapIntensity: 1.4, depthWrite: false }),
      glow: glowMaterial(look.glow, look.glowAmount),
    }),
    [tex, barTex, look],
  );
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
      barTex.dispose();
    },
    [mats, barTex],
  );

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime + index * 1.7;
    g.position.set(meta.p[0], meta.p[1] + Math.sin(t * 0.55) * 0.045, meta.p[2]);
    g.rotation.set(Math.sin(t * 0.31) * 0.03 + pointer.sy * 0.05, meta.yaw + Math.sin(t * 0.23) * 0.04 - pointer.sx * 0.08, Math.sin(t * 0.37) * 0.015);
  });

  const total = h + bar;
  return (
    <group ref={group}>
      <mesh material={mats.glow} position={[0, 0, -0.06]} renderOrder={24}>
        <planeGeometry args={[w * 2.1, total * 2.3]} />
      </mesh>
      <RoundedBox args={[w * 1.035, total + w * 0.035, w * 0.018]} radius={w * 0.018} smoothness={3} material={mats.frame} position={[0, 0, -w * 0.012]} renderOrder={25} />
      <mesh material={mats.bar} position={[0, h / 2, 0.001]} renderOrder={26}>
        <planeGeometry args={[w, bar]} />
      </mesh>
      <mesh material={mats.screen} position={[0, -bar / 2, 0.001]} renderOrder={26}>
        <planeGeometry args={[w, h]} />
      </mesh>
    </group>
  );
}

/** Floating frosted-glass browser windows showing the Sites projects. */
export function Panels({ panels, variant }: { panels: PanelMeta[]; variant: Variant }) {
  const urls = useMemo(() => [...new Set(panels.map((p) => p.cover))], [panels]);
  const textures = useColorTextures(urls);
  const look = LOOK[variant];
  return (
    <>
      {panels.map((p, i) => (
        <Panel key={i} index={i} meta={p} tex={textures[urls.indexOf(p.cover)]} look={look} />
      ))}
    </>
  );
}
