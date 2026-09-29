"use client";

import { useEffect, useMemo } from "react";
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
  void main() {
    vec3 p = position;
    float t = uTime * (0.04 + aSeed.z * 0.05);
    p.x += sin(uTime * 0.21 + aSeed.x * 6.28) * 0.35 + uPointer.x * aSeed.z * 0.25 + mod(t * 2.0, 8.0) - 4.0;
    p.y += cos(uTime * 0.17 + aSeed.y * 6.28) * 0.25 + uPointer.y * aSeed.z * 0.15 + sin(t * 3.0 + aSeed.x * 9.0) * 0.4;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (2.0 + aSeed.x * 5.0) * uDpr * (3.0 / max(0.5, -mv.z));
    float tw = 0.55 + 0.45 * sin(uTime * (1.0 + aSeed.y * 2.0) + aSeed.z * 20.0);
    vA = (0.25 + aSeed.y * 0.55) * tw;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float s = exp(-r * r * 4.0);
    if (s < 0.02) discard;
    gl_FragColor = vec4(uColor, s * vA);
  }
`;

/** A few live pollen and dust motes over the Cycles layers (Low Resources). */
export function LoMotes({ variant }: { variant: Variant }) {
  const night = variant === "night";
  const geo = useMemo(() => {
    const n = 140;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set([(Math.random() - 0.5) * 7, (Math.random() - 0.5) * 4, -1.2 - Math.random() * 3.5], i * 3);
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
          uColor: { value: new THREE.Color(night ? "#ffd89a" : "#fff3d6") },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [night],
  );
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  useFrame((state, dt) => {
    mat.uniforms.uTime.value += Math.min(dt, 0.05);
    mat.uniforms.uPointer.value.set(pointer.sx, pointer.sy);
    mat.uniforms.uDpr.value = state.gl.getPixelRatio();
  });
  return <points geometry={geo} material={mat} frustumCulled={false} renderOrder={100} />;
}
