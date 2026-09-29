"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { doorPalette, type DoorsLayout } from "@/worlds/scenes/doors/layout";
import type { DoorFx } from "@/worlds/scenes/doors/Doors";

const PER_DOOR = 160;

const vertex = /* glsl */ `
  attribute vec4 aSeed;
  attribute float aDoor;
  uniform vec3 uBase[5];
  uniform vec3 uInto[5];
  uniform vec3 uRight[5];
  uniform vec3 uColA[5];
  uniform vec3 uColB[5];
  uniform float uGlow[5];
  uniform float uTime;
  uniform float uW;
  uniform float uH;
  uniform float uDpr;
  varying vec3 vCol;
  varying float vA;
  void main() {
    int i = int(aDoor + 0.5);
    float speed = 0.12 + aSeed.w * 0.18;
    float t = fract(uTime * speed + aSeed.x);
    // Emitted across the opening, drifting out toward the visitor and settling to the floor.
    float x = (aSeed.y - 0.5) * 2.0 * uW * 0.9;
    float z = aSeed.z * (uH + uW * 0.8);
    vec3 p = uBase[i] + uRight[i] * x + vec3(0.0, z, 0.0);
    p -= uInto[i] * (t * (1.8 + aSeed.w * 2.2));
    p += uRight[i] * sin(t * 6.0 + aSeed.x * 20.0) * 0.25 * t;
    p.y += sin(t * 3.14159) * 0.35 - t * t * z * 0.35;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float glow = uGlow[i];
    gl_PointSize = clamp((0.035 + aSeed.w * 0.05) / max(-mv.z, 0.1) * 900.0, 1.0, 30.0) * uDpr;
    vA = sin(t * 3.14159) * smoothstep(0.25, 1.4, glow) * (0.35 + 0.65 * step(0.5, fract(aSeed.x * 7.0 + uTime * 0.7)));
    vCol = mix(uColA[i], uColB[i], aSeed.z) * (1.0 + glow);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  varying vec3 vCol;
  varying float vA;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float r = length(q) * 2.0;
    // Four-point sparkle over a soft core.
    float core = exp(-r * r * 6.0);
    float star = max(0.0, 1.0 - abs(q.x * q.y) * 90.0) * (1.0 - r);
    float a = (core + star * 0.6) * vA;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vCol * a, a);
  }
`;

/** Sparks of each world pouring out of its portal; a trickle always, a flood on hover. */
export function Spill({ layout, fx, variant }: { layout: DoorsLayout; fx: DoorFx; variant: Variant }) {
  const n = layout.doors.length;
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const count = n * PER_DOOR;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    const door = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
      door[i] = Math.floor(i / PER_DOOR);
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    g.setAttribute("aDoor", new THREE.BufferAttribute(door, 1));
    return g;
  }, [n]);

  const material = useMemo(() => {
    const v3 = (f: (i: number) => THREE.Vector3 | THREE.Color) => Array.from({ length: 5 }, (_, i) => (i < n ? f(i) : new THREE.Vector3()));
    return new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uBase: { value: v3((i) => new THREE.Vector3(...layout.doors[i].base).addScaledVector(new THREE.Vector3(...layout.doors[i].into), layout.portalY)) },
        uInto: { value: v3((i) => new THREE.Vector3(...layout.doors[i].into)) },
        uRight: { value: v3((i) => new THREE.Vector3(...layout.doors[i].right)) },
        uColA: { value: v3((i) => new THREE.Color(doorPalette(layout.doors[i].id, variant)[0])) },
        uColB: { value: v3((i) => new THREE.Color(doorPalette(layout.doors[i].id, variant)[2])) },
        uGlow: { value: new Array(5).fill(0) },
        uTime: { value: 0 },
        uW: { value: layout.w },
        uH: { value: layout.h },
        uDpr: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, [layout, variant, n]);

  useFrame((state, dt) => {
    const u = material.uniforms;
    u.uTime.value += Math.min(dt, 0.05);
    u.uDpr.value = state.gl.getPixelRatio();
    for (let i = 0; i < n; i++) u.uGlow.value[i] = fx.glow[i];
  });

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={12} />;
}
