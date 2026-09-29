"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { pointer } from "@/lib/store";
import { useSceneTime } from "@/components/three/engine/slot";

const bgVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`;

const bgFragment = /* glsl */ `
  varying vec2 vUv;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  uniform float uTime;
  uniform float uS;
  uniform vec2 uPointer;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; } return v; }
  void main() {
    vec2 uv = vUv + uPointer * 0.01;
    // Cytoplasm: slow, soft, layered density.
    float n = fbm(uv * 2.2 + vec2(uTime * 0.01, uS * 0.35));
    float n2 = fbm(uv * 5.0 - vec2(uS * 0.2, uTime * 0.015));
    float r = length((vUv - vec2(0.62, 0.45)) * vec2(1.4, 1.0));
    vec3 col = mix(uA, uB, smoothstep(0.1, 1.1, r + n * 0.35));
    col = mix(col, uC, smoothstep(0.55, 0.95, n2) * 0.35);
    gl_FragColor = vec4(col, 1.0);
  }
`;

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
    // Particles live in a box that wraps around the camera, so there is always depth to fly through.
    vec3 p = position * uBox + vec3(sin(uTime * 0.3 + aSeed.x * 6.28), cos(uTime * 0.23 + aSeed.y * 6.28), sin(uTime * 0.27 + aSeed.z * 6.28)) * uBox * 0.02;
    p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    float coc = abs(depth - uFocus) / max(uFocus, 1e-3);
    vBlur = clamp(coc * 0.8, 0.0, 1.0);
    float size = (0.05 + aSeed.x * 0.12) * uScale;
    gl_PointSize = clamp(size / max(depth, 1e-3) * 900.0 * (1.0 + vBlur * 3.0), 1.0, 90.0) * uDpr;
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
    // Out-of-focus particles become flat bokeh discs with a bright rim; in-focus ones are soft beads.
    float disc = smoothstep(1.0, 0.85, r);
    float bead = exp(-r * r * 4.0);
    float rim = smoothstep(0.7, 0.95, r) * disc;
    float shape = mix(bead, disc * 0.45 + rim * 0.5, vBlur);
    vec3 col = mix(uCol1, uCol2, vHue);
    float a = shape * vAlpha * mix(0.55, 0.9, uNight);
    if (a < 0.004) discard;
    gl_FragColor = vec4(col * (uNight > 0.5 ? 2.0 : 1.0), a);
  }
`;

const MEDIUM: Record<Variant, { bg: [string, string, string]; p1: string; p2: string }> = {
  day: { bg: ["#fbf3ea", "#d9cbe3", "#ffe9dc"], p1: "#ffffff", p2: "#f1ddf7" },
  night: { bg: ["#050a1c", "#010208", "#0b1a3a"], p1: "#6fb4ff", p2: "#3dff9a" },
};

const COUNT = 1400;

/** The cytoplasm: soft backdrop, drifting bokeh particles, depth haze. */
export function Medium({ variant }: { variant: Variant }) {
  const time = useSceneTime();
  const bg = useRef<THREE.ShaderMaterial>(null);
  const pts = useRef<THREE.ShaderMaterial>(null);
  const pal = MEDIUM[variant];

  const bgUniforms = useMemo(
    () => ({
      uA: { value: new THREE.Color(pal.bg[0]) },
      uB: { value: new THREE.Color(pal.bg[1]) },
      uC: { value: new THREE.Color(pal.bg[2]) },
      uTime: { value: 0 },
      uS: { value: 0 },
      uPointer: { value: new THREE.Vector2() },
    }),
    [pal],
  );

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
      uCol1: { value: new THREE.Color(pal.p1) },
      uCol2: { value: new THREE.Color(pal.p2) },
      uNight: { value: variant === "night" ? 1 : 0 },
    }),
    [pal, variant],
  );

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    bgUniforms.uTime.value += d;
    bgUniforms.uS.value = time.s;
    bgUniforms.uPointer.value.set(pointer.sx, pointer.sy);
    const cam = state.camera;
    // Particle box scales with how far we are from the molecule (molecular -> cellular).
    const dist = Math.max(3, Math.hypot(cam.position.x, cam.position.z));
    const scale = Math.min(200, dist / 4);
    pUniforms.uCam.value.copy(cam.position);
    pUniforms.uBox.value = 34 * scale;
    pUniforms.uScale.value = scale;
    pUniforms.uFocus.value = dist;
    pUniforms.uTime.value += d;
    pUniforms.uDpr.value = state.gl.getPixelRatio();
  });

  return (
    <>
      <mesh frustumCulled={false} renderOrder={-10}>
        <planeGeometry args={[2, 2]} />
        <shaderMaterial ref={bg} vertexShader={bgVertex} fragmentShader={bgFragment} uniforms={bgUniforms} depthWrite={false} depthTest={false} />
      </mesh>
      <points geometry={geometry} frustumCulled={false} renderOrder={5}>
        <shaderMaterial
          ref={pts}
          vertexShader={pVertex}
          fragmentShader={pFragment}
          uniforms={pUniforms}
          transparent
          depthWrite={false}
          blending={variant === "night" ? THREE.AdditiveBlending : THREE.NormalBlending}
        />
      </points>
    </>
  );
}

export { MEDIUM };
