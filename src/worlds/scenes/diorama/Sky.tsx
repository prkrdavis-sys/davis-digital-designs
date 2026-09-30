"use client";

import { useMemo, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const vertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const fragment = /* glsl */ `
  #define MAX_STOPS 8
  uniform vec3 uColors[MAX_STOPS];
  uniform float uStops[MAX_STOPS];
  uniform int uCount;
  uniform float uStars;
  uniform float uTime;
  varying vec3 vDir;

  float hash(vec3 p) { p = fract(p * vec3(443.897, 441.423, 437.195)); p += dot(p, p.yzx + 19.19); return fract((p.x + p.y) * p.z); }

  vec3 ramp(float t) {
    vec3 c = uColors[0];
    for (int i = 1; i < MAX_STOPS; i++) {
      if (i >= uCount) break;
      float a = uStops[i - 1];
      float b = uStops[i];
      c = mix(c, uColors[i], smoothstep(0.0, 1.0, clamp((t - a) / max(b - a, 1e-4), 0.0, 1.0)));
    }
    return c;
  }

  void main() {
    vec3 d = normalize(vDir);
    vec3 col = ramp(d.y * 0.5 + 0.5);
    if (uStars > 0.0 && d.y > 0.0) {
      vec3 g = d * 190.0;
      vec3 cell = floor(g);
      vec3 f = fract(g) - 0.5;
      float h = hash(cell);
      float star = step(0.968, h) * smoothstep(0.32, 0.0, length(f));
      float tw = 0.55 + 0.45 * sin(uTime * (1.0 + h * 3.0) + h * 40.0);
      col += vec3(0.92, 0.94, 1.0) * star * tw * uStars * smoothstep(0.02, 0.28, d.y) * (0.55 + 1.5 * fract(h * 17.0));
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Sunset / night gradient dome with optional twinkling stars. */
export function Sky({ stops, stars = 0, radius = 180 }: { stops: [number, string][]; stars?: number; radius?: number }) {
  const material = useMemo(() => {
    const colors = Array.from({ length: 8 }, (_, i) => new THREE.Color(stops[Math.min(i, stops.length - 1)][1]));
    const pos = Array.from({ length: 8 }, (_, i) => stops[Math.min(i, stops.length - 1)][0]);
    return new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uColors: { value: colors },
        uStops: { value: pos },
        uCount: { value: stops.length },
        uStars: { value: stars },
        uTime: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
  }, [stops, stars]);

  useFrame((_, dt) => {
    material.uniforms.uTime.value += Math.min(dt, 0.05);
  });

  return (
    <mesh material={material} renderOrder={-20} frustumCulled={false}>
      <sphereGeometry args={[radius, 48, 24]} />
    </mesh>
  );
}

export function FollowCamera({ children }: { children: ReactNode }) {
  const group = useMemo(() => new THREE.Group(), []);
  useFrame((state) => {
    group.position.copy(state.camera.position);
  });
  return <primitive object={group}>{children}</primitive>;
}
