"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { pointer } from "@/lib/store";
import { useSceneTime } from "@/components/three/engine/slot";

const vertex = /* glsl */ `
  attribute vec3 aSeed;
  uniform float uTime;
  uniform float uSwirl;
  uniform vec2 uPointer;
  uniform float uDpr;
  varying float vA;
  void main() {
    vec3 p = position;
    float fall = uTime * (0.12 + aSeed.x * 0.18);
    p.y = mod(p.y - fall + 4.0, 8.0) - 4.0;
    p.x += sin(uTime * 0.5 + aSeed.y * 30.0) * 0.25 + sin(uTime * 2.0 + aSeed.z * 6.28) * uSwirl * 0.5 + uPointer.x * aSeed.z * 0.3;
    p.z += cos(uTime * 0.4 + aSeed.x * 20.0) * 0.1;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (2.0 + aSeed.y * 5.0) * uDpr * (3.0 / max(0.6, -mv.z));
    vA = 0.35 + aSeed.x * 0.55;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = exp(-r * r * 3.0) * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

/** Live snowflakes drifting over the Cycles layers in Low Resources mode. */
export function LoSnow({ variant }: { variant: Variant }) {
  const time = useSceneTime();
  const geometry = useMemo(() => {
    const n = 260;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set([(Math.random() - 0.5) * 9, (Math.random() - 0.5) * 8, -1.2 - Math.random() * 5], i * 3);
      seed.set([Math.random(), Math.random(), Math.random()], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uTime: { value: 0 },
          uSwirl: { value: 0 },
          uPointer: { value: new THREE.Vector2() },
          uDpr: { value: 1 },
          uColor: { value: new THREE.Color(variant === "night" ? "#dbe6ff" : "#ffffff") },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [variant],
  );
  useFrame((state, dt) => {
    const u = mat.uniforms;
    u.uTime.value += Math.min(dt, 0.05);
    const want = Math.min(1, Math.abs(time.velocity) * 2);
    u.uSwirl.value += (want - u.uSwirl.value) * (1 - Math.exp(-Math.min(dt, 0.05) * 2));
    u.uPointer.value.set(pointer.sx, pointer.sy);
    u.uDpr.value = state.gl.getPixelRatio();
  });
  return <points geometry={geometry} material={mat} frustumCulled={false} renderOrder={100} />;
}
