"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { pointer } from "@/lib/store";

const vertex = /* glsl */ `
  attribute vec3 aSeed;
  uniform float uTime;
  uniform vec2 uPointer;
  uniform float uDpr;
  varying float vA;
  varying float vHue;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.22 + aSeed.x * 6.28) * 0.35 + uPointer.x * aSeed.z * 0.4;
    p.y += cos(uTime * 0.16 + aSeed.y * 6.28) * 0.22 + uPointer.y * aSeed.z * 0.25;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (10.0 + aSeed.x * 28.0) * uDpr * (1.0 / max(0.6, -mv.z));
    vA = 0.16 + aSeed.y * 0.28;
    vHue = aSeed.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uA;
  uniform vec3 uB;
  varying float vA;
  varying float vHue;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float disc = exp(-r * r * 6.0);
    if (disc < 0.02) discard;
    gl_FragColor = vec4(mix(uA, uB, vHue), disc * vA);
  }
`;

/** Cheap sparkles over the Cycles layers. Dust, not fireflies. */
export function LoSparkle({ variant }: { variant: Variant }) {
  const night = variant === "night";
  const geo = useMemo(() => {
    const n = 70;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set([(Math.random() - 0.5) * 8, (Math.random() - 0.5) * 4, -1.2 - Math.random() * 5], i * 3);
      seed.set([Math.random(), Math.random(), Math.random()], i * 3);
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uTime: { value: 0 },
          uPointer: { value: new THREE.Vector2() },
          uDpr: { value: 1 },
          uA: { value: new THREE.Color(night ? "#d8e6ff" : "#fff6e4") },
          uB: { value: new THREE.Color(night ? "#ffc4e4" : "#ffd4c8") },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [night],
  );
  useFrame((state, dt) => {
    mat.uniforms.uTime.value += Math.min(dt, 0.05);
    mat.uniforms.uPointer.value.set(pointer.sx, pointer.sy);
    mat.uniforms.uDpr.value = state.gl.getPixelRatio();
  });
  return (
    <points geometry={geo} material={mat} frustumCulled={false} renderOrder={100} />
  );
}
