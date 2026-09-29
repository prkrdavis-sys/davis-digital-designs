"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { pointer } from "@/lib/store";
import { useLook, useSceneTime } from "@/components/three/engine/slot";
import type { SceneComponentProps } from "@/worlds/types";

const fragment = /* glsl */ `
  varying vec2 vUv;
  uniform vec3 uA; uniform vec3 uB; uniform vec3 uC;
  uniform float uTime; uniform float uS; uniform vec2 uPointer;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    vec2 uv = vUv + uPointer * 0.02;
    float n = noise(uv * 3.0 + vec2(uTime * 0.05, uS * 0.6)) * 0.5 + noise(uv * 7.0 - uTime * 0.03) * 0.25;
    vec3 col = mix(uA, uB, smoothstep(0.0, 1.0, uv.y + n * 0.4 - 0.2));
    col = mix(col, uC, smoothstep(0.55, 1.0, n + uv.x * 0.3));
    gl_FragColor = vec4(col * 1.1, 1.0);
  }
`;

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.999, 1.0); }
`;

/** Soft animated gradient in the world's colors, shown until the real scene is built. */
export function Placeholder({ colors, variant }: SceneComponentProps & { colors: Record<"day" | "night", [string, string, string]> }) {
  useLook({ exposure: 1, tone: "neutral", seam: colors[variant][0] });
  const time = useSceneTime();
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uA: { value: new THREE.Color() },
      uB: { value: new THREE.Color() },
      uC: { value: new THREE.Color() },
      uTime: { value: 0 },
      uS: { value: 0 },
      uPointer: { value: new THREE.Vector2() },
    }),
    [],
  );
  useFrame((_, dt) => {
    const u = mat.current?.uniforms;
    if (!u) return;
    const [a, b, c] = colors[variant];
    const dim = variant === "night" ? 0.35 : 1;
    u.uA.value.set(a).multiplyScalar(dim);
    u.uB.value.set(b).multiplyScalar(dim);
    u.uC.value.set(c).multiplyScalar(dim);
    u.uTime.value += dt;
    u.uS.value = time.s;
    u.uPointer.value.set(pointer.sx, pointer.sy);
  });
  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial ref={mat} vertexShader={vertex} fragmentShader={fragment} uniforms={uniforms} depthWrite={false} />
    </mesh>
  );
}
