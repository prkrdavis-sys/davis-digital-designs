"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { pointer } from "@/lib/store";

const vertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform vec2 uPointer;
  uniform float uDpr;
  uniform float uRise;
  varying float vA;
  varying float vHue;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.21 + aSeed.x * 6.28) * 0.4 + uPointer.x * aSeed.z * 0.3;
    p.y += mod(uTime * uRise * (0.4 + aSeed.w) + aSeed.y * 6.0, 6.0) - 3.0 + uPointer.y * aSeed.z * 0.2;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (6.0 + aSeed.x * 18.0) * uDpr * (4.0 / max(0.5, -mv.z));
    vA = (0.35 + 0.65 * aSeed.y) * (0.55 + 0.45 * sin(uTime * (0.8 + aSeed.w * 2.0) + aSeed.z * 30.0));
    vHue = aSeed.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uA;
  uniform vec3 uB;
  uniform float uOpacity;
  varying float vA;
  varying float vHue;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float r = length(q) * 2.0;
    float core = exp(-r * r * 5.0);
    float star = max(0.0, 1.0 - abs(q.x * q.y) * 70.0) * (1.0 - r) * 0.5;
    float a = (core + star) * vA * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(mix(uA, uB, vHue), a);
  }
`;

/** A few cheap live glints drifting over the Low Resources layers. */
export function LoGlints({ colors, count = 70, opacity = 0.7, rise = 0.12, additive = true }: { colors: [string, string]; count?: number; opacity?: number; rise?: number; additive?: boolean }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos.set([(Math.random() - 0.3) * 8, (Math.random() - 0.5) * 5, -1.6 - Math.random() * 4], i * 3);
      seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    return g;
  }, [count]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uTime: { value: 0 },
          uPointer: { value: new THREE.Vector2() },
          uDpr: { value: 1 },
          uRise: { value: rise },
          uA: { value: new THREE.Color(colors[0]) },
          uB: { value: new THREE.Color(colors[1]) },
          uOpacity: { value: opacity },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    [colors, opacity, rise, additive],
  );
  const points = useRef<THREE.Points>(null);
  useFrame((state, dt) => {
    material.uniforms.uTime.value += Math.min(dt, 0.05);
    material.uniforms.uPointer.value.set(pointer.sx, pointer.sy);
    material.uniforms.uDpr.value = state.gl.getPixelRatio();
    // LayerStack flies the camera forward through its sets; keep the glints with it.
    points.current?.position.set(0, 0, state.camera.position.z);
  });
  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} renderOrder={100} />;
}
