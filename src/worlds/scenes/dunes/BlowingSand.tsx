"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { ATMOSPHERE_GLSL, type AtmosphereUniforms } from "@/worlds/scenes/dunes/atmosphere";
import { fieldTexture, type DunesData } from "@/worlds/scenes/dunes/data";
import { PALETTES } from "@/worlds/scenes/dunes/palette";

/**
 * Screen-space streak shared by both emitters: each point is an ellipse
 * stretched along the wind as it appears on screen, so grains read as motion
 * lines at any distance. Sub-pixel grains fade instead of shimmering.
 */
const STREAK_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPx;
  uniform vec3 uWind;
  varying vec2 vDir;
  varying float vStretch;
  varying float vAlpha;
  varying vec3 vWorld;

  void streak(vec3 p, float size, float speed, float alpha) {
    vec4 mv = viewMatrix * vec4(p, 1.0);
    vec4 c0 = projectionMatrix * mv;
    vec4 c1 = projectionMatrix * (viewMatrix * vec4(p + uWind * speed * 0.09, 1.0));
    vec2 s0 = c0.xy / c0.w;
    vec2 s1 = c1.xy / max(c1.w, 1e-3);
    vec2 d = (s1 - s0) * vec2(uPx * 0.5 * (projectionMatrix[1][1] / projectionMatrix[0][0]), uPx * 0.5);
    float len = length(d);
    float dot_ = size * uPx * projectionMatrix[1][1] * 0.5 / max(-mv.z, 0.1);
    float px = max(dot_, len + dot_);
    vDir = len > 1e-3 ? d / len : vec2(1.0, 0.0);
    vStretch = clamp(px / max(dot_, 0.6), 1.0, 14.0);
    vAlpha = alpha * clamp(dot_ / 0.9, 0.0, 1.0);
    vWorld = p;
    gl_PointSize = clamp(px, 1.0, 180.0);
    gl_Position = c0;
  }
`;

const STREAK_FRAG = /* glsl */ `
  ${ATMOSPHERE_GLSL}
  uniform vec3 uColor;
  uniform float uNight;
  varying vec2 vDir;
  varying float vStretch;
  varying float vAlpha;
  varying vec3 vWorld;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    q.y = -q.y;
    vec2 a = vec2(dot(q, vDir), dot(q, vec2(-vDir.y, vDir.x)));
    a.y *= vStretch;
    float r = dot(a, a);
    float m = exp(-r * 3.2) * smoothstep(1.0, 0.7, r);
    if (m * vAlpha < 0.004) discard;
    vec3 V = normalize(vWorld - cameraPosition);
    // Dust glows when it hangs between you and the low sun.
    float fwd = pow(max(dot(V, uSunDir), 0.0), 6.0);
    vec3 col = uColor * (0.55 + 2.6 * fwd * (1.0 - uNight));
    col = dunesFog(col, vWorld);
    gl_FragColor = vec4(col, m * vAlpha);
  }
`;

const PLUME_VERT = /* glsl */ `
  ${STREAK_VERT}
  attribute vec3 aBase;
  attribute vec4 aSeed;
  uniform float uGust;
  float plumeHash(float n) { return fract(sin(n) * 43758.5453); }
  float plumeNoise(float x) { float i = floor(x); float f = fract(x); return mix(plumeHash(i), plumeHash(i + 1.0), f * f * (3.0 - 2.0 * f)); }
  void main() {
    float speed = 7.0 + 6.0 * aSeed.x;
    float life = fract(uTime * speed / 26.0 + aSeed.y);
    float dist = life * (16.0 + 16.0 * aSeed.z);
    vec3 p = aBase + uWind * dist;
    p.z += (aSeed.w - 0.5) * 7.0 + sin(uTime * 0.9 + aSeed.x * 40.0) * 0.8 * life;
    // Lift off the brink, then settle slowly over the steep slip face.
    p.y += 0.3 + (0.7 + 2.4 * aSeed.z) * sin(min(life * 2.2, 1.0) * 1.5708) - dist * 0.22 * life;
    // Gusts travel along the crest, so plumes pulse in patches.
    float g = plumeNoise(aBase.z * 0.012 + aBase.x * 0.004 - uTime * 0.35);
    float gust = smoothstep(0.35, 0.85, g) * uGust;
    float fade = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.55, 1.0, life));
    float far = 1.0 - smoothstep(700.0, 1500.0, distance(p, cameraPosition));
    streak(p, 0.05 + 0.05 * aSeed.w, speed, gust * fade * far * (0.25 + 0.3 * aSeed.x));
  }
`;

const DRIFT_VERT = /* glsl */ `
  ${STREAK_VERT}
  attribute vec4 aSeed;
  uniform sampler2D tField;
  uniform vec3 uCore;
  uniform float uBox;
  uniform float uGust;
  void main() {
    float speed = 5.0 + 7.0 * aSeed.x;
    // Grains live in a box that follows the camera and wrap as they blow downwind.
    vec2 local = aSeed.yz * uBox + uWind.xz * uTime * speed + vec2(0.0, sin(uTime * 0.6 + aSeed.w * 30.0) * 0.6);
    vec2 xz = cameraPosition.xz + mod(local - cameraPosition.xz + uBox * 0.5, uBox) - uBox * 0.5;
    vec2 uv = vec2((xz.x - uCore.x) / uCore.z, (-xz.y - uCore.y) / uCore.z);
    float h = texture2D(tField, uv).r;
    float hop = fract(uTime * (0.6 + aSeed.x) + aSeed.w);
    vec3 p = vec3(xz.x, h + 0.05 + aSeed.w * 0.5 + 0.25 * sin(hop * 3.1416), xz.y);
    vec2 rel = (xz - cameraPosition.xz) / (uBox * 0.5);
    float edge = 1.0 - smoothstep(0.7, 1.0, max(abs(rel.x), abs(rel.y)));
    streak(p, 0.012 + 0.012 * aSeed.x, speed, edge * uGust * (0.2 + 0.35 * aSeed.z));
  }
`;

function streakMaterial(vertexShader: string, atmosphere: AtmosphereUniforms, color: string, night: boolean, extra: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: STREAK_FRAG,
    uniforms: {
      ...atmosphere,
      uTime: { value: 0 },
      uPx: { value: 1000 },
      uWind: { value: new THREE.Vector3(1, 0, 0.12).normalize() },
      uColor: { value: new THREE.Color(color) },
      uNight: { value: night ? 1 : 0 },
      uGust: { value: 1 },
      ...extra,
    },
    transparent: true,
    depthWrite: false,
    blending: night ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

/** Sand streaming off the sunlit crests, and grains skittering over the ground around the camera. */
export function BlowingSand({ data, variant, atmosphere }: { data: DunesData; variant: Variant; atmosphere: AtmosphereUniforms }) {
  const night = variant === "night";
  const pal = PALETTES[variant];
  const size = useThree((s) => s.size);

  const plumes = useMemo(() => {
    const ridges = data.meta.ridges;
    const segs: [number[], number[]][] = [];
    for (const r of ridges) for (let i = 0; i < r.length - 1; i++) segs.push([r[i], r[i + 1]]);
    const n = 26000;
    const base = new Float32Array(n * 3);
    const seed = new Float32Array(n * 4);
    let s = 11;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const [a, b] = segs[Math.floor(rnd() * segs.length)];
      const t = rnd();
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      const z = a[2] + (b[2] - a[2]) * t;
      base.set([x, z, -y], i * 3);
      seed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(base, 3));
    g.setAttribute("aBase", new THREE.BufferAttribute(base, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    return g;
  }, [data]);

  const drift = useMemo(() => {
    const n = 7000;
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    return g;
  }, []);

  const field = useMemo(() => fieldTexture(data), [data]);

  const mats = useMemo(() => {
    const { core } = data.meta;
    return {
      plume: streakMaterial(PLUME_VERT, atmosphere, pal.particles, night, {}),
      drift: streakMaterial(DRIFT_VERT, atmosphere, pal.particles, night, {
        tField: { value: field },
        uCore: { value: new THREE.Vector3(core.x0, core.y0, core.size) },
        uBox: { value: 90 },
      }),
    };
  }, [atmosphere, pal, night, field, data]);

  useEffect(
    () => () => {
      mats.plume.dispose();
      mats.drift.dispose();
    },
    [mats],
  );
  useEffect(() => () => void [plumes, drift, field].forEach((o) => o.dispose()), [plumes, drift, field]);

  useFrame((state, dt) => {
    const px = size.height * state.gl.getPixelRatio();
    for (const m of [mats.plume, mats.drift]) {
      m.uniforms.uTime.value += Math.min(dt, 0.05);
      m.uniforms.uPx.value = px;
    }
  });

  return (
    <>
      <points geometry={plumes} material={mats.plume} frustumCulled={false} renderOrder={5} />
      <points geometry={drift} material={mats.drift} frustumCulled={false} renderOrder={6} />
    </>
  );
}
