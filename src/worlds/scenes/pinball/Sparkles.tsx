"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { pointer } from "@/lib/store";

const moteVertex = /* glsl */ `
  attribute vec3 aSeed;
  uniform vec3 uCam;
  uniform float uBox;
  uniform float uTime;
  uniform float uDpr;
  varying float vA;
  varying float vHue;
  void main() {
    vec3 p = position * uBox + vec3(sin(uTime * 0.21 + aSeed.x * 6.28), sin(uTime * 0.13 + aSeed.y * 6.28) * 0.6 + uTime * 0.02, cos(uTime * 0.17 + aSeed.z * 6.28)) * 0.25;
    p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
    p.y = max(p.y, 0.04);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    gl_PointSize = clamp((0.012 + aSeed.x * 0.02) / max(depth, 0.05) * 900.0, 1.0, 24.0) * uDpr;
    float tw = 0.55 + 0.45 * sin(uTime * (1.5 + aSeed.y * 3.0) + aSeed.z * 40.0);
    vA = tw * smoothstep(0.08, 0.6, depth) * (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, depth));
    vHue = aSeed.y;
    gl_Position = projectionMatrix * mv;
  }
`;

const moteFragment = /* glsl */ `
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  uniform float uGain;
  varying float vA;
  varying float vHue;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float r = length(q) * 2.0;
    float core = exp(-r * r * 6.0);
    float cross = exp(-abs(q.x) * 40.0) * exp(-abs(q.y) * 5.0) + exp(-abs(q.y) * 40.0) * exp(-abs(q.x) * 5.0);
    float a = (core + cross * 0.35) * vA;
    if (a < 0.01) discard;
    vec3 c = vHue < 0.33 ? uA : vHue < 0.66 ? uB : uC;
    gl_FragColor = vec4(c * uGain, a);
  }
`;

const PALETTE: Record<Variant, [string, string, string]> = {
  day: ["#ffffff", "#ffe7f1", "#e3f9ff"],
  night: ["#ff5c9d", "#3edcff", "#ffd84a"],
};

/** Glittering dust hanging in the light over the playfield; wraps around the camera. */
export function Motes({ variant, count = 420 }: { variant: Variant; count?: number }) {
  const night = variant === "night";
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos.set([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5], i * 3);
      seed.set([Math.random(), Math.random(), Math.random()], i * 3);
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
    return g;
  }, [count]);
  const material = useMemo(() => {
    const [a, b, c] = PALETTE[variant];
    return new THREE.ShaderMaterial({
      vertexShader: moteVertex,
      fragmentShader: moteFragment,
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uBox: { value: 7 },
        uTime: { value: 0 },
        uDpr: { value: 1 },
        uA: { value: new THREE.Color(a) },
        uB: { value: new THREE.Color(b) },
        uC: { value: new THREE.Color(c) },
        uGain: { value: night ? 2.4 : 1.4 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, [variant, night]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame((state, dt) => {
    const u = material.uniforms;
    u.uTime.value += Math.min(dt, 0.05);
    u.uCam.value.copy(state.camera.position);
    u.uDpr.value = state.gl.getPixelRatio();
  });
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={20} />;
}

const glintVertex = /* glsl */ `
  attribute vec3 aSeed;
  uniform float uTime;
  uniform vec2 uPointer;
  uniform float uDpr;
  varying float vA;
  varying float vHue;
  void main() {
    vec3 p = position;
    p.xy += uPointer * aSeed.z * vec2(0.5, 0.3);
    p.y += sin(uTime * 0.3 + aSeed.x * 6.28) * 0.15;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float tw = pow(max(0.0, sin(uTime * (0.8 + aSeed.y * 1.6) + aSeed.x * 50.0)), 6.0);
    gl_PointSize = (14.0 + aSeed.z * 34.0) * (0.3 + tw) * uDpr * (4.0 / max(0.5, -mv.z));
    vA = tw;
    vHue = aSeed.y;
    gl_Position = projectionMatrix * mv;
  }
`;

/** Low Resources: star glints twinkling over the Cycles layers. */
export function LoGlints({ variant }: { variant: Variant }) {
  const night = variant === "night";
  const geometry = useMemo(() => {
    const n = 70;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set([(Math.random() - 0.35) * 9, (Math.random() - 0.5) * 5, -2 - Math.random() * 3], i * 3);
      seed.set([Math.random(), Math.random(), Math.random()], i * 3);
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
    return g;
  }, []);
  const material = useMemo(() => {
    const [a, b, c] = PALETTE[variant];
    return new THREE.ShaderMaterial({
      vertexShader: glintVertex,
      fragmentShader: moteFragment,
      uniforms: {
        uTime: { value: 0 },
        uPointer: { value: new THREE.Vector2() },
        uDpr: { value: 1 },
        uA: { value: new THREE.Color(a) },
        uB: { value: new THREE.Color(b) },
        uC: { value: new THREE.Color(c) },
        uGain: { value: night ? 1.6 : 1.1 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, [variant, night]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame((state, dt) => {
    const u = material.uniforms;
    u.uTime.value += Math.min(dt, 0.05);
    u.uPointer.value.set(pointer.sx, pointer.sy);
    u.uDpr.value = state.gl.getPixelRatio();
  });
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={100} />;
}
