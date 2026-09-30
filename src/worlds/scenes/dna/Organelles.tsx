"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { firstMeshGeometry, useWorldGLTF } from "@/components/three/engine/assets";
import { cameraSpan, fogDensity } from "@/worlds/scenes/dna/Medium";

const AXIS_CLEAR = 48;
const UP = new THREE.Vector3(0, 1, 0);

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inHelix(p: THREE.Vector3) {
  return Math.hypot(p.x, p.z) < AXIS_CLEAR && p.y < 50 && p.y > -340;
}

function shellPoint(rng: () => number, rMin: number, rMax: number, yMin: number, yMax: number, chromo: THREE.Vector3, chromoClear: number) {
  for (let n = 0; n < 48; n++) {
    const r = rMin + rng() * (rMax - rMin);
    const a = rng() * Math.PI * 2;
    const p = new THREE.Vector3(Math.cos(a) * r, yMin + rng() * (yMax - yMin), Math.sin(a) * r);
    if (inHelix(p)) continue;
    if (p.distanceTo(chromo) < chromoClear) continue;
    return p;
  }
  const a = rng() * Math.PI * 2;
  return new THREE.Vector3(Math.cos(a) * rMax, yMin, Math.sin(a) * rMax);
}

function aroundChromo(rng: () => number, chromo: THREE.Vector3, distMin: number, distMax: number) {
  for (let n = 0; n < 48; n++) {
    const dir = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    const p = chromo.clone().addScaledVector(dir, distMin + rng() * (distMax - distMin));
    if (inHelix(p)) continue;
    return p;
  }
  return chromo.clone().add(new THREE.Vector3(distMax, distMax * 0.2, 0));
}

function compose(position: THREE.Vector3, dir: THREE.Vector3, scale: number) {
  const q = new THREE.Quaternion();
  if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
  q.setFromUnitVectors(UP, dir.normalize());
  const extra = new THREE.Quaternion().setFromAxisAngle(dir, scale);
  q.multiply(extra);
  return new THREE.Matrix4().compose(position, q, new THREE.Vector3(scale, scale, scale));
}

interface Field {
  matrices: THREE.Matrix4[];
}

function layout(center: [number, number, number]): { vesicle: Field; mito: Field; er: Field } {
  const rng = mulberry32(0xc311);
  const chromo = new THREE.Vector3(...center);
  const vesicle: THREE.Matrix4[] = [];
  const mito: THREE.Matrix4[] = [];
  const er: THREE.Matrix4[] = [];
  const spin = new THREE.Vector3();

  for (let i = 0; i < 14; i++) {
    const p = shellPoint(rng, 22, 70, -80, 30, chromo, 200);
    spin.set(rng() - 0.5, rng() - 0.5, rng() - 0.5);
    vesicle.push(compose(p, spin, 7 + rng() * 10));
  }
  for (let i = 0; i < 16; i++) {
    const p = shellPoint(rng, 60, 320, -500, 90, chromo, 280);
    spin.set(rng() - 0.5, rng() - 0.5, rng() - 0.5);
    vesicle.push(compose(p, spin, 16 + rng() * 28));
  }
  for (let i = 0; i < 12; i++) {
    const p = shellPoint(rng, 340, 980, -900, 160, chromo, 280);
    spin.set(rng() - 0.5, 0.4 + rng(), rng() - 0.5);
    vesicle.push(compose(p, spin, 30 + rng() * 48));
  }

  for (let i = 0; i < 6; i++) {
    const p = shellPoint(rng, 180, 560, -640, 40, chromo, 300);
    spin.set(rng() - 0.5, -1, rng() - 0.5);
    mito.push(compose(p, spin, 90 + rng() * 80));
  }
  for (let i = 0; i < 6; i++) {
    const p = aroundChromo(rng, chromo, 320, 780);
    spin.set(rng() - 0.5, rng() - 0.2, rng() - 0.5);
    mito.push(compose(p, spin, 180 + rng() * 240));
  }

  for (let i = 0; i < 4; i++) {
    const p = shellPoint(rng, 240, 720, -700, 20, chromo, 320);
    spin.set(rng() - 0.5, 0.15, rng() - 0.5);
    er.push(compose(p, spin, 140 + rng() * 120));
  }
  for (let i = 0; i < 4; i++) {
    const p = aroundChromo(rng, chromo, 400, 900);
    spin.set(0.4 + rng(), rng() - 0.5, 0.2);
    er.push(compose(p, spin, 240 + rng() * 220));
  }

  return { vesicle: { matrices: vesicle }, mito: { matrices: mito }, er: { matrices: er } };
}

function organelleMaterial(variant: Variant, color: string, emissive: string, opacity: number) {
  if (variant === "night") {
    return new THREE.MeshStandardMaterial({
      color: "#041018",
      emissive,
      emissiveIntensity: 1.7,
      roughness: 0.4,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
      depthWrite: true,
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.4,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.25,
    sheen: 1,
    sheenRoughness: 0.32,
    sheenColor: new THREE.Color("#fff7f2"),
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
}

function FieldMesh({ geometry, matrices, material }: { geometry: THREE.BufferGeometry; matrices: THREE.Matrix4[]; material: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
  }, [matrices]);
  return <instancedMesh ref={ref} args={[geometry, material, matrices.length]} frustumCulled={false} />;
}

const membraneVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const membraneFragment = /* glsl */ `
  uniform vec3 uRim;
  uniform vec3 uFog;
  uniform float uFogDensity;
  uniform float uAlpha;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(-vV);
    float fres = pow(1.0 - abs(dot(n, v)), 2.3);
    float fog = 1.0 - exp(-length(vV) * uFogDensity);
    vec3 col = mix(uRim * fres, uFog, clamp(fog, 0.0, 0.9));
    float a = fres * uAlpha * (1.0 - fog * 0.85);
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
  }
`;

function Membrane({ variant, center }: { variant: Variant; center: [number, number, number] }) {
  const night = variant === "night";
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(900, 3), []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: membraneVertex,
        fragmentShader: membraneFragment,
        uniforms: {
          uRim: { value: new THREE.Color(night ? "#7dffc4" : "#fff4ee") },
          uFog: { value: new THREE.Color(night ? "#050814" : "#e4eef0") },
          uFogDensity: { value: 0.004 },
          uAlpha: { value: night ? 0.7 : 0.42 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: night ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    [night],
  );
  useFrame((state) => {
    material.uniforms.uFogDensity.value = fogDensity(cameraSpan(state.camera.position));
  });
  return <mesh geometry={geometry} material={material} position={center} frustumCulled={false} renderOrder={1} />;
}

/** Vesicles, mitochondria, and ER sheets, plus the plasma membrane around the chromosome. */
export function Organelles({ variant, center }: { variant: Variant; center: [number, number, number] }) {
  const vesicleGltf = useWorldGLTF("dna", "vesicle.glb");
  const mitoGltf = useWorldGLTF("dna", "mitochondrion.glb");
  const erGltf = useWorldGLTF("dna", "er.glb");
  const vesicleGeo = useMemo(() => firstMeshGeometry(vesicleGltf), [vesicleGltf]);
  const mitoGeo = useMemo(() => firstMeshGeometry(mitoGltf), [mitoGltf]);
  const erGeo = useMemo(() => firstMeshGeometry(erGltf), [erGltf]);
  const fields = useMemo(() => layout(center), [center]);
  const vesicleMat = useMemo(() => organelleMaterial(variant, "#d9899c", "#6fb4ff", 0.86), [variant]);
  const mitoMat = useMemo(() => organelleMaterial(variant, "#c4a07a", "#ff6fae", 0.9), [variant]);
  const erMat = useMemo(() => organelleMaterial(variant, "#8aafc4", "#9dffce", 0.72), [variant]);

  return (
    <group>
      <FieldMesh geometry={vesicleGeo} matrices={fields.vesicle.matrices} material={vesicleMat} />
      <FieldMesh geometry={mitoGeo} matrices={fields.mito.matrices} material={mitoMat} />
      <FieldMesh geometry={erGeo} matrices={fields.er.matrices} material={erMat} />
      <Membrane variant={variant} center={center} />
    </group>
  );
}
