"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
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
    vec3 p = position * uBox + vec3(sin(uTime * 0.3 + aSeed.x * 6.28), cos(uTime * 0.23 + aSeed.y * 6.28), sin(uTime * 0.27 + aSeed.z * 6.28)) * uBox * 0.015;
    p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    float coc = abs(depth - uFocus) / max(uFocus, 1e-3);
    vBlur = clamp(coc * 0.8, 0.0, 1.0);
    float size = (0.035 + aSeed.x * 0.06) * uScale;
    gl_PointSize = clamp(size / max(depth, 1e-3) * 700.0 * (1.0 + vBlur * 2.2), 1.0, 48.0) * uDpr;
    vAlpha = (1.0 - vBlur * 0.7) * smoothstep(0.0, 0.25 * uScale, depth) * (1.0 - smoothstep(uBox * 0.28, uBox * 0.48, depth));
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
    float bead = exp(-r * r * 5.0);
    vec3 col = mix(uCol1, uCol2, vHue);
    float a = bead * vAlpha * mix(0.22, 0.7, uNight);
    if (a < 0.004) discard;
    gl_FragColor = vec4(col * (uNight > 0.5 ? 1.8 : 1.0), a);
  }
`;

const plasmaVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const plasmaFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uNear;
  uniform vec3 uFar;
  uniform vec3 uGlow;
  uniform float uNight;
  varying vec3 vWorld;
  float hash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash(i);
    float n100 = hash(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash(i + vec3(1.0, 1.0, 1.0));
    float n00 = mix(n000, n100, f.x);
    float n10 = mix(n010, n110, f.x);
    float n01 = mix(n001, n101, f.x);
    float n11 = mix(n011, n111, f.x);
    return mix(mix(n00, n10, f.y), mix(n01, n11, f.y), f.z);
  }
  void main() {
    vec3 p = vWorld * 0.0035 + vec3(uTime * 0.018, uTime * 0.011, uTime * 0.007);
    float n = noise(p) * 0.62 + noise(p * 2.05 + 4.2) * 0.38;
    vec3 col = mix(uNear, uFar, smoothstep(0.12, 0.62, n));
    col += uGlow * smoothstep(0.55, 0.92, n) * mix(0.22, 0.7, uNight);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const CYTOSOL: Record<Variant, { fog: string; near: string; far: string; glow: string; hazeA: string; hazeB: string }> = {
  day: { fog: "#8ec4de", near: "#d4f0f8", far: "#3f8fba", glow: "#b7e7ff", hazeA: "#7eb8d6", hazeB: "#d4eef8" },
  night: { fog: "#071422", near: "#12304a", far: "#071422", glow: "#7ee0ff", hazeA: "#6fb4ff", hazeB: "#3ec6e0" },
};

/** How far the camera is from the helix axis, in nm. */
export function cameraSpan(cam: THREE.Vector3) {
  return Math.max(8, Math.hypot(cam.x, cam.z));
}

/** Fog thickens nearby when the camera is close, and opens up on the cellular pullback. */
export function fogDensity(dist: number) {
  return 1 / Math.max(260, dist * 1.2);
}

const COUNT = 380;

function Plasma({ variant }: { variant: Variant }) {
  const night = variant === "night";
  const pal = CYTOSOL[variant];
  const shell = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uNear: { value: new THREE.Color(pal.near) },
      uFar: { value: new THREE.Color(pal.far) },
      uGlow: { value: new THREE.Color(pal.glow) },
      uNight: { value: night ? 1 : 0 },
    }),
    [pal, night],
  );
  useFrame((state, dt) => {
    shell.current?.position.copy(state.camera.position);
    uniforms.uTime.value += Math.min(dt, 0.05);
  });
  return (
    <mesh ref={shell} frustumCulled={false} renderOrder={-20}>
      <sphereGeometry args={[40, 32, 24]} />
      <shaderMaterial
        vertexShader={plasmaVertex}
        fragmentShader={plasmaFragment}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}

/** Light blue plasma, plus a sparse protein haze that wraps the camera. */
export function Medium({ variant }: { variant: Variant }) {
  const scene = useThree((s) => s.scene);
  const pal = CYTOSOL[variant];
  const night = variant === "night";
  const color = useMemo(() => new THREE.Color(pal.near), [pal.near]);
  const fog = useMemo(() => new THREE.FogExp2(pal.fog, 0.008), [pal.fog]);

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
    const scale = Math.min(180, dist / 4);
    pUniforms.uCam.value.copy(cam.position);
    pUniforms.uBox.value = 40 * scale;
    pUniforms.uScale.value = scale;
    pUniforms.uFocus.value = dist;
    pUniforms.uTime.value += d;
    pUniforms.uDpr.value = state.gl.getPixelRatio();
  });

  return (
    <>
      <Plasma variant={variant} />
      <points geometry={geometry} frustumCulled={false} renderOrder={2}>
        <shaderMaterial
          vertexShader={pVertex}
          fragmentShader={pFragment}
          uniforms={pUniforms}
          transparent
          depthWrite={false}
          blending={night ? THREE.AdditiveBlending : THREE.NormalBlending}
        />
      </points>
    </>
  );
}
