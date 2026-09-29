"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { useColorTextures, useWorldGLTF } from "@/components/three/engine/assets";
import type { CoverInfo, MuseumLayout } from "@/worlds/scenes/museum/layout";

type Tuned = THREE.MeshStandardMaterial & Partial<THREE.MeshPhysicalMaterial>;

function tune(root: THREE.Object3D, variant: Variant) {
  const night = variant === "night";
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as Tuned;
    if (!m || seen.has(m)) return;
    seen.add(m);
    const name = m.name.replace(/\.\d+$/, "");
    m.userData.baseEmissive ??= m.emissiveIntensity ?? 1;
    m.envMapIntensity = night ? 0.7 : 1.1;
    switch (name) {
      case "gilt":
        m.roughness = 0.26;
        m.envMapIntensity = night ? 1.0 : 1.5;
        break;
      case "velvet":
        m.sheen = 1;
        m.sheenRoughness = 0.35;
        m.sheenColor = new THREE.Color("#ff5a6e");
        break;
      case "lamp":
        m.emissiveIntensity = m.userData.baseEmissive * (night ? 1.6 : 0.8);
        m.toneMapped = false;
        break;
      default:
        break;
    }
    m.needsUpdate = true;
  });
}

const canvasVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const canvasFragment = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  uniform sampler2D uMap;
  uniform float uGain;
  uniform float uLo;
  uniform float uHi;
  uniform vec3 uTint;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  void main() {
    vec3 col = texture2D(uMap, vUv).rgb;
    // The gallery spot pools a little above centre; the picture light grazes the top edge.
    vec2 q = (vUv - vec2(0.5, 0.58)) * vec2(1.0, 1.35);
    float pool = 1.0 - smoothstep(0.15, 0.85, length(q));
    float graze = smoothstep(0.75, 1.0, vUv.y) * 0.25;
    col *= uTint * (mix(uLo, uHi, pool) + graze) * uGain;
    float dist = length(vWorld - cameraPosition);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
  }
`;

function placardTexture(c: CoverInfo): THREE.CanvasTexture {
  const w = 640;
  const h = 360;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#26232a");
  grad.addColorStop(1, "#18161b");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(214,176,106,0.85)";
  g.lineWidth = 6;
  g.strokeRect(14, 14, w - 28, h - 28);
  g.fillStyle = "#f3e9d6";
  g.font = "600 58px Georgia, 'Times New Roman', serif";
  g.textBaseline = "alphabetic";
  let title = c.title;
  while (g.measureText(title).width > w - 90 && title.length > 4) title = title.slice(0, -2) + "…";
  g.fillText(title, 44, 150);
  g.fillStyle = "rgba(214,176,106,0.95)";
  g.fillRect(44, 180, 70, 4);
  g.fillStyle = "#cdbfa5";
  g.font = "32px Georgia, 'Times New Roman', serif";
  const cat = c.category ? c.category[0].toUpperCase() + c.category.slice(1) : "";
  g.fillText(`${cat}${cat ? "  ·  " : ""}${c.year}`, 44, 250);
  g.font = "italic 26px Georgia, serif";
  g.fillStyle = "#9d927f";
  g.fillText("Davis Digital Designs", 44, 305);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const basis = new THREE.Matrix4();

function artMatrix(center: THREE.Vector3, right: THREE.Vector3, normal: THREE.Vector3, lift = 0) {
  const up = new THREE.Vector3().crossVectors(normal, right).normalize();
  basis.makeBasis(right, up, normal);
  const m = new THREE.Matrix4().copy(basis);
  m.setPosition(center.clone().addScaledVector(normal, lift));
  return m;
}

/**
 * Frames, picture lights, sculptures and stanchions (live PBR from gallery.glb),
 * the featured covers on their canvases, and bronze-edged placards.
 * `mirror` renders an independent copy for the floor reflection.
 */
export function Gallery({ variant, layout, covers, fog, mirror = false }: { variant: Variant; layout: MuseumLayout; covers: CoverInfo[]; fog: THREE.FogExp2; mirror?: boolean }) {
  const gltf = useWorldGLTF("museum", "gallery.glb");
  const night = variant === "night";
  const root = useMemo(() => gltf.scene.clone(true), [gltf]);
  useMemo(() => tune(gltf.scene, variant), [gltf, variant]);
  const textures = useColorTextures(covers.map((c) => c.cover));

  const art = useMemo(() => {
    return layout.art.map((a, i) => {
      const cover = covers.find((c) => c.slug === a.slug) ?? covers[i];
      const tex = textures[covers.indexOf(cover)] ?? textures[0];
      const center = new THREE.Vector3(...a.center);
      const right = new THREE.Vector3(...a.right);
      const normal = new THREE.Vector3(...a.normal);
      const material = new THREE.ShaderMaterial({
        vertexShader: canvasVertex,
        fragmentShader: canvasFragment,
        uniforms: {
          uMap: { value: tex },
          uGain: { value: night ? 1.15 : 1.0 },
          uLo: { value: night ? 0.32 : 0.8 },
          uHi: { value: night ? 1.3 : 1.12 },
          uTint: { value: new THREE.Color(night ? "#ffe6c8" : "#fff8ee") },
          uFogColor: { value: fog.color },
          uFogDensity: { value: fog.density },
        },
      });
      const canvasGeo = new THREE.PlaneGeometry(a.w, a.h);
      const matrix = artMatrix(center, right, normal, 0.004);
      const placardMat = new THREE.MeshStandardMaterial({ map: placardTexture(cover), roughness: 0.35, metalness: 0, envMapIntensity: 0.5, emissive: new THREE.Color("#ffffff"), emissiveIntensity: night ? 0.25 : 0.1 });
      placardMat.emissiveMap = placardMat.map;
      const placard = artMatrix(new THREE.Vector3(...a.placard), right, normal, 0.008);
      return { material, canvasGeo, matrix, placardMat, placard };
    });
  }, [layout, covers, textures, night, fog]);

  useEffect(
    () => () => {
      for (const a of art) {
        a.material.dispose();
        a.canvasGeo.dispose();
        a.placardMat.map?.dispose();
        a.placardMat.dispose();
      }
    },
    [art],
  );

  useFrame(() => {
    for (const a of art) a.material.uniforms.uFogDensity.value = fog.density;
  });

  return (
    <>
      <primitive object={root} />
      {art.map((a, i) => (
        <group key={i} matrixAutoUpdate={false} matrix={a.matrix}>
          <mesh geometry={a.canvasGeo} material={a.material} />
        </group>
      ))}
      {art.map((a, i) => (
        <group key={`p${i}`} matrixAutoUpdate={false} matrix={a.placard}>
          <mesh material={a.placardMat}>
            <planeGeometry args={[0.3, 0.168]} />
          </mesh>
        </group>
      ))}
      {!mirror && <GalleryLights layout={layout} variant={variant} />}
    </>
  );
}

const SCULPTURE_SPOTS: { pos: [number, number, number]; target: [number, number, number]; k: number }[] = [
  { pos: [0, 7.1, -11], target: [2.9, 1.6, -9.75], k: 1 },
  { pos: [0, 7.1, -24], target: [2.9, 1.5, -22.75], k: 1 },
  { pos: [0, 7.1, -30], target: [0, 2.2, -35.2], k: 2.2 },
];

/** Gallery spotlights: one per artwork (glints on the gilt) and one per sculpture. */
function GalleryLights({ layout, variant }: { layout: MuseumLayout; variant: Variant }) {
  const night = variant === "night";
  const lights = useMemo(() => {
    const out: { light: THREE.SpotLight; target: THREE.Object3D }[] = [];
    const add = (pos: [number, number, number], tgt: [number, number, number], intensity: number, angle: number) => {
      const light = new THREE.SpotLight("#ffe2c0", intensity, 16, angle, 0.65, 2);
      light.position.set(...pos);
      const target = new THREE.Object3D();
      target.position.set(...tgt);
      light.target = target;
      out.push({ light, target });
    };
    layout.spots.forEach((s) => add(s.pos, s.target, night ? 70 : 38, 0.42));
    SCULPTURE_SPOTS.forEach((s) => add(s.pos, s.target, (night ? 60 : 30) * s.k, 0.3));
    return out;
  }, [layout, night]);
  return (
    <>
      {lights.map((l, i) => (
        <group key={i}>
          <primitive object={l.light} />
          <primitive object={l.target} />
        </group>
      ))}
    </>
  );
}
