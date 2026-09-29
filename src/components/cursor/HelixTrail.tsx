"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { cursor, toWorldX, toWorldY, useThemeWeight } from "@/components/cursor/core";
import { sprite } from "@/components/cursor/sprites";

const HISTORY = 90;
const BEADS = 44;

const vertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uDpr;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    gl_PointSize = aSize * uDpr;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    // Shaded like a glossy bead: dark rim, saturated body, white highlight.
    float lum = t.r;
    vec3 col = mix(vColor * 0.45, vColor, smoothstep(0.2, 0.7, lum)) + pow(lum, 6.0) * 0.8;
    gl_FragColor = vec4(col, smoothstep(0.02, 0.2, t.a) * vAlpha);
  }
`;

/**
 * A fluorescent double helix drawn along the pointer's path: two bead strands
 * twisting around the path, with base-pair rungs between them.
 */
export function HelixTrail({ colors = ["#19d97a", "#ff3f8e", "#4d6bff"], amplitude = 11, twist = 0.33 }: { colors?: string[]; amplitude?: number; twist?: number }) {
  const weight = useThemeWeight();
  const hist = useMemo(() => ({ x: new Float32Array(HISTORY), y: new Float32Array(HISTORY), len: new Float32Array(HISTORY), count: 0 }), []);
  const cols = useMemo(() => colors.map((c) => new THREE.Color(c)), [colors]);

  const beads = useMemo(() => {
    const n = BEADS * 2 + BEADS * 3;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uMap: { value: sprite("bead") }, uDpr: { value: 1 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    return { g, mat, n };
  }, []);

  useFrame((state) => {
    beads.mat.uniforms.uDpr.value = state.gl.getPixelRatio();
    const hx = hist.count ? hist.x[0] : -1e5;
    const hy = hist.count ? hist.y[0] : -1e5;
    const step = Math.hypot(cursor.x - hx, cursor.y - hy);
    if (step > 2.5) {
      hist.x.copyWithin(1, 0, HISTORY - 1);
      hist.y.copyWithin(1, 0, HISTORY - 1);
      hist.len.copyWithin(1, 0, HISTORY - 1);
      hist.x[0] = cursor.x;
      hist.y[0] = cursor.y;
      hist.len[0] = (hist.count ? hist.len[1] : 0) + step;
      hist.count = Math.min(HISTORY, hist.count + 1);
    }
    // The helix slowly retracts into the pointer when it stops moving.
    if (cursor.speed < 30 && hist.count > 2) hist.count--;

    const pos = beads.g.attributes.position as THREE.BufferAttribute;
    const size = beads.g.attributes.aSize as THREE.BufferAttribute;
    const alpha = beads.g.attributes.aAlpha as THREE.BufferAttribute;
    const color = beads.g.attributes.aColor as THREE.BufferAttribute;
    const w = weight.current * cursor.presence;
    const t = cursor.time;
    // Distances are measured back from the head (newest point) along the path.
    const head = hist.len[0];
    const total = hist.count > 1 ? head - hist.len[hist.count - 1] : 0;
    const spacing = 7;
    let p = 0;
    const put = (x: number, y: number, s: number, a: number, c: THREE.Color) => {
      pos.setXYZ(p, toWorldX(x), toWorldY(y), 0);
      size.setX(p, s);
      alpha.setX(p, a);
      color.setXYZ(p, c.r, c.g, c.b);
      p++;
    };
    let seg = 0;
    for (let b = 0; b < BEADS; b++) {
      const dist = b * spacing;
      if (hist.count < 2 || dist > total) break;
      while (seg < hist.count - 2 && head - hist.len[seg + 1] < dist) seg++;
      const d0 = head - hist.len[seg];
      const d1 = head - hist.len[seg + 1];
      const f = d1 > d0 ? (dist - d0) / (d1 - d0) : 0;
      const x = hist.x[seg] + (hist.x[seg + 1] - hist.x[seg]) * f;
      const y = hist.y[seg] + (hist.y[seg + 1] - hist.y[seg]) * f;
      let tx = hist.x[seg] - hist.x[seg + 1];
      let ty = hist.y[seg] - hist.y[seg + 1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const nx = -ty;
      const ny = tx;
      const u = b / BEADS;
      const phase = b * twist - t * 3;
      const s1 = Math.sin(phase);
      const s2 = Math.sin(phase + Math.PI * 0.75);
      const amp = amplitude * Math.min(1, u * 6) * (1 - u * 0.5);
      const fade = (1 - u) * w;
      // Depth cue: the strand in front is bigger and brighter.
      put(x + nx * s1 * amp, y + ny * s1 * amp, 7 + Math.cos(phase) * 2.5, fade * (0.75 + Math.cos(phase) * 0.25), cols[0]);
      put(x + nx * s2 * amp, y + ny * s2 * amp, 7 + Math.cos(phase + Math.PI * 0.75) * 2.5, fade * (0.75 + Math.cos(phase + Math.PI * 0.75) * 0.25), cols[1]);
      if (b % 2 === 0) {
        for (let r = 1; r <= 3; r++) {
          const k = r / 4;
          const sr = s1 + (s2 - s1) * k;
          put(x + nx * sr * amp, y + ny * sr * amp, 3, fade * 0.55, cols[2]);
        }
      }
    }
    for (let i = p; i < beads.n; i++) alpha.setX(i, 0);
    pos.needsUpdate = size.needsUpdate = alpha.needsUpdate = color.needsUpdate = true;
  });

  return <points geometry={beads.g} material={beads.mat} frustumCulled={false} renderOrder={2} />;
}
