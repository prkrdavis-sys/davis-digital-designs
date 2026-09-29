"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { bakedGeometry, useColorTextures, useWorldGLTF, type LoadedGLTF } from "@/components/three/engine/assets";
import { withAtmosphere, type AtmosphereUniforms } from "@/worlds/scenes/dunes/atmosphere";
import type { DunesData } from "@/worlds/scenes/dunes/data";
import { drawPanel } from "@/worlds/scenes/dunes/panels";
import { PALETTES } from "@/worlds/scenes/dunes/palette";

export interface PanelLight {
  id: string;
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  color: THREE.Color;
  width: number;
  yaw: number;
}

/** Panel centers and facing, read from the slabs GLB (for sand spill light and the parked cover). */
export function panelLights(gltf: LoadedGLTF, data: DunesData): PanelLight[] {
  gltf.scene.updateMatrixWorld(true);
  const out: PanelLight[] = [];
  for (const m of data.meta.monoliths) {
    const mesh = gltf.scene.getObjectByName(`${m.id}_panel`) as THREE.Mesh | undefined;
    if (!mesh) continue;
    const g = bakedGeometry(mesh);
    const box = g.boundingBox!;
    const pos = box.getCenter(new THREE.Vector3());
    const n = new THREE.Vector3().fromBufferAttribute(g.getAttribute("normal") as THREE.BufferAttribute, 0).normalize();
    g.dispose();
    const accent = data.products[m.product]?.accent ?? "#ffb84d";
    out.push({ id: m.id, pos: pos.addScaledVector(n, 0.4), normal: n, color: new THREE.Color(accent).lerp(new THREE.Color("#ffc58a"), 0.55), width: m.w * 0.78, yaw: m.yaw });
  }
  return out;
}

/** Sedimentary strata for the sandstone slabs (color map, tiled vertically). */
function strataTexture(): THREE.DataTexture {
  const w = 64;
  const h = 512;
  const data = new Uint8Array(w * h * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const bands: number[] = [];
  for (let y = 0; y < h; y++) bands.push(y === 0 ? 0.5 : bands[y - 1] + (rnd() - 0.5) * 0.25);
  for (let y = 0; y < h; y++) {
    const b = 0.5 + 0.5 * Math.sin(y * 0.09 + bands[y] * 2.0) * 0.6 + (rnd() - 0.5) * 0.1;
    for (let x = 0; x < w; x++) {
      const n = (rnd() - 0.5) * 0.08;
      const v = Math.min(1, Math.max(0, b + n));
      const i = (y * w + x) * 4;
      data[i] = 150 + v * 70;
      data[i + 1] = 98 + v * 52;
      data[i + 2] = 62 + v * 36;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** The template monoliths: black glass, brushed bronze and banded sandstone, each with a live panel. */
export function Monoliths({ data, variant, atmosphere, envMap }: { data: DunesData; variant: Variant; atmosphere: AtmosphereUniforms; envMap: THREE.Texture | null }) {
  const gltf = useWorldGLTF("dunes", "monoliths.glb");
  const covers = useColorTextures(data.products.map((p) => p.cover));
  const pal = PALETTES[variant];

  const panelTextures = useMemo(() => data.products.map((p, i) => drawPanel(p, covers[i]?.image as CanvasImageSource | undefined)), [data, covers]);
  useEffect(() => () => panelTextures.forEach((t) => t.dispose()), [panelTextures]);

  const mats = useMemo(() => {
    const strata = strataTexture();
    const common = { envMap, envMapIntensity: 1 };
    const glass = new THREE.MeshPhysicalMaterial({ ...common, color: "#07080a", roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, ior: 1.5, specularIntensity: 1, envMapIntensity: 1.3 });
    const metal = new THREE.MeshPhysicalMaterial({ ...common, color: "#c29066", metalness: 1, roughness: 0.3, anisotropy: 0.75, anisotropyRotation: Math.PI / 2 });
    const stone = new THREE.MeshPhysicalMaterial({ ...common, color: "#ffffff", map: strata, roughness: 0.78, metalness: 0, sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color("#ffd2a0"), envMapIntensity: 0.8 });
    const gold = new THREE.MeshPhysicalMaterial({ ...common, color: "#ffcf8a", metalness: 1, roughness: 0.18, clearcoat: 0.4 });
    const dark = new THREE.MeshPhysicalMaterial({ ...common, color: "#0b0c0e", roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05 });
    const all = { glass, metal, stone, gold, dark };
    for (const [k, m] of Object.entries(all)) withAtmosphere(m, atmosphere, `slab-${k}`);
    return { ...all, strata };
  }, [atmosphere, envMap]);

  const panelMats = useMemo(
    () =>
      panelTextures.map((map) => {
        const m = new THREE.MeshBasicMaterial({ map, color: new THREE.Color(pal.panelGlow, pal.panelGlow, pal.panelGlow) });
        return withAtmosphere(m, atmosphere, "panel");
      }),
    [panelTextures, pal, atmosphere],
  );
  const lineMats = useMemo(
    () => data.products.map((p) => withAtmosphere(new THREE.MeshBasicMaterial({ color: new THREE.Color(p.accent).multiplyScalar(variant === "night" ? 9 : 5) }), atmosphere, "line")),
    [data, variant, atmosphere],
  );

  useEffect(
    () => () => {
      for (const m of [mats.glass, mats.metal, mats.stone, mats.gold, mats.dark, ...panelMats, ...lineMats]) m.dispose();
      mats.strata.dispose();
    },
    [mats, panelMats, lineMats],
  );

  const scene = useMemo(() => {
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const u = mesh.userData as { role?: string; kind?: "glass" | "metal" | "stone"; product?: number };
      const kind = u.kind ?? "glass";
      const product = u.product ?? 0;
      switch (u.role) {
        case "slab":
          mesh.material = mats[kind];
          break;
        case "bezel":
        case "band":
          mesh.material = kind === "metal" ? mats.dark : mats.gold;
          break;
        case "panel":
          mesh.material = panelMats[product % panelMats.length];
          break;
        case "line":
          mesh.material = lineMats[product % lineMats.length];
          break;
        default:
          mesh.material = mats.glass;
      }
    });
    return gltf.scene;
  }, [gltf, mats, panelMats, lineMats]);

  return <primitive object={scene} />;
}
