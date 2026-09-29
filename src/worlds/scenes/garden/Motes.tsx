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
  varying float vTw;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.21 + aSeed.x * 6.28) * 0.5 + uPointer.x * aSeed.z * 0.3;
    p.y += sin(uTime * 0.17 + aSeed.y * 6.28) * 0.35 + uPointer.y * aSeed.z * 0.2;
    p.z += cos(uTime * 0.19 + aSeed.z * 6.28) * 0.5;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = max(0.4, -mv.z);
    gl_PointSize = clamp(uSize * (0.4 + aSeed.x) * 60.0 / depth, 1.0, 64.0) * uDpr;
    vTw = 0.55 + 0.45 * sin(uTime * (1.5 + aSeed.y * 3.0) + aSeed.z * 30.0);
    vA = smoothstep(0.4, 2.0, depth) * (1.0 - smoothstep(40.0, 70.0, depth));
    vHue = aSeed.y;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  uniform float uGain;
  varying float vA;
  varying float vHue;
  varying float vTw;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float r = length(q) * 2.0;
    float core = exp(-r * r * 9.0);
    // Four-point glint on the bright ones.
    float cross = max(0.0, 1.0 - abs(q.x) * 18.0) * max(0.0, 1.0 - abs(q.y) * 2.2) + max(0.0, 1.0 - abs(q.y) * 18.0) * max(0.0, 1.0 - abs(q.x) * 2.2);
    float shape = core + cross * 0.35 * vTw;
    vec3 col = vHue < 0.33 ? uA : vHue < 0.66 ? uB : uC;
    float a = shape * vA * vTw;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col * uGain, a);
  }
`;

type Box = [[number, number, number], [number, number, number]];
const DEFAULT_BOX: Box = [
  [-12, 0.2, -18],
  [12, 7, 18],
];

interface MotesProps {
  night: boolean;
  count?: number;
  /** World-space box [min, max] the motes live in. */
  box?: Box;
  size?: number;
  colors?: [string, string, string];
}

/** Drifting glints (day) or fireflies (night). Cheap enough for the Low Resources mode. */
export function Motes({ night, count = 260, box = DEFAULT_BOX, size = 0.08, colors }: MotesProps) {
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
    const c = colors ?? (night ? ["#ffd6ec", "#cfe0ff", "#fff1b8"] : ["#ffffff", "#ffe3f0", "#fff4d6"]);
    return new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uTime: { value: 0 },
        uDpr: { value: 1 },
        uSize: { value: size },
        uPointer: { value: new THREE.Vector2() },
        uA: { value: new THREE.Color(c[0]) },
        uB: { value: new THREE.Color(c[1]) },
        uC: { value: new THREE.Color(c[2]) },
        uGain: { value: night ? 3.5 : 1.4 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
  }, [night, size, colors]);

  useFrame((state, dt) => {
    material.uniforms.uTime.value += Math.min(dt, 0.05);
    material.uniforms.uDpr.value = state.gl.getPixelRatio();
    material.uniforms.uPointer.value.set(pointer.sx, pointer.sy);
  });

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={10} />;
}
