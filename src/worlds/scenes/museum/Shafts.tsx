"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import type { MuseumLayout } from "@/worlds/scenes/museum/layout";

const vertex = /* glsl */ `
  attribute vec2 aFace;
  varying vec2 vFace;
  varying vec3 vWorld;
  void main() {
    vFace = aFace;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  varying vec2 vFace;
  varying vec3 vWorld;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uSun;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    // vFace.x runs across each side of the prism, vFace.y from the skylight (1) to the floor (0).
    float across = pow(sin(3.14159 * clamp(vFace.x, 0.0, 1.0)), 1.6);
    float along = smoothstep(0.0, 0.35, vFace.y) * (0.55 + 0.45 * vFace.y);
    // Slow streaks, as if the glazing bars and passing clouds break up the beam.
    float streak = noise(vec2(vFace.x * 9.0 + uTime * 0.05, vFace.y * 1.5)) * 0.6 + noise(vec2(vFace.x * 23.0 - uTime * 0.03, 3.0)) * 0.4;
    float a = across * along * (0.55 + 0.6 * streak) * uIntensity;
    // Beams read strongest when looking toward the light.
    vec3 v = normalize(vWorld - cameraPosition);
    a *= 0.6 + 0.8 * pow(max(dot(-v, uSun), 0.0), 2.0);
    gl_FragColor = vec4(uColor * a, a);
  }
`;

const LOOK: Record<Variant, { color: string; intensity: number }> = {
  day: { color: "#fff0d4", intensity: 0.11 },
  night: { color: "#a9bcff", intensity: 0.07 },
};

/** Soft god rays under the skylights: open prisms swept down the sun direction. */
export function Shafts({ layout, variant }: { layout: MuseumLayout; variant: Variant }) {
  const geometry = useMemo(() => {
    const sun = new THREE.Vector3(...layout.sun[variant]).normalize();
    const pos: number[] = [];
    const face: number[] = [];
    const idx: number[] = [];
    for (const s of layout.shafts) {
      const top = s.top.map((p) => new THREE.Vector3(...p));
      const bot = top.map((p) => p.clone().addScaledVector(sun, -p.y / Math.max(sun.y, 0.05)));
      for (let k = 0; k < 4; k++) {
        const a = top[k];
        const b = top[(k + 1) % 4];
        const c = bot[(k + 1) % 4];
        const d = bot[k];
        const base = pos.length / 3;
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
        face.push(0, 1, 1, 1, 1, 0, 0, 0);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aFace", new THREE.Float32BufferAttribute(face, 2));
    g.setIndex(idx);
    return g;
  }, [layout, variant]);

  const material = useMemo(() => {
    const l = LOOK[variant];
    return new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uColor: { value: new THREE.Color(l.color) },
        uTime: { value: 0 },
        uIntensity: { value: l.intensity },
        uSun: { value: new THREE.Vector3(...layout.sun[variant]).normalize() },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
  }, [variant, layout]);

  useFrame((_, dt) => {
    material.uniforms.uTime.value += Math.min(dt, 0.05);
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={8} />;
}
