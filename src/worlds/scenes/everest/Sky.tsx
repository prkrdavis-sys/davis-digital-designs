"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { HAZE_GLSL, LOOKS, hazeUniforms } from "@/worlds/scenes/everest/look";

const vertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * w;
    gl_Position.z = gl_Position.w * 0.99999; // on the far plane
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uKeyColor;
  uniform float uNight;
  uniform float uTime;
  varying vec3 vDir;
  ${HAZE_GLSL}

  float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 7.7; a *= 0.5; } return v; }

  /** One layer of stars on a 3D cell grid: sharp but anti-aliased points. */
  float stars(vec3 d, float cells, float density, float size) {
    vec3 p = d * cells;
    vec3 c = floor(p);
    float h = hash13(c);
    if (h > density) return 0.0;
    vec3 s = c + 0.5 + (vec3(hash13(c + 11.0), hash13(c + 23.0), hash13(c + 37.0)) - 0.5) * 0.7;
    float r = length(p - s);
    float fw = fwidth(r) * 1.2;
    float tw = 0.75 + 0.25 * sin(uTime * (1.5 + h * 9.0) + h * 40.0);
    return smoothstep(size + fw, size * 0.2, r) * (0.35 + 0.65 * hash13(c + 5.0)) * tw;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float mu = dot(d, uKey);
    vec3 col;
    if (uNight < 0.5) {
      // Thin high-altitude air: deep zenith, pale band at the horizon, warm toward the low sun.
      float t = pow(clamp(h, 0.0, 1.0), 0.33);
      col = mix(uHorizon, uZenith, t);
      col = mix(col, uHazeKey * 1.05, pow(max(mu, 0.0), 3.0) * (1.0 - t) * 0.75);
      col += uKeyColor * (pow(max(mu, 0.0), 12.0) * 0.55 + pow(max(mu, 0.0), 180.0) * 2.5);
      col += uKeyColor * smoothstep(0.99955, 0.9998, mu) * 30.0;
      // High cirrus streaks lit by the sun.
      vec2 q = d.xz / max(0.08, h + 0.06);
      float ci = fbm(q * vec2(0.9, 3.6) + vec2(uTime * 0.004, 0.0));
      ci = smoothstep(0.55, 0.85, ci) * smoothstep(0.02, 0.18, h) * (1.0 - smoothstep(0.55, 0.9, h));
      col = mix(col, mix(vec3(1.0), uKeyColor * 1.4, pow(max(mu, 0.0), 2.0)), ci * 0.35);
    } else {
      float t = pow(clamp(h, 0.0, 1.0), 0.5);
      col = mix(uHorizon, uZenith, t);
      // Milky Way: a soft band along a tilted great circle, with dust lanes.
      vec3 mwN = normalize(vec3(0.35, 0.42, 0.84));
      float band = exp(-pow(dot(d, mwN), 2.0) * 26.0);
      vec2 mq = vec2(atan(d.z, d.x) * 3.0, dot(d, mwN) * 12.0);
      float dust = fbm(mq * 1.7);
      float glow = band * (0.55 + 0.9 * fbm(mq * 0.8 + 3.0)) * (1.0 - smoothstep(0.5, 0.75, dust) * 0.7);
      col += vec3(0.32, 0.38, 0.6) * glow * 0.09 * smoothstep(0.0, 0.25, h);
      float s = stars(d, 180.0, 0.16, 0.09) + stars(d, 420.0, 0.22 + band * 0.25, 0.1) * 0.6;
      col += vec3(0.85, 0.9, 1.0) * s * 1.6 * smoothstep(-0.02, 0.12, h);
      // The moon, with a soft halo.
      float disc = smoothstep(0.99985, 0.99992, mu);
      float mare = fbm(d.xy * 900.0) * 0.35;
      col += vec3(1.0, 0.97, 0.9) * disc * (6.0 - mare * 6.0);
      col += uKeyColor * (pow(max(mu, 0.0), 60.0) * 0.18 + pow(max(mu, 0.0), 8.0) * 0.05);
    }
    // Below and at the horizon the sky meets the terrain haze.
    col = mix(inscatter(d), col, smoothstep(-0.04, 0.08, h));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function Sky({ variant }: { variant: Variant }) {
  const look = LOOKS[variant];
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uZenith: { value: new THREE.Color(look.zenith) },
          uHorizon: { value: new THREE.Color(look.horizon) },
          uKeyColor: { value: new THREE.Color(look.keyColor) },
          uNight: { value: variant === "night" ? 1 : 0 },
          uTime: { value: 0 },
          ...hazeUniforms(look),
        },
        side: THREE.BackSide,
        depthWrite: false,
      }),
    [look, variant],
  );
  const mesh = useMemo(() => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material);
    m.frustumCulled = false;
    m.renderOrder = -10;
    m.scale.setScalar(1000);
    return m;
  }, [material]);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      material.dispose();
    },
    [mesh, material],
  );
  // Follows the camera so it always sits at infinity.
  useFrame((state, dt) => {
    material.uniforms.uTime.value += Math.min(dt, 0.05);
    mesh.position.copy(state.camera.position);
  });
  return <primitive object={mesh} />;
}
