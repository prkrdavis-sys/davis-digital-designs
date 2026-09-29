"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";

const vertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
    vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + vDir * 500.0, 1.0);
    gl_Position = p.xyww;
  }
`;

const fragment = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uHorizon;
  uniform vec3 uMid;
  uniform vec3 uZenith;
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform float uNight;
  uniform float uTime;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 6; i++) { v += a * noise(p); p = p * 2.02 + 1.7; a *= 0.5; } return v; }
  void main() {
    vec3 d = normalize(vDir);
    // Symmetric in elevation, so the floor mirror shows a believable sky.
    float el = abs(d.y);
    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.18, el));
    col = mix(col, uZenith, smoothstep(0.15, 0.85, el));
    float s = max(dot(d * vec3(1.0, sign(d.y), 1.0), uSunDir), 0.0);
    if (uNight < 0.5) {
      // Soft cumulus drifting over the colonnade.
      vec2 q = d.xz / (el + 0.12) * 0.9 + vec2(uTime * 0.004, 0.0);
      float c = smoothstep(0.52, 0.8, fbm(q));
      vec3 cloud = mix(vec3(1.0, 0.94, 0.96), uHorizon * 1.1, 0.35);
      col = mix(col, cloud, c * smoothstep(0.02, 0.25, el) * 0.8);
      col += uSunCol * (pow(s, 12.0) * 0.35 + pow(s, 400.0) * 3.0);
    } else {
      vec2 sq = floor(vec2(atan(d.x, d.z) * 180.0, d.y * 320.0));
      float h = hash(sq);
      float tw = 0.65 + 0.35 * sin(uTime * (1.0 + h * 3.0) + h * 50.0);
      col += step(0.994, h) * tw * smoothstep(0.03, 0.3, el) * vec3(0.85, 0.9, 1.0) * 1.4;
      float neb = fbm(d.xz * 2.5 / (el + 0.3));
      col += vec3(0.25, 0.18, 0.5) * smoothstep(0.55, 0.9, neb) * 0.25 * smoothstep(0.1, 0.6, el);
      // Moon: bright disc with a wide halo.
      float disc = smoothstep(0.99955, 0.9997, s);
      float mare = fbm(d.xy * 400.0) * 0.25;
      col += uSunCol * (disc * (2.8 - mare * 2.0) + pow(s, 60.0) * 0.35 + pow(s, 6.0) * 0.08);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

const SKY: Record<Variant, { horizon: string; mid: string; zenith: string; sunCol: string; sunDir: [number, number, number] }> = {
  day: { horizon: "#ffc2d8", mid: "#e2c2ee", zenith: "#7e9df2", sunCol: "#fff0dc", sunDir: [-0.78, 0.55, 0.3] },
  night: { horizon: "#1c2150", mid: "#10143a", zenith: "#03040f", sunCol: "#dfe8ff", sunDir: [-0.3, 0.52, -0.8] },
};

/** Sky dome drawn at infinity behind everything. */
export function Sky({ variant, palette = SKY[variant] }: { variant: Variant; palette?: (typeof SKY)["day"] }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uHorizon: { value: new THREE.Color(palette.horizon) },
          uMid: { value: new THREE.Color(palette.mid) },
          uZenith: { value: new THREE.Color(palette.zenith) },
          uSunDir: { value: new THREE.Vector3(...palette.sunDir).normalize() },
          uSunCol: { value: new THREE.Color(palette.sunCol) },
          uNight: { value: variant === "night" ? 1 : 0 },
          uTime: { value: 0 },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    [palette, variant],
  );
  useFrame((_, dt) => {
    material.uniforms.uTime.value += Math.min(dt, 0.05);
  });
  return (
    <mesh material={material} frustumCulled={false} renderOrder={-100}>
      <sphereGeometry args={[1, 48, 24]} />
    </mesh>
  );
}

export { SKY };
