"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const vertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform vec3 uMin;
  uniform vec3 uSize;
  uniform float uDpr;
  uniform float uScale;
  uniform float uRise;
  uniform int uShafts;
  uniform vec4 uShaftRect[3];
  uniform float uCeil;
  uniform vec3 uSun;
  varying float vA;
  varying float vHue;
  varying float vTw;
  void main() {
    vec3 p = position;
    // Brownian-ish drift plus a slow rise, wrapped inside the box.
    p += vec3(sin(uTime * 0.13 + aSeed.x * 40.0), cos(uTime * 0.11 + aSeed.y * 40.0), sin(uTime * 0.09 + aSeed.z * 40.0)) * 0.35;
    p.y += uTime * uRise * (0.3 + aSeed.w);
    p = uMin + mod(p - uMin, uSize);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    gl_PointSize = clamp(uScale * (0.6 + aSeed.w * 1.4) / max(depth, 0.1) * 300.0, 1.0, 40.0) * uDpr;
    vA = smoothstep(0.3, 2.0, depth) * (1.0 - smoothstep(25.0, 45.0, depth));
    if (uShafts > 0) {
      // Trace up the sunbeam to the skylight plane: motes only glitter inside the shafts.
      vec3 top = p + uSun * ((uCeil - p.y) / max(uSun.y, 0.05));
      float lit = 0.0;
      for (int i = 0; i < 3; i++) {
        if (i >= uShafts) break;
        vec4 r = uShaftRect[i];
        vec2 inside = step(r.xy, top.xz) * step(top.xz, r.zw);
        lit = max(lit, inside.x * inside.y);
      }
      vA *= 0.12 + 0.88 * lit;
    }
    vHue = aSeed.z;
    vTw = aSeed.x * 6.28;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uA;
  uniform vec3 uB;
  uniform float uOpacity;
  uniform float uTime;
  varying float vA;
  varying float vHue;
  varying float vTw;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = exp(-r * r * 3.5) * vA * uOpacity * (0.6 + 0.4 * sin(uTime * 1.7 + vTw));
    if (a < 0.003) discard;
    gl_FragColor = vec4(mix(uA, uB, vHue), a);
  }
`;

export interface DustProps {
  min: [number, number, number];
  max: [number, number, number];
  count?: number;
  colors: [string, string];
  /** HDR multiplier on the colors (>1 blooms). */
  gain?: number;
  opacity?: number;
  size?: number;
  rise?: number;
  additive?: boolean;
  /** Optional sunbeams: skylight rects (xMin, zMin, xMax, zMax) at height `ceil`, sun direction toward the sun. */
  shafts?: { rects: [number, number, number, number][]; ceil: number; sun: [number, number, number] };
}

/** Floating motes in a box: sunlit dust by day, fireflies or glints by night. */
export function Dust({ min, max, count = 900, colors, gain = 1, opacity = 0.6, size = 0.05, rise = 0.02, additive = true, shafts }: DustProps) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) pos[i * 3 + k] = min[k] + Math.random() * (max[k] - min[k]);
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    return g;
  }, [count, min, max]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uTime: { value: 0 },
          uMin: { value: new THREE.Vector3(...min) },
          uSize: { value: new THREE.Vector3(max[0] - min[0], max[1] - min[1], max[2] - min[2]) },
          uDpr: { value: 1 },
          uScale: { value: size },
          uRise: { value: rise },
          uA: { value: new THREE.Color(colors[0]).multiplyScalar(gain) },
          uB: { value: new THREE.Color(colors[1]).multiplyScalar(gain) },
          uOpacity: { value: opacity },
          uShafts: { value: shafts ? Math.min(3, shafts.rects.length) : 0 },
          uShaftRect: { value: Array.from({ length: 3 }, (_, i) => new THREE.Vector4(...(shafts?.rects[i] ?? [0, 0, 0, 0]))) },
          uCeil: { value: shafts?.ceil ?? 0 },
          uSun: { value: new THREE.Vector3(...(shafts?.sun ?? [0, 1, 0])).normalize() },
        },
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    [min, max, colors, gain, opacity, size, rise, additive, shafts],
  );
  useFrame((state, dt) => {
    material.uniforms.uTime.value += Math.min(dt, 0.05);
    material.uniforms.uDpr.value = state.gl.getPixelRatio();
  });
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={10} />;
}
