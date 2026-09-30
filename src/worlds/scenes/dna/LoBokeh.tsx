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
    gl_PointSize = (14.0 + aSeed.x * 42.0) * uDpr * (1.0 / max(0.5, -mv.z)) * 6.0;
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
    float disc = smoothstep(1.0, 0.8, r) * 0.55 + smoothstep(0.65, 0.95, r) * smoothstep(1.0, 0.95, r) * 0.55;
    if (disc < 0.01) discard;
    gl_FragColor = vec4(mix(uA, uB, vHue), disc * vA);
  }
`;

const SILHOUETTES: { position: [number, number, number]; scale: [number, number, number]; tint: number }[] = [
  { position: [-3.4, 1.1, -4.2], scale: [0.42, 0.42, 0.42], tint: 0 },
  { position: [3.6, -0.8, -5.5], scale: [0.28, 0.28, 0.28], tint: 0 },
  { position: [-2.2, -1.4, -7.2], scale: [0.22, 0.55, 0.22], tint: 1 },
  { position: [2.8, 1.3, -8.4], scale: [0.18, 0.48, 0.18], tint: 1 },
  { position: [-3.8, 0.2, -6.1], scale: [0.9, 0.08, 0.55], tint: 2 },
  { position: [3.2, -1.6, -3.6], scale: [0.34, 0.34, 0.34], tint: 3 },
];

/** Protein haze and a few organelle silhouettes over the baked DNA cards. */
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
          uA: { value: new THREE.Color(night ? "#5da8ff" : "#d7c4cc") },
          uB: { value: new THREE.Color(night ? "#3dff9a" : "#f0ddd6") },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: night ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    [night],
  );
  const sphere = useMemo(() => new THREE.SphereGeometry(1, 18, 12), []);
  const silhouettes = useMemo(() => {
    const colors = night ? ["#5aa7ff", "#ff5fa0", "#9ee7ff", "#3dff9a"] : ["#e7cdd8", "#e4d0c0", "#d5e6f0", "#f3e0d8"];
    return colors.map(
      (color) =>
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: night ? 0.5 : 0.38,
          depthTest: false,
          depthWrite: false,
        }),
    );
  }, [night]);
  useFrame((state, dt) => {
    mat.uniforms.uTime.value += Math.min(dt, 0.05);
    mat.uniforms.uPointer.value.set(pointer.sx, pointer.sy);
    mat.uniforms.uDpr.value = state.gl.getPixelRatio();
  });
  return (
    <group>
      <points geometry={geo} material={mat} frustumCulled={false} renderOrder={100} />
      {SILHOUETTES.map((s, i) => (
        <mesh key={i} geometry={sphere} material={silhouettes[s.tint]} position={s.position} scale={s.scale} frustumCulled={false} renderOrder={90} />
      ))}
    </group>
  );
}
