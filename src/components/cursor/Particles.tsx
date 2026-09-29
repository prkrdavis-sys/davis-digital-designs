"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { cursor, resolveAdditive, toWorldX, toWorldY, useCursorClick, useThemeWeight, type Additive } from "@/components/cursor/core";
import { useVariant } from "@/lib/store";
import { sprite, type SpriteKind } from "@/components/cursor/sprites";

export interface EmitterSpec {
  sprite: SpriteKind;
  max: number;
  /** Particles per second while the pointer is still. */
  rate?: number;
  /** Extra particles per pixel travelled. */
  perPx?: number;
  life: [number, number];
  size: [number, number];
  sizeCurve?: "shrink" | "grow" | "pulse" | "flat" | "bloom";
  /** Initial speed range, px/s, in a random direction. */
  speed?: [number, number];
  /** Fraction of pointer velocity inherited at birth (negative trails behind). */
  inherit?: number;
  /** Birth radius around the pointer, px. */
  spread?: number;
  /** Acceleration px/s^2 (+y is down the screen). */
  gravity?: [number, number];
  drag?: number;
  /** Side-to-side sway amplitude, px/s. */
  sway?: number;
  spin?: [number, number];
  colors: string[];
  /** Separate night palette (defaults to `colors`). */
  nightColors?: string[];
  additive?: Additive;
  opacity?: number;
  twinkle?: number;
  /** Particles spawned on click. */
  burst?: { count: number; speed: [number, number]; life?: [number, number]; size?: [number, number] };
  /** Offset of the emission point from the pointer, px. */
  offset?: [number, number];
}

export interface ParticlesHandle {
  emit: (x: number, y: number, count: number, speed?: [number, number]) => void;
}

const vertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aRot;
  attribute vec3 aColor;
  uniform float uDpr;
  varying float vAlpha;
  varying float vRot;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vRot = aRot;
    vColor = aColor;
    gl_PointSize = aSize * uDpr;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vRot;
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vRot), s = sin(vRot);
    p = mat2(c, -s, s, c) * p + 0.5;
    if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) discard;
    vec4 t = texture2D(uMap, vec2(p.x, 1.0 - p.y));
    float a = t.a * vAlpha * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * t.rgb, a);
  }
`;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** CPU-simulated sprite particles that follow the pointer. */
export const Particles = forwardRef<ParticlesHandle, { spec: EmitterSpec }>(function Particles({ spec }, ref) {
  const weight = useThemeWeight();
  const night = useVariant() === "night";
  const additive = resolveAdditive(spec.additive, night);
  const n = spec.max;
  const colors = night && spec.nightColors ? spec.nightColors : spec.colors;
  const palette = useMemo(() => colors.map((c) => new THREE.Color(c)), [colors]);
  const sim = useMemo(
    () => ({
      x: new Float32Array(n),
      y: new Float32Array(n),
      vx: new Float32Array(n),
      vy: new Float32Array(n),
      age: new Float32Array(n).fill(1e9),
      life: new Float32Array(n).fill(1),
      size: new Float32Array(n),
      rot: new Float32Array(n),
      spin: new Float32Array(n),
      phase: new Float32Array(n),
      next: 0,
      carry: 0,
    }),
    [n],
  );
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aRot", new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    return g;
  }, [n]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { uMap: { value: sprite(spec.sprite) }, uDpr: { value: 1 }, uOpacity: { value: spec.opacity ?? 1 } },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    [spec.sprite, additive, spec.opacity],
  );

  const spawn = (x: number, y: number, speed: [number, number], life = spec.life, size = spec.size) => {
    const i = sim.next;
    sim.next = (sim.next + 1) % n;
    const r = (spec.spread ?? 0) * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    sim.x[i] = x + Math.cos(a) * r + (spec.offset?.[0] ?? 0);
    sim.y[i] = y + Math.sin(a) * r + (spec.offset?.[1] ?? 0);
    const sp = rand(speed[0], speed[1]);
    const d = Math.random() * Math.PI * 2;
    const inh = spec.inherit ?? 0;
    sim.vx[i] = Math.cos(d) * sp + cursor.vx * inh;
    sim.vy[i] = Math.sin(d) * sp + cursor.vy * inh;
    sim.age[i] = 0;
    sim.life[i] = rand(life[0], life[1]);
    sim.size[i] = rand(size[0], size[1]);
    sim.rot[i] = Math.random() * Math.PI * 2;
    sim.spin[i] = spec.spin ? rand(spec.spin[0], spec.spin[1]) : 0;
    sim.phase[i] = Math.random() * Math.PI * 2;
    const col = palette[Math.floor(Math.random() * palette.length)];
    const ca = geo.attributes.aColor as THREE.BufferAttribute;
    ca.setXYZ(i, col.r, col.g, col.b);
    ca.needsUpdate = true;
  };

  useImperativeHandle(ref, () => ({
    emit: (x, y, count, speed) => {
      for (let k = 0; k < count; k++) spawn(x, y, speed ?? spec.speed ?? [0, 0]);
    },
  }));

  useCursorClick((x, y) => {
    if (!spec.burst) return;
    for (let k = 0; k < spec.burst.count; k++) spawn(x, y, spec.burst.speed, spec.burst.life, spec.burst.size);
  });

  const self = useRef<THREE.Points>(null);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    mat.uniforms.uDpr.value = state.gl.getPixelRatio();
    const w = weight.current * cursor.presence;
    if (w > 0.02) {
      sim.carry += ((spec.rate ?? 0) * d + (spec.perPx ?? 0) * cursor.moved) * w;
      while (sim.carry >= 1) {
        sim.carry -= 1;
        spawn(cursor.x, cursor.y, spec.speed ?? [0, 0]);
      }
    }
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const sz = geo.attributes.aSize as THREE.BufferAttribute;
    const al = geo.attributes.aAlpha as THREE.BufferAttribute;
    const ro = geo.attributes.aRot as THREE.BufferAttribute;
    const gx = spec.gravity?.[0] ?? 0;
    const gy = spec.gravity?.[1] ?? 0;
    const drag = Math.exp(-(spec.drag ?? 0) * d);
    const sway = spec.sway ?? 0;
    const t = cursor.time;
    for (let i = 0; i < n; i++) {
      const age = (sim.age[i] += d);
      const life = sim.life[i];
      if (age >= life) {
        al.setX(i, 0);
        continue;
      }
      sim.vx[i] = (sim.vx[i] + gx * d) * drag;
      sim.vy[i] = (sim.vy[i] + gy * d) * drag;
      sim.x[i] += (sim.vx[i] + Math.sin(t * 2.2 + sim.phase[i]) * sway) * d;
      sim.y[i] += sim.vy[i] * d;
      sim.rot[i] += sim.spin[i] * d;
      const k = age / life;
      let s = 1;
      switch (spec.sizeCurve ?? "shrink") {
        case "shrink":
          s = 1 - k * 0.85;
          break;
        case "grow":
          s = 0.3 + k * 0.9;
          break;
        case "pulse":
          s = 0.8 + Math.sin(k * Math.PI) * 0.4;
          break;
        case "bloom":
          s = Math.min(1, k * 6) * (1 - k * 0.3);
          break;
        case "flat":
          s = 1;
          break;
      }
      const fadeIn = Math.min(1, k * 8);
      const tw = spec.twinkle ? 1 - spec.twinkle + spec.twinkle * (0.5 + 0.5 * Math.sin(t * 9 + sim.phase[i] * 3)) : 1;
      pos.setXYZ(i, toWorldX(sim.x[i]), toWorldY(sim.y[i]), 0);
      sz.setX(i, sim.size[i] * s);
      al.setX(i, fadeIn * (1 - k) * (1 - k * 0.2) * tw * weight.current);
      ro.setX(i, sim.rot[i]);
    }
    pos.needsUpdate = sz.needsUpdate = al.needsUpdate = ro.needsUpdate = true;
  });

  return <points ref={self} geometry={geo} material={mat} frustumCulled={false} renderOrder={1} />;
});
