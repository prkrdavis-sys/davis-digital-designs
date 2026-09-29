"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { cursor, resolveAdditive, toWorldX, toWorldY, useThemeWeight, type Additive } from "@/components/cursor/core";
import { useVariant } from "@/lib/store";

export interface RibbonSpec {
  /** Max history points. */
  points: number;
  /** Seconds a point lives. */
  maxAge: number;
  width: [number, number];
  /** Up to 5 colors. gradient: head -> tail; flags: repeating segments. */
  colors: string[];
  nightColors?: string[];
  mode: "gradient" | "flags" | "dash" | "streak";
  segments?: number;
  flutter?: number;
  additive?: Additive;
  opacity?: number;
  /** Min px between recorded points. */
  spacing?: number;
}

const vertex = /* glsl */ `
  attribute float aU;
  attribute float aSide;
  uniform float uTime;
  uniform float uFlutter;
  varying float vU;
  varying float vSide;
  void main() {
    vU = aU;
    vSide = aSide;
    vec3 p = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColors[5];
  uniform int uCount;
  uniform int uMode;
  uniform float uSegments;
  uniform float uOpacity;
  uniform float uTime;
  varying float vU;
  varying float vSide;
  vec3 pick(int i) {
    if (i == 0) return uColors[0];
    if (i == 1) return uColors[1];
    if (i == 2) return uColors[2];
    if (i == 3) return uColors[3];
    return uColors[4];
  }
  void main() {
    float u = clamp(vU, 0.0, 1.0);
    float edge = 1.0 - smoothstep(0.7, 1.0, abs(vSide));
    float alpha = pow(1.0 - u, 1.3) * uOpacity;
    vec3 col;
    if (uMode == 1) {
      float f = u * uSegments;
      int seg = int(mod(floor(f), float(uCount)));
      col = pick(seg);
      float cell = fract(f);
      alpha *= step(cell, 0.82) * (0.85 + 0.15 * sin(cell * 12.0 + uTime * 6.0));
      edge = 1.0;
    } else if (uMode == 2) {
      col = mix(pick(0), pick(1), u);
      alpha *= step(fract(u * uSegments), 0.55);
    } else if (uMode == 3) {
      col = mix(pick(0), pick(1), u);
      alpha *= (1.0 - u) * 1.4;
    } else {
      float x = u * float(uCount - 1);
      int i = int(floor(x));
      col = mix(pick(i), pick(min(i + 1, uCount - 1)), fract(x));
    }
    gl_FragColor = vec4(col, alpha * edge);
  }
`;

const MODES = { gradient: 0, flags: 1, dash: 2, streak: 3 } as const;

/** A tapered strip that follows the pointer's recent path. */
export function Ribbon({ spec }: { spec: RibbonSpec }) {
  const weight = useThemeWeight();
  const night = useVariant() === "night";
  const additive = resolveAdditive(spec.additive, night);
  const colors = night && spec.nightColors ? spec.nightColors : spec.colors;
  const n = spec.points;
  const hist = useMemo(() => ({ x: new Float32Array(n), y: new Float32Array(n), age: new Float32Array(n).fill(1e9), count: 0 }), [n]);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aU", new THREE.BufferAttribute(new Float32Array(n * 2), 1).setUsage(THREE.DynamicDrawUsage));
    const side = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
    }
    g.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    return g;
  }, [n]);
  const mat = useMemo(() => {
    const cols = [...colors, ...colors, ...colors].slice(0, 5).map((c) => new THREE.Color(c));
    return new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uColors: { value: cols },
        uCount: { value: Math.min(5, colors.length) },
        uMode: { value: MODES[spec.mode] },
        uSegments: { value: spec.segments ?? 10 },
        uOpacity: { value: spec.opacity ?? 1 },
        uTime: { value: 0 },
        uFlutter: { value: spec.flutter ?? 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
  }, [spec, additive, colors]);

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    mat.uniforms.uTime.value += d;
    mat.uniforms.uOpacity.value = (spec.opacity ?? 1) * weight.current * cursor.presence;
    for (let i = 0; i < hist.count; i++) hist.age[i] += d;
    const spacing = spec.spacing ?? 3;
    const hx = hist.count ? hist.x[0] : -1e5;
    const hy = hist.count ? hist.y[0] : -1e5;
    if (Math.hypot(cursor.x - hx, cursor.y - hy) > spacing) {
      hist.x.copyWithin(1, 0, n - 1);
      hist.y.copyWithin(1, 0, n - 1);
      hist.age.copyWithin(1, 0, n - 1);
      hist.x[0] = cursor.x;
      hist.y[0] = cursor.y;
      hist.age[0] = 0;
      hist.count = Math.min(n, hist.count + 1);
    } else if (hist.count) {
      // Keep the head glued to the pointer between samples.
      hist.x[0] = cursor.x;
      hist.y[0] = cursor.y;
    }
    while (hist.count > 0 && hist.age[hist.count - 1] > spec.maxAge) hist.count--;

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uAttr = geo.attributes.aU as THREE.BufferAttribute;
    const flutter = spec.flutter ?? 0;
    const t = mat.uniforms.uTime.value as number;
    const last = Math.max(1, hist.count - 1);
    for (let i = 0; i < n; i++) {
      const j = Math.min(i, hist.count - 1);
      if (hist.count < 2) {
        pos.setXYZ(i * 2, -1e5, -1e5, 0);
        pos.setXYZ(i * 2 + 1, -1e5, -1e5, 0);
        continue;
      }
      const a = Math.max(0, j - 1);
      const b = Math.min(hist.count - 1, j + 1);
      let tx = hist.x[a] - hist.x[b];
      let ty = hist.y[a] - hist.y[b];
      const len = Math.hypot(tx, ty) || 1;
      tx /= len;
      ty /= len;
      const u = i < hist.count ? j / last : 1;
      const life = 1 - Math.min(1, hist.age[j] / spec.maxAge);
      const w = (spec.width[0] + (spec.width[1] - spec.width[0]) * u) * 0.5 * life;
      const f = flutter ? Math.sin(u * 18 - t * 9) * flutter * u : 0;
      const nx = -ty;
      const ny = tx;
      const cx = hist.x[j] + nx * f;
      const cy = hist.y[j] + ny * f;
      pos.setXYZ(i * 2, toWorldX(cx - nx * w), toWorldY(cy - ny * w), 0);
      pos.setXYZ(i * 2 + 1, toWorldX(cx + nx * w), toWorldY(cy + ny * w), 0);
      uAttr.setX(i * 2, u);
      uAttr.setX(i * 2 + 1, u);
    }
    pos.needsUpdate = true;
    uAttr.needsUpdate = true;
    geo.setDrawRange(0, Math.max(0, hist.count - 1) * 6);
  });

  return <mesh geometry={geo} material={mat} frustumCulled={false} renderOrder={0} />;
}
