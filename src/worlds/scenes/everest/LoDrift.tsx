"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { pointer } from "@/lib/store";

const vertex = /* glsl */ `
  attribute vec3 aSeed;
  uniform float uTime;
  uniform vec2 uPointer;
  uniform float uDpr;
  varying float vA;
  varying float vBig;
  void main() {
    vec3 p = position;
    // Spindrift blowing left to right across the view, a little parallax with the pointer.
    p.x = mod(p.x + uTime * (0.25 + aSeed.x * 0.5) + 6.0, 12.0) - 6.0 + uPointer.x * aSeed.z * 0.4;
    p.y += sin(uTime * 0.6 + aSeed.y * 6.28) * 0.15 + uPointer.y * aSeed.z * 0.25;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vBig = step(0.93, aSeed.y);
    gl_PointSize = (vBig > 0.5 ? 40.0 + aSeed.x * 50.0 : 2.0 + aSeed.x * 3.5) * uDpr * (3.0 / max(0.5, -mv.z));
    vA = vBig > 0.5 ? 0.06 + aSeed.z * 0.08 : 0.35 + aSeed.z * 0.5;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  varying float vBig;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = (vBig > 0.5 ? exp(-r * r * 2.5) : exp(-r * r * 6.0)) * vA;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

/** Cheap live spindrift and soft cloud wisps over the Cycles layers in Low Resources mode. */
export function LoDrift({ variant }: { variant: Variant }) {
  const night = variant === "night";
  const geometry = useMemo(() => {
    const n = 160;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set([(Math.random() - 0.5) * 12, (Math.random() - 0.5) * 6, -1.5 - Math.random() * 4], i * 3);
      seed.set([Math.random(), Math.random(), Math.random()], i * 3);
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
    return g;
  }, []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uTime: { value: 0 },
          uPointer: { value: new THREE.Vector2() },
          uDpr: { value: 1 },
          uColor: { value: new THREE.Color(night ? "#c9d8ff" : "#ffffff") },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: night ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    [night],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame((state, dt) => {
    material.uniforms.uTime.value += Math.min(dt, 0.05);
    material.uniforms.uPointer.value.set(pointer.sx, pointer.sy);
    material.uniforms.uDpr.value = state.gl.getPixelRatio();
  });
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={100} />;
}
