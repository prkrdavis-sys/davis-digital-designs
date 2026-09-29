"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";

const vertex = /* glsl */ `
  attribute vec3 aSeed;
  uniform float uTime;
  uniform float uProj;
  uniform vec3 uLight;
  varying float vA;
  void main() {
    vec3 p = position;
    float t = uTime * 0.04;
    p += vec3(sin(t + aSeed.x * 40.0), sin(t * 0.7 + aSeed.y * 30.0) * 0.6, cos(t * 0.8 + aSeed.z * 50.0)) * 0.6;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    // Motes only catch light inside the slanted window beam.
    vec3 rel = p - vec3(0.0, 1.2, 0.0);
    float along = dot(rel, uLight);
    float off = length(rel - uLight * along);
    float beam = 1.0 - smoothstep(2.2, 4.5, off);
    vA = beam * (0.25 + 0.75 * aSeed.x) * smoothstep(0.4, 1.5, depth);
    gl_PointSize = clamp((0.012 + aSeed.y * 0.02) * uProj / max(depth, 0.1), 1.0, 24.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = exp(-r * r * 4.0) * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
  }
`;

/** Dust drifting through the window light on the desk (day) or warm lamp haze (night). */
export function Motes({ variant }: { variant: Variant }) {
  const night = variant === "night";
  const geometry = useMemo(() => {
    const n = 420;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set([(Math.random() - 0.5) * 16, Math.random() * 7, (Math.random() - 0.5) * 14], i * 3);
      seed.set([Math.random(), Math.random(), Math.random()], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
    return g;
  }, []);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uProj: { value: 1000 },
      uLight: { value: new THREE.Vector3(-0.62, 0.42, -0.72).normalize() },
      uColor: { value: new THREE.Color(night ? "#9fb8ff" : "#ffd9a8").multiplyScalar(night ? 0.35 : 0.9) },
    }),
    [night],
  );
  useFrame((state, dt) => {
    uniforms.uTime.value += Math.min(dt, 0.05);
    const cam = state.camera as THREE.PerspectiveCamera;
    uniforms.uProj.value = (state.gl.getDrawingBufferSize(tmp).y * 0.5) / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
  });
  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={8}>
      <shaderMaterial vertexShader={vertex} fragmentShader={fragment} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

const tmp = new THREE.Vector2();
