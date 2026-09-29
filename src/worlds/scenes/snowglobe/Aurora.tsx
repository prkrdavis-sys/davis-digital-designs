"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { SnowMeta } from "@/worlds/scenes/snowglobe/data";

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uIntensity;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.07; a *= 0.5; } return v; }
  void main() {
    float t = uTime * 0.05;
    // Curtain folds drift sideways; rays run vertically.
    float fold = fbm(vec2(vUv.x * 3.0 + t, t * 0.7)) * 1.6;
    float rays = fbm(vec2((vUv.x + fold * 0.08) * 38.0, vUv.y * 1.2 - t * 3.0));
    rays = smoothstep(0.35, 0.85, rays);
    float band = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
    float wave = 0.55 + 0.45 * sin(vUv.x * 9.0 + uTime * 0.25 + fold * 3.0);
    vec3 green = vec3(0.18, 1.0, 0.62);
    vec3 cyan = vec3(0.25, 0.8, 1.0);
    vec3 violet = vec3(0.62, 0.36, 1.0);
    vec3 col = mix(green, cyan, smoothstep(0.15, 0.55, vUv.y));
    col = mix(col, violet, smoothstep(0.5, 0.95, vUv.y));
    float a = band * (0.25 + rays * 0.9) * wave * uIntensity;
    gl_FragColor = vec4(col * a, 1.0);
  }
`;

/** A curtain of northern lights arcing across the back of the dome (night only). */
export function Aurora({ meta }: { meta: SnowMeta }) {
  const geometry = useMemo(() => {
    // Mirrors sg_parts.build_aurora (Blender x, y, z -> three x, z, -y).
    const cols = 90;
    const rows = 12;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const a = THREE.MathUtils.degToRad(-10 + 200 * u);
      const rr = 0.66 + 0.08 * Math.sin(u * 9.0);
      for (let j = 0; j <= rows; j++) {
        const v = j / rows;
        const z = 1.28 + 0.62 * v + 0.06 * Math.sin(u * 6.0 + 1.0);
        const r2 = rr * (1 - 0.35 * v);
        pos.push(Math.cos(a) * r2, z, -(Math.sin(a) * r2 + 0.05));
        uv.push(u, v);
      }
    }
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const a = i * (rows + 1) + j;
        const b = (i + 1) * (rows + 1) + j;
        idx.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }, []);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uIntensity: { value: 2.6 } }), []);
  useFrame((_, dt) => {
    uniforms.uTime.value += Math.min(dt, 0.05);
  });
  void meta;
  return (
    <mesh geometry={geometry} frustumCulled={false} renderOrder={4}>
      <shaderMaterial vertexShader={vertex} fragmentShader={fragment} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
    </mesh>
  );
}
