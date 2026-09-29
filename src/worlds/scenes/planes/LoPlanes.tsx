"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { pointer } from "@/lib/store";
import { mulberry32 } from "@/worlds/scenes/planes/sim";

const vertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform vec2 uPointer;
  uniform float uDpr;
  varying float vAngle;
  varying float vKind;
  varying float vA;
  void main() {
    float speed = 0.25 + aSeed.x * 0.35;
    float span = 14.0;
    vec3 p = position;
    float t = uTime * speed + aSeed.y * span;
    p.x += mod(t, span) - span * 0.5;
    p.y += sin(uTime * (0.4 + aSeed.z) + aSeed.w * 6.28) * 0.18 + (mod(t, span) - span * 0.5) * 0.12;
    p.xy += uPointer * vec2(0.5, 0.3) * (0.4 + aSeed.z);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vKind = step(0.35, aSeed.w);
    float size = vKind > 0.5 ? (26.0 + aSeed.x * 22.0) : (240.0 + aSeed.z * 220.0);
    gl_PointSize = size * uDpr / max(0.5, -mv.z) * 4.0;
    vAngle = 0.12 + cos(uTime * (0.4 + aSeed.z) + aSeed.w * 6.28) * 0.2;
    float edge = abs(mod(t, span) - span * 0.5) / (span * 0.5);
    vA = 1.0 - smoothstep(0.75, 1.0, edge);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uPaper;
  uniform vec3 uShade;
  uniform vec3 uWisp;
  uniform float uGlow;
  varying float vAngle;
  varying float vKind;
  varying float vA;
  float tri(vec2 p, vec2 a, vec2 b, vec2 c) {
    vec2 e0 = b - a, e1 = c - b, e2 = a - c;
    float s0 = e0.x * (p.y - a.y) - e0.y * (p.x - a.x);
    float s1 = e1.x * (p.y - b.y) - e1.y * (p.x - b.x);
    float s2 = e2.x * (p.y - c.y) - e2.y * (p.x - c.x);
    return step(0.0, s0) * step(0.0, s1) * step(0.0, s2) + step(s0, 0.0) * step(s1, 0.0) * step(s2, 0.0);
  }
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    q.y = -q.y;
    if (vKind < 0.5) {
      // Soft passing wisp.
      float r = length(q * vec2(1.0, 2.6));
      float a = exp(-r * r * 9.0) * 0.16 * vA;
      if (a < 0.003) discard;
      gl_FragColor = vec4(uWisp, a);
      return;
    }
    float c = cos(vAngle), s = sin(vAngle);
    q = mat2(c, -s, s, c) * q;
    // A dart seen from the side-above: upper wing, lower wing (shaded), a keel sliver.
    float wing = tri(q, vec2(0.42, 0.0), vec2(-0.36, 0.2), vec2(-0.3, 0.0));
    float wing2 = tri(q, vec2(0.42, 0.0), vec2(-0.3, 0.0), vec2(-0.36, -0.08));
    float keel = tri(q, vec2(0.36, -0.01), vec2(-0.3, -0.02), vec2(-0.3, -0.07));
    vec3 col = uPaper * wing + uShade * max(wing2, keel) * (1.0 - wing);
    float a = max(wing, max(wing2, keel)) * vA;
    // Night: a tiny lantern hanging under the plane.
    float lr = length(q - vec2(0.0, -0.2));
    float glow = uGlow * (exp(-lr * lr * 300.0) * 1.5 + exp(-lr * lr * 40.0) * 0.35) * vA;
    col += vec3(1.0, 0.68, 0.32) * glow;
    a = max(a, glow);
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

/** Low Resources: a few paper plane glyphs and wisps gliding over the Cycles layers. */
export function LoPlanes({ variant }: { variant: Variant }) {
  const night = variant === "night";
  const geometry = useMemo(() => {
    const n = 16;
    const rnd = mulberry32(5);
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      pos.set([1.2 + (rnd() - 0.5) * 3, (rnd() - 0.35) * 2.6, -2.5 - rnd() * 4], i * 3);
      seed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
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
          uPaper: { value: new THREE.Color(night ? "#c9cdf0" : "#fffaf3") },
          uShade: { value: new THREE.Color(night ? "#7d82b8" : "#e7cfd6") },
          uWisp: { value: new THREE.Color(night ? "#5e66a8" : "#fff1ea") },
          uGlow: { value: night ? 1 : 0 },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
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
  const group = useRef<THREE.Group>(null);
  useFrame((state, dt) => {
    // Ride with the LayerStack camera so the glyphs never fall behind it as it dollies.
    group.current?.position.copy(state.camera.position);
    material.uniforms.uTime.value += Math.min(dt, 0.05);
    material.uniforms.uPointer.value.set(pointer.sx, pointer.sy);
    material.uniforms.uDpr.value = state.gl.getPixelRatio();
  });
  return (
    <group ref={group}>
      <points geometry={geometry} material={material} frustumCulled={false} renderOrder={100} />
    </group>
  );
}
