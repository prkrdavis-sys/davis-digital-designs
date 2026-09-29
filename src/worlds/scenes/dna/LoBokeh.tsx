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
    p.x += sin(uTime * 0.2 + aSeed.x * 6.28) * 0.6 + uPointer.x * aSeed.z * 0.8;
    p.y += cos(uTime * 0.17 + aSeed.y * 6.28) * 0.5 + uPointer.y * aSeed.z * 0.5 + mod(uTime * 0.15 * (0.3 + aSeed.z), 12.0) - 6.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (18.0 + aSeed.x * 60.0) * uDpr * (1.0 / max(0.5, -mv.z)) * 6.0;
    vA = 0.18 + aSeed.y * 0.35;
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
    float disc = smoothstep(1.0, 0.8, r) * 0.6 + smoothstep(0.65, 0.95, r) * smoothstep(1.0, 0.95, r) * 0.6;
    if (disc < 0.01) discard;
    gl_FragColor = vec4(mix(uA, uB, vHue), disc * vA);
  }
`;

/** Cheap floating bokeh discs over the Cycles layers in Low Resources mode. */
export function LoBokeh({ variant }: { variant: Variant }) {
  const night = variant === "night";
  const geo = useMemo(() => {
    const n = 90;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set([(Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6, -1.5 - Math.random() * 4], i * 3);
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
          uA: { value: new THREE.Color(night ? "#5da8ff" : "#ffffff") },
          uB: { value: new THREE.Color(night ? "#3dff9a" : "#f3dcff") },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: night ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    [night],
  );
  useFrame((state, dt) => {
    mat.uniforms.uTime.value += Math.min(dt, 0.05);
    mat.uniforms.uPointer.value.set(pointer.sx, pointer.sy);
    mat.uniforms.uDpr.value = state.gl.getPixelRatio();
  });
  return (
    <group position={[0, 0, 0]}>
      <points geometry={geo} material={mat} frustumCulled={false} renderOrder={100} />
    </group>
  );
}
