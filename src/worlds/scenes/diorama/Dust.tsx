"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { pointer } from "@/lib/store";

const vertex = /* glsl */ `
  attribute vec3 aSeed;
  uniform float uTime;
  uniform float uDpr;
  uniform float uSize;
  uniform vec2 uPointer;
  varying float vA;
  varying float vHue;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.19 + aSeed.x * 6.28) * 0.22 + uPointer.x * aSeed.z * 0.18;
    p.y += sin(uTime * 0.13 + aSeed.y * 6.28) * 0.12 + 0.04 * sin(uTime * 0.4 + aSeed.z * 8.0);
    p.z += cos(uTime * 0.16 + aSeed.z * 6.28) * 0.22 + uPointer.y * aSeed.x * 0.12;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = max(0.35, -mv.z);
    gl_PointSize = clamp(uSize * (0.45 + aSeed.x) * 70.0 / depth, 1.0, 28.0) * uDpr;
    vA = smoothstep(0.3, 1.8, depth) * (1.0 - smoothstep(14.0, 22.0, depth));
    vHue = aSeed.y;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uA;
  uniform vec3 uB;
  uniform float uGain;
  varying float vA;
  varying float vHue;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float r = length(q) * 2.0;
    float core = exp(-r * r * 8.0);
    if (core * vA < 0.004) discard;
    gl_FragColor = vec4(mix(uA, uB, vHue) * uGain, core * vA);
  }
`;

type Box = [[number, number, number], [number, number, number]];

interface DustProps {
  night: boolean;
  count?: number;
  box?: Box;
  size?: number;
}

const DEFAULT_BOX: Box = [
  [-7, 0.15, -7],
  [7, 3.2, 7],
];

/** Floating dust / sparkles. Not fireflies — warm motes in the sunset, cooler at night. */
export function Dust({ night, count = 280, box = DEFAULT_BOX, size = 0.07 }: DustProps) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 3);
    const [lo, hi] = box;
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) pos[i * 3 + k] = lo[k] + Math.random() * (hi[k] - lo[k]);
      seed.set([Math.random(), Math.random(), Math.random()], i * 3);
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
    return g;
  }, [count, box]);

  const material = useMemo(() => {
    const a = night ? "#d6e4ff" : "#fff4dc";
    const b = night ? "#ffc6e8" : "#ffd0c0";
    return new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uTime: { value: 0 },
        uDpr: { value: 1 },
        uSize: { value: size },
        uPointer: { value: new THREE.Vector2() },
        uA: { value: new THREE.Color(a) },
        uB: { value: new THREE.Color(b) },
        uGain: { value: night ? 2.2 : 1.25 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
  }, [night, size]);

  useFrame((state, dt) => {
    material.uniforms.uTime.value += Math.min(dt, 0.05);
    material.uniforms.uDpr.value = state.gl.getPixelRatio();
    material.uniforms.uPointer.value.set(pointer.sx, pointer.sy);
  });

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={12} />;
}
