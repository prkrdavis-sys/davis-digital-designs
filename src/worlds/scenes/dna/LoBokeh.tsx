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
    p.x += sin(uTime * 0.2 + aSeed.x * 6.28) * 0.35 + uPointer.x * aSeed.z * 0.5;
    p.y += cos(uTime * 0.17 + aSeed.y * 6.28) * 0.3 + uPointer.y * aSeed.z * 0.3;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (10.0 + aSeed.x * 22.0) * uDpr * (1.0 / max(0.5, -mv.z)) * 5.0;
    vA = 0.12 + aSeed.y * 0.18;
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
    float bead = exp(-r * r * 4.5);
    if (bead < 0.02) discard;
    gl_FragColor = vec4(mix(uA, uB, vHue), bead * vA);
  }
`;

const SILHOUETTES: { position: [number, number, number]; scale: [number, number, number]; tint: number }[] = [
  { position: [-3.2, 0.6, -5.4], scale: [0.32, 0.32, 0.32], tint: 0 },
  { position: [3.4, -0.9, -6.8], scale: [0.16, 0.42, 0.16], tint: 1 },
  { position: [2.6, 1.1, -4.6], scale: [0.24, 0.24, 0.24], tint: 0 },
];

/** A few blue specks and silhouettes over the baked DNA cards. */
export function LoBokeh({ variant }: { variant: Variant }) {
  const night = variant === "night";
  const geo = useMemo(() => {
    const n = 36;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set([(Math.random() - 0.5) * 8, (Math.random() - 0.5) * 5, -2 - Math.random() * 4], i * 3);
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
          uA: { value: new THREE.Color(night ? "#6fb4ff" : "#c5e6f4") },
          uB: { value: new THREE.Color(night ? "#3ec6e0" : "#e7f6fb") },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: night ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    [night],
  );
  const sphere = useMemo(() => new THREE.SphereGeometry(1, 16, 12), []);
  const silhouettes = useMemo(() => {
    const colors = night ? ["#7ec8e8", "#ff8fb8"] : ["#d5eef6", "#d7a08a"];
    return colors.map(
      (color) =>
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: night ? 0.45 : 0.32,
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
