"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { MAX_RIPPLES, meadowWave } from "@/worlds/scenes/garden/wave";

const BLADE_H = 0.62;

/**
 * Bend matches `meadowLean` in wave.ts: a traveling radial packet plus a
 * standing wind. Roots stay put; the tip takes the whole offset.
 */
const GRASS_VERT = /* glsl */ `
#define MAX_RIPPLES ${MAX_RIPPLES}
uniform float uTime;
uniform float uBend;
uniform vec4 uRipples[MAX_RIPPLES];

float packet(float r, float front, float width, float k) {
  float x = r - front;
  float env = exp(-x * x / (width * width));
  return env * (k * cos(k * x) - 2.0 * x / (width * width) * sin(k * x));
}

vec2 meadowGrad(vec2 p) {
  vec2 grad = vec2(0.0);
  for (int i = 0; i < MAX_RIPPLES; i++) {
    vec4 rp = uRipples[i];
    float age = uTime - rp.z;
    if (rp.w <= 0.0 || age < 0.0 || age > 5.0) continue;
    vec2 d = p - rp.xy;
    float r = length(d) + 1e-4;
    float front = age * 1.35;
    float amp = rp.w * exp(-age * 0.9) / (1.0 + front * 1.2);
    float g = packet(r, front, 0.22 + age * 0.12, 11.0) * amp;
    grad += d / r * g;
  }
  float w1 = sin(p.x * 0.65 + uTime * 1.25) * cos(p.y * 0.45 - uTime * 0.55);
  float w2 = cos(p.x * 0.35 - uTime * 0.8) * sin(p.y * 0.7 + uTime * 1.05);
  grad += vec2(w1, w2) * 2.4;
  return grad;
}
`;

function hash(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function bladeGeometry() {
  const w = 0.04;
  const plane = new THREE.PlaneGeometry(w, BLADE_H, 1, 3);
  plane.translate(0, BLADE_H / 2, 0);
  const cross = plane.clone();
  cross.rotateY(Math.PI / 2);
  const a = plane;
  const b = cross;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array((a.getAttribute("position").count + b.getAttribute("position").count) * 3);
  const nrm = new Float32Array(pos.length);
  const uv = new Float32Array((a.getAttribute("uv").count + b.getAttribute("uv").count) * 2);
  const ia = a.getIndex();
  const ib = b.getIndex();
  if (!ia || !ib) throw new Error("blade geometry is missing an index");
  const index = new Uint16Array(ia.count + ib.count);
  const pa = a.getAttribute("position");
  const na = a.getAttribute("normal");
  const ua = a.getAttribute("uv");
  const pb = b.getAttribute("position");
  const nb = b.getAttribute("normal");
  const ub = b.getAttribute("uv");
  for (let i = 0; i < pa.count; i++) {
    pos[i * 3] = pa.getX(i);
    pos[i * 3 + 1] = pa.getY(i);
    pos[i * 3 + 2] = pa.getZ(i);
    nrm[i * 3] = na.getX(i);
    nrm[i * 3 + 1] = na.getY(i);
    nrm[i * 3 + 2] = na.getZ(i);
    uv[i * 2] = ua.getX(i);
    uv[i * 2 + 1] = ua.getY(i);
  }
  const off = pa.count;
  for (let i = 0; i < pb.count; i++) {
    pos[(off + i) * 3] = pb.getX(i);
    pos[(off + i) * 3 + 1] = pb.getY(i);
    pos[(off + i) * 3 + 2] = pb.getZ(i);
    nrm[(off + i) * 3] = nb.getX(i);
    nrm[(off + i) * 3 + 1] = nb.getY(i);
    nrm[(off + i) * 3 + 2] = nb.getZ(i);
    uv[(off + i) * 2] = ub.getX(i);
    uv[(off + i) * 2 + 1] = ub.getY(i);
  }
  for (let i = 0; i < ia.count; i++) index[i] = ia.getX(i);
  for (let i = 0; i < ib.count; i++) index[ia.count + i] = ib.getX(i) + off;
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  plane.dispose();
  cross.dispose();
  return geo;
}

const DAY = ["#7fbf63", "#a8d48a", "#cfe7a4", "#5ea56a"];
const NIGHT = ["#1d4a38", "#16382c", "#245443", "#0f2c22"];

interface GrassProps {
  count: number;
  night: boolean;
}

/** Instanced lawn. The left side stays short so the headline has sky behind it. */
export function Grass({ count, night }: GrassProps) {
  const geometry = useMemo(() => bladeGeometry(), []);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBend: { value: 1 },
      uRipples: { value: meadowWave.data },
    }),
    [],
  );

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    m.customProgramCacheKey = () => "meadow-grass";
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uBend = uniforms.uBend;
      shader.uniforms.uRipples = uniforms.uRipples;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${GRASS_VERT}`)
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec2 iXZ = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
  float sc = max(length(vec3(instanceMatrix[0])), 1e-4);
  mat3 rot = mat3(instanceMatrix);
  rot[0] /= sc; rot[1] /= sc; rot[2] /= sc;
#else
  vec2 iXZ = vec2(0.0);
  mat3 rot = mat3(1.0);
#endif
float h = clamp(position.y / ${BLADE_H.toFixed(2)}, 0.0, 1.0);
vec2 g = meadowGrad(iXZ) * uBend;
mat3 inv = mat3(vec3(rot[0].x, rot[1].x, rot[2].x), vec3(rot[0].y, rot[1].y, rot[2].y), vec3(rot[0].z, rot[1].z, rot[2].z));
transformed += inv * vec3(g.x, 0.0, g.y) * h * h * 0.055;`,
        );
    };
    return m;
  }, [uniforms]);

  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    const palette = night ? NIGHT : DAY;
    const color = new THREE.Color();
    let n = 0;
    const target = count;
    for (let i = 0; n < target && i < target * 4; i++) {
      const u = hash(i * 3 + 1);
      const v = hash(i * 3 + 2);
      const x = -7 + u * 18;
      const z = -7 + v * 14;
      const left = x < 0.4;
      if (left && hash(i * 3 + 3) > 0.42) continue;
      const scale = (left ? 0.28 + hash(i * 3 + 4) * 0.28 : 0.65 + hash(i * 3 + 4) * 0.7) * (0.85 + hash(i) * 0.3);
      dummy.position.set(x, 0, z);
      dummy.rotation.set(0, hash(i * 3 + 5) * Math.PI * 2, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      m.setMatrixAt(n, dummy.matrix);
      color.set(palette[Math.floor(hash(i * 3 + 6) * palette.length)]);
      m.setColorAt(n, color);
      n++;
    }
    // Fill any rejected slots so the instance count stays honest.
    dummy.scale.setScalar(0.001);
    dummy.position.set(0, -5, 0);
    dummy.updateMatrix();
    while (n < count) {
      m.setMatrixAt(n, dummy.matrix);
      m.setColorAt(n, color);
      n++;
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.frustumCulled = false;
    m.receiveShadow = false;
    m.castShadow = false;
    return m;
  }, [count, geometry, material, night]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useEffect(() => () => mesh.dispose(), [mesh]);

  useFrame(() => {
    uniforms.uTime.value = meadowWave.now;
  });

  return <primitive object={mesh} />;
}
