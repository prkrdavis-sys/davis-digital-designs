"use client";

import { useLayoutEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";

const pVertex = /* glsl */ `
  attribute vec3 aSeed;
  uniform vec3 uCam;
  uniform float uBox;
  uniform float uTime;
  uniform float uFocus;
  uniform float uDpr;
  uniform float uScale;
  varying float vAlpha;
  varying float vBlur;
  varying float vHue;
  void main() {
    vec3 p = position * uBox + vec3(sin(uTime * 0.3 + aSeed.x * 6.28), cos(uTime * 0.23 + aSeed.y * 6.28), sin(uTime * 0.27 + aSeed.z * 6.28)) * uBox * 0.02;
    p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    float coc = abs(depth - uFocus) / max(uFocus, 1e-3);
    vBlur = clamp(coc * 0.8, 0.0, 1.0);
    float size = (0.04 + aSeed.x * 0.09) * uScale;
    gl_PointSize = clamp(size / max(depth, 1e-3) * 900.0 * (1.0 + vBlur * 3.0), 1.0, 72.0) * uDpr;
    vAlpha = (1.0 - vBlur * 0.75) * smoothstep(0.0, 0.2 * uScale, depth) * (1.0 - smoothstep(uBox * 0.35, uBox * 0.5, depth));
    vHue = aSeed.y;
    gl_Position = projectionMatrix * mv;
  }
`;

const pFragment = /* glsl */ `
  uniform vec3 uCol1;
  uniform vec3 uCol2;
  uniform float uNight;
  varying float vAlpha;
  varying float vBlur;
  varying float vHue;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float r = length(q) * 2.0;
    float disc = smoothstep(1.0, 0.85, r);
    float bead = exp(-r * r * 4.0);
    float rim = smoothstep(0.7, 0.95, r) * disc;
    float shape = mix(bead, disc * 0.45 + rim * 0.5, vBlur);
    vec3 col = mix(uCol1, uCol2, vHue);
    float a = shape * vAlpha * mix(0.32, 0.85, uNight);
    if (a < 0.004) discard;
    gl_FragColor = vec4(col * (uNight > 0.5 ? 2.0 : 1.0), a);
  }
`;

export const CYTOSOL: Record<Variant, { fog: string; hazeA: string; hazeB: string }> = {
  day: { fog: "#e4eef0", hazeA: "#cbb8c2", hazeB: "#f0ddd8" },
  night: { fog: "#050814", hazeA: "#6fb4ff", hazeB: "#3dff9a" },
};

/** How far the camera is from the helix axis, in nm. */
export function cameraSpan(cam: THREE.Vector3) {
  return Math.max(8, Math.hypot(cam.x, cam.z));
}

/** Fog thickens nearby when the camera is close, and opens up on the cellular pullback. */
export function fogDensity(dist: number) {
  return 1 / Math.max(220, dist * 1.15);
}

const COUNT = 1100;

/** Watery cytosol: exponential fog plus a protein haze that wraps the camera. */
export function Medium({ variant }: { variant: Variant }) {
  const scene = useThree((s) => s.scene);
  const pal = CYTOSOL[variant];
  const night = variant === "night";
  const color = useMemo(() => new THREE.Color(pal.fog), [pal.fog]);
  const fog = useMemo(() => new THREE.FogExp2(color, 0.01), [color]);

  useLayoutEffect(() => {
    const prevBg = scene.background;
    const prevFog = scene.fog;
    scene.background = color;
    scene.fog = fog;
    return () => {
      scene.background = prevBg;
      scene.fog = prevFog;
    };
  }, [scene, color, fog]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    const seed = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      pos.set([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5], i * 3);
      seed.set([Math.random(), Math.random(), Math.random()], i * 3);
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
    return g;
  }, []);

  const pUniforms = useMemo(
    () => ({
      uCam: { value: new THREE.Vector3() },
      uBox: { value: 30 },
      uTime: { value: 0 },
      uFocus: { value: 4 },
      uDpr: { value: 1 },
      uScale: { value: 1 },
      uCol1: { value: new THREE.Color(pal.hazeA) },
      uCol2: { value: new THREE.Color(pal.hazeB) },
      uNight: { value: night ? 1 : 0 },
    }),
    [pal, night],
  );

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    const cam = state.camera;
    const dist = cameraSpan(cam.position);
    fog.density = fogDensity(dist);
    const scale = Math.min(200, dist / 4);
    pUniforms.uCam.value.copy(cam.position);
    pUniforms.uBox.value = 34 * scale;
    pUniforms.uScale.value = scale;
    pUniforms.uFocus.value = dist;
    pUniforms.uTime.value += d;
    pUniforms.uDpr.value = state.gl.getPixelRatio();
  });

  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={4}>
      <shaderMaterial
        vertexShader={pVertex}
        fragmentShader={pFragment}
        uniforms={pUniforms}
        transparent
        depthWrite={false}
        blending={night ? THREE.AdditiveBlending : THREE.NormalBlending}
      />
    </points>
  );
}
