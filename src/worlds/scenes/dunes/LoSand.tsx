"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { pointer } from "@/lib/store";

const vertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uPx;
  uniform vec2 uPointer;
  varying float vA;
  varying float vStretch;
  void main() {
    float speed = 3.0 + 5.0 * aSeed.x;
    float span = 26.0;
    vec3 p = position;
    p.x = mod(position.x + uTime * speed + span * 0.5, span) - span * 0.5;
    p.y += sin(uTime * (0.8 + aSeed.y) + aSeed.z * 30.0) * 0.12 + uPointer.y * 0.15 * aSeed.z;
    p.x += uPointer.x * 0.3 * aSeed.z;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float size = (0.02 + 0.03 * aSeed.w) * uPx * projectionMatrix[1][1] * 0.5 / -mv.z;
    float streak = speed * 0.07 * uPx * projectionMatrix[1][1] * 0.5 / -mv.z;
    gl_PointSize = clamp(size + streak, 1.0, 96.0);
    vStretch = clamp((size + streak) / max(size, 0.6), 1.0, 12.0);
    // Gusts sweep across the frame; edges fade so the wrap is never seen.
    float gust = smoothstep(0.3, 0.9, sin(uTime * 0.45 + position.x * 0.12 + aSeed.y * 2.0) * 0.5 + 0.5);
    float edge = 1.0 - smoothstep(0.75, 1.0, abs(p.x) / (span * 0.5));
    vA = (0.18 + 0.4 * aSeed.y) * gust * edge * clamp(size / 0.8, 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  varying float vStretch;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    q.y *= vStretch;
    float r = dot(q, q);
    float m = exp(-r * 3.0) * smoothstep(1.0, 0.7, r);
    if (m * vA < 0.004) discard;
    gl_FragColor = vec4(uColor, m * vA);
  }
`;

/** Wind-blown sand skimming past the camera over the Low Resources layers. */
export function LoSand({ variant }: { variant: Variant }) {
  const night = variant === "night";
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const group = useRef<THREE.Group>(null);

  const geometry = useMemo(() => {
    const n = 1400;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const z = -2 - Math.random() * 12;
      // Mostly low in the frame, where the sand is.
      pos.set([(Math.random() - 0.5) * 26, -0.25 * -z * (0.2 + Math.random() * 0.9), z], i * 3);
      seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    return g;
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uTime: { value: 0 },
          uPx: { value: 1000 },
          uPointer: { value: new THREE.Vector2() },
          uColor: { value: new THREE.Color(night ? "#b9c8ff" : "#ffe2b8") },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: night ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    [night],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame((state, dt) => {
    material.uniforms.uTime.value += Math.min(dt, 0.05);
    material.uniforms.uPx.value = size.height * state.gl.getPixelRatio();
    material.uniforms.uPointer.value.set(pointer.sx, pointer.sy);
    group.current?.position.copy(camera.position);
  });

  return (
    <group ref={group}>
      <points geometry={geometry} material={material} frustumCulled={false} renderOrder={100} />
    </group>
  );
}
