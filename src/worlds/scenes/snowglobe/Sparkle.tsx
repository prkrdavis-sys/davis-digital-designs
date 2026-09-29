"use client";

import { use, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { loadSparkle } from "@/worlds/scenes/snowglobe/data";

const vertex = /* glsl */ `
  attribute vec3 aNormal;
  attribute float aSeed;
  uniform float uTime;
  uniform float uProj;
  uniform vec3 uLight;
  varying float vGlint;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 v = normalize(cameraPosition - world.xyz);
    // Each ice crystal has its own facet normal; it flashes when the facet mirrors the light into the eye.
    vec3 facet = normalize(aNormal + (vec3(fract(aSeed * 13.1), fract(aSeed * 71.7), fract(aSeed * 37.3)) - 0.5) * 1.6);
    vec3 h = normalize(uLight + v);
    float spec = pow(max(dot(facet, h), 0.0), 180.0);
    float twinkle = 0.6 + 0.4 * sin(uTime * (3.0 + aSeed * 6.0) + aSeed * 50.0);
    vGlint = spec * twinkle;
    vec4 mv = viewMatrix * world;
    float depth = -mv.z;
    gl_PointSize = clamp(0.0016 * uProj / max(depth, 1e-3), 1.0, 6.0) * (0.6 + vGlint * 1.8);
    if (vGlint < 0.02) gl_PointSize = 0.0;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vGlint;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float r = length(q) * 2.0;
    float star = exp(-r * r * 6.0) + exp(-abs(q.x) * 40.0) * exp(-abs(q.y) * 6.0) * 0.5 + exp(-abs(q.y) * 40.0) * exp(-abs(q.x) * 6.0) * 0.5;
    float a = star * min(vGlint, 1.5);
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
  }
`;

/** Glints on the snow drifts: crystals that flash as the camera moves past. */
export function Sparkle({ variant }: { variant: Variant }) {
  const data = use(loadSparkle());
  const night = variant === "night";
  const geometry = useMemo(() => {
    const n = Math.floor(data.length / 6);
    const pos = new Float32Array(n * 3);
    const nrm = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos.set(data.subarray(i * 6, i * 6 + 3), i * 3);
      nrm.set(data.subarray(i * 6 + 3, i * 6 + 6), i * 3);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aNormal", new THREE.BufferAttribute(nrm, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    return g;
  }, [data]);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uProj: { value: 1000 },
      // Day: the window light from back-left; night: the moon through the same window.
      uLight: { value: new THREE.Vector3(-0.62, 0.42, -0.72).normalize() },
      uColor: { value: new THREE.Color(night ? "#bcd6ff" : "#fffaf0").multiplyScalar(night ? 5 : 4) },
    }),
    [night],
  );
  useFrame((state, dt) => {
    uniforms.uTime.value += Math.min(dt, 0.05);
    const cam = state.camera as THREE.PerspectiveCamera;
    uniforms.uProj.value = (state.gl.getDrawingBufferSize(tmp).y * 0.5) / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
  });
  if (!geometry.attributes.position.count) return null;
  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={7}>
      <shaderMaterial vertexShader={vertex} fragmentShader={fragment} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

const tmp = new THREE.Vector2();
