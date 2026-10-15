"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { MonolithLayout } from "@/worlds/scenes/monolith/layout";
import { drive } from "@/worlds/scenes/monolith/drive";

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  varying vec2 vUv;
  uniform float uSpread;
  uniform float uGain;

  vec3 hue(float t) {
    return 0.55 + 0.45 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + t));
  }

  void main() {
    vec2 p = vUv - 0.5;
    // Local -Y is world +Z after the floor rotation, which is toward the camera.
    float ang = atan(p.y, p.x) + 1.570796;
    float dist = length(p);
    float wedge = 1.0 - smoothstep(uSpread * 0.35, uSpread, abs(ang));
    float body = smoothstep(0.04, 0.16, dist) * (1.0 - smoothstep(0.34, 0.5, dist));
    float band = clamp(ang / max(uSpread, 0.001) * 0.5 + 0.5, 0.0, 1.0);
    float a = wedge * body * uGain;
    gl_FragColor = vec4(hue(band) * a, a);
  }
`;

/** A fan of color on the floor, stood in for the dispersion a real prism would throw. */
export function Spectrum({ layout, night }: { layout: MonolithLayout; night: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uSpread: { value: 0.55 },
          uGain: { value: night ? 1.15 : 0.72 },
        },
      }),
    [night],
  );

  useFrame(() => {
    const meshNow = mesh.current;
    if (!meshNow) return;
    meshNow.rotation.set(-Math.PI / 2, 0, -drive.yaw);
    const spread = material.uniforms.uSpread;
    if (spread) spread.value = 0.42 + drive.split * 0.35;
  });

  const [x, , z] = layout.focus;
  return (
    <mesh ref={mesh} material={material} position={[x, 0.025, z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
      <planeGeometry args={[5.2, 5.2]} />
    </mesh>
  );
}
