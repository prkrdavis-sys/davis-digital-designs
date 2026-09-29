"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { elevationAt, groundY, halfExtent, routePoint, type EverestData } from "@/worlds/scenes/everest/data";
import { HAZE_GLSL, LOOKS, hazeUniforms } from "@/worlds/scenes/everest/look";

/** Seeded PRNG so every visit places the same clouds and lights. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --------------------------------------------------------------------------
// Valley clouds: camera-facing soft puffs banked in the low valleys.
const cloudVertex = /* glsl */ `
  attribute vec4 aCloud; // center.xyz, size
  attribute vec2 aSeed;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vSeed;
  varying float vFade;
  void main() {
    vec3 c = aCloud.xyz + vec3(sin(uTime * 0.02 + aSeed.x * 6.28) * 3.0, 0.0, cos(uTime * 0.017 + aSeed.y * 6.28) * 2.0);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    // Flattened puffs: wide, low banks rather than balls.
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 p = c + right * position.x * aCloud.w + up * position.y * aCloud.w * 0.42;
    vUv = position.xy + 0.5;
    vWorld = p;
    vSeed = aSeed.x;
    float d = length(cameraPosition - c);
    vFade = smoothstep(aCloud.w * 0.6, aCloud.w * 2.2, d);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const cloudFragment = /* glsl */ `
  uniform vec3 uCloud;
  uniform vec3 uShade;
  uniform vec3 uKeyColor;
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vSeed;
  varying float vFade;
  ${HAZE_GLSL}
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.1 + 3.3; a *= 0.5; } return v; }
  void main() {
    vec2 q = vUv - 0.5;
    float r = length(q * vec2(1.0, 1.25));
    float n = fbm(vUv * 3.2 + vSeed * 17.0 + vec2(uTime * 0.01, 0.0));
    // Billowy top, flat soft base.
    float body = smoothstep(0.52, 0.18, r + (n - 0.5) * 0.55) * smoothstep(-0.02, 0.18, vUv.y + (n - 0.5) * 0.15);
    if (body < 0.004) discard;
    float top = clamp(vUv.y * 1.2 + (n - 0.5) * 0.6, 0.0, 1.0);
    float toKey = max(dot(normalize(vec3(uKey.x, 0.0, uKey.z)), normalize(vec3(vWorld.x - cameraPosition.x, 0.0, vWorld.z - cameraPosition.z))), 0.0);
    vec3 col = mix(uShade, uCloud, top);
    col += uKeyColor * pow(toKey, 3.0) * top * 0.35;
    vec3 v = normalize(vWorld - cameraPosition);
    col = mix(col, inscatter(v), hazeAmount(cameraPosition, vWorld) * 0.85);
    gl_FragColor = vec4(col, body * uOpacity * vFade);
  }
`;

export function ValleyClouds({ data, variant }: { data: EverestData; variant: Variant }) {
  const look = LOOKS[variant];
  const geometry = useMemo(() => {
    const rand = rng(1932);
    const [hx, hz] = halfExtent(data.meta);
    const clouds: number[] = [];
    const seeds: number[] = [];
    let tries = 0;
    while (clouds.length / 4 < 190 && tries++ < 40000) {
      const x = (rand() * 2 - 1) * hx * 0.92;
      const z = (rand() * 2 - 1) * hz * 0.92;
      const m = elevationAt(data, x, z);
      if (m === null || m > 4300 || m < 2300) continue;
      // Valleys only: lower than the ring around it.
      let ring = 0;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        ring += elevationAt(data, x + Math.cos(a) * 18, z + Math.sin(a) * 18) ?? m;
      }
      if (m > ring / 6 - 180) continue;
      // Keep the trek corridor mostly clear, so clouds frame rather than hide it.
      let nearRoute = Infinity;
      for (let i = 0; i < data.route.points.length; i += 20) {
        const p = data.route.points[i];
        nearRoute = Math.min(nearRoute, Math.hypot(p[0] - x, p[2] - z));
      }
      if (nearRoute < 9 && rand() < 0.85) continue;
      const y = groundY(data, x, z) + 3 + rand() * 6;
      clouds.push(x, y, z, 16 + rand() * 30);
      seeds.push(rand(), rand());
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute("aCloud", new THREE.InstancedBufferAttribute(new Float32Array(clouds), 4));
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(new Float32Array(seeds), 2));
    g.instanceCount = clouds.length / 4;
    return g;
  }, [data]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: cloudVertex,
        fragmentShader: cloudFragment,
        uniforms: {
          uCloud: { value: new THREE.Color(look.cloud) },
          uShade: { value: new THREE.Color(look.cloudShade) },
          uKeyColor: { value: new THREE.Color(look.keyColor) },
          uTime: { value: 0 },
          uOpacity: { value: variant === "night" ? 0.55 : 0.78 },
          ...hazeUniforms(look),
        },
        transparent: true,
        depthWrite: false,
      }),
    [look, variant],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame((_, dt) => {
    material.uniforms.uTime.value += Math.min(dt, 0.05);
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={8} />;
}

// --------------------------------------------------------------------------
// Summit plume: spindrift torn off the summit by the jet stream, streaming east.
const plumeVertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform vec3 uOrigin;
  uniform vec3 uWind;
  uniform float uTime;
  uniform float uDpr;
  uniform float uViewH;
  uniform float uFovScale;
  varying float vAlpha;
  varying float vAge;
  void main() {
    float life = 1.0;
    float age = fract(uTime * (0.045 + aSeed.w * 0.02) + aSeed.x);
    vec3 side = normalize(cross(uWind, vec3(0.0, 1.0, 0.0)));
    float spread = age * (2.0 + aSeed.y * 5.0);
    vec3 p = uOrigin + uWind * age * (22.0 + aSeed.z * 16.0);
    p += side * (aSeed.y - 0.5) * spread * 1.6;
    p.y += sin(age * 3.0 + aSeed.z * 6.28) * 0.9 * age - age * age * 3.0 + (aSeed.w - 0.5) * spread * 0.5;
    p += vec3(sin(uTime * 0.7 + aSeed.x * 40.0), cos(uTime * 0.53 + aSeed.y * 30.0), sin(uTime * 0.61 + aSeed.z * 20.0)) * 0.35 * age;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    float size = (0.7 + age * 5.5) * (0.6 + aSeed.w * 0.8);
    gl_PointSize = clamp(size * uViewH * uFovScale / max(-mv.z, 1.0), 1.0, 220.0) * uDpr;
    vAlpha = smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.35, 1.0, age));
    vAge = age;
    gl_Position = projectionMatrix * mv;
  }
`;

const plumeFragment = /* glsl */ `
  uniform vec3 uLit;
  uniform vec3 uShade;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vAge;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float r = length(q) * 2.0;
    float a = exp(-r * r * 3.2) * smoothstep(1.0, 0.7, r);
    if (a * vAlpha < 0.003) discard;
    vec3 col = mix(uLit, uShade, clamp(q.y + 0.5 + vAge * 0.3, 0.0, 1.0) * 0.6);
    gl_FragColor = vec4(col, a * vAlpha * uOpacity);
  }
`;

export function SummitPlume({ data, variant }: { data: EverestData; variant: Variant }) {
  const peak = data.meta.peaks.Everest.local;
  const geometry = useMemo(() => {
    const rand = rng(8849);
    const n = 900;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) seed.set([rand(), rand(), rand(), rand()], i * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    return g;
  }, []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: plumeVertex,
        fragmentShader: plumeFragment,
        uniforms: {
          uOrigin: { value: new THREE.Vector3(peak[0] + 0.4, peak[1] - 0.6, peak[2]) },
          // Westerly jet stream: the plume trails east-southeast of the summit.
          uWind: { value: new THREE.Vector3(0.93, -0.05, 0.36).normalize() },
          uTime: { value: 0 },
          uDpr: { value: 1 },
          uViewH: { value: 1000 },
          uFovScale: { value: 1 },
          uLit: { value: new THREE.Color(variant === "night" ? "#c9d6f5" : "#fff3e4").multiplyScalar(variant === "night" ? 0.7 : 1.35) },
          uShade: { value: new THREE.Color(variant === "night" ? "#3b4d78" : "#b7c3dc") },
          uOpacity: { value: variant === "night" ? 0.28 : 0.33 },
        },
        transparent: true,
        depthWrite: false,
      }),
    [peak, variant],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame((state, dt) => {
    const u = material.uniforms;
    u.uTime.value += Math.min(dt, 0.05);
    u.uDpr.value = state.gl.getPixelRatio();
    u.uViewH.value = state.size.height;
    const cam = state.camera as THREE.PerspectiveCamera;
    u.uFovScale.value = 1 / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / 2;
  });
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={9} />;
}

// --------------------------------------------------------------------------
// Point lights as glowing sprites: headlamps, camps, villages.
const lampVertex = /* glsl */ `
  attribute vec4 aLamp; // size, seed, kind, speed
  uniform float uTime;
  uniform float uDpr;
  uniform float uViewH;
  uniform float uFovScale;
  varying float vFlicker;
  varying float vKind;
  void main() {
    vec4 mv = viewMatrix * vec4(position, 1.0);
    float px = aLamp.x * uViewH * uFovScale / max(-mv.z, 1.0);
    gl_PointSize = clamp(px, 2.5, 26.0) * uDpr;
    vFlicker = 0.75 + 0.25 * sin(uTime * (2.0 + aLamp.y * 5.0) + aLamp.y * 50.0);
    vKind = aLamp.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const lampFragment = /* glsl */ `
  uniform vec3 uWarm;
  uniform vec3 uCool;
  uniform float uIntensity;
  varying float vFlicker;
  varying float vKind;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = exp(-r * r * 9.0) + exp(-r * r * 2.2) * 0.25;
    if (a < 0.01) discard;
    vec3 c = vKind > 0.5 ? uCool : uWarm;
    gl_FragColor = vec4(c * a * vFlicker * uIntensity, a);
  }
`;

export function NightLights({ data }: { data: EverestData }) {
  const { route } = data;
  const built = useMemo(() => {
    const rand = rng(29029);
    const pos: number[] = [];
    const attr: number[] = [];
    const p: [number, number, number] = [0, 0, 0];
    const wp = Object.fromEntries(route.waypoints.map((w) => [w.name, w]));
    // Villages: warm lodge windows clustered around each stop.
    for (const [name, count, spread] of [
      ["Lukla", 46, 1.6],
      ["Phakding", 18, 1.0],
      ["Monjo", 10, 0.8],
      ["Namche Bazaar", 70, 2.0],
      ["Tengboche", 14, 0.8],
      ["Pangboche", 16, 0.9],
      ["Dingboche", 28, 1.3],
      ["Lobuche", 12, 0.7],
      ["Gorak Shep", 10, 0.6],
    ] as [string, number, number][]) {
      const w = wp[name];
      if (!w) continue;
      for (let k = 0; k < count; k++) {
        const x = w.pos[0] + (rand() - 0.5) * spread * 2;
        const z = w.pos[2] + (rand() - 0.5) * spread * 2;
        pos.push(x, groundY(data, x, z) + 0.12, z);
        attr.push(0.1 + rand() * 0.08, rand(), 0, 0);
      }
    }
    // Camps: tents glowing blue-white under headlamps.
    for (const [name, count, spread] of [
      ["Everest Base Camp", 60, 2.2],
      ["Camp I", 12, 0.6],
      ["Camp II", 22, 0.9],
      ["Camp III", 8, 0.35],
      ["South Col", 16, 0.6],
    ] as [string, number, number][]) {
      const w = wp[name];
      if (!w) continue;
      for (let k = 0; k < count; k++) {
        const x = w.pos[0] + (rand() - 0.5) * spread * 2;
        const z = w.pos[2] + (rand() - 0.5) * spread * 2;
        pos.push(x, groundY(data, x, z) + 0.1, z);
        attr.push(0.09 + rand() * 0.06, rand(), 1, 0);
      }
    }
    const staticCount = pos.length / 3;
    // Summit push: a string of headlamps on the route from the South Col to the South Summit.
    const d0 = wp["South Col"]?.dist ?? 0;
    const d1 = wp["South Summit"]?.dist ?? d0;
    const climbers: number[] = [];
    for (let k = 0; k < 34; k++) {
      climbers.push(d0 + (d1 - d0) * (k / 34 + (rand() - 0.5) * 0.012));
      routePoint(route, climbers[k], p);
      pos.push(p[0], p[1], p[2]);
      attr.push(0.07, rand(), 0, 0.02 + rand() * 0.02);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aLamp", new THREE.Float32BufferAttribute(attr, 4));
    return { g, staticCount, climbers, d0, d1 };
  }, [data, route]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: lampVertex,
        fragmentShader: lampFragment,
        uniforms: {
          uTime: { value: 0 },
          uDpr: { value: 1 },
          uViewH: { value: 1000 },
          uFovScale: { value: 1 },
          uWarm: { value: new THREE.Color("#ffc47a") },
          uCool: { value: new THREE.Color("#dfe9ff") },
          uIntensity: { value: 5 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  useEffect(
    () => () => {
      built.g.dispose();
      material.dispose();
    },
    [built, material],
  );
  const p = useMemo<[number, number, number]>(() => [0, 0, 0], []);
  useFrame((state, dt) => {
    const u = material.uniforms;
    const d = Math.min(dt, 0.05);
    u.uTime.value += d;
    u.uDpr.value = state.gl.getPixelRatio();
    u.uViewH.value = state.size.height;
    const cam = state.camera as THREE.PerspectiveCamera;
    u.uFovScale.value = 1 / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / 2;
    // Climbers inch upward and loop back to the col.
    const posAttr = built.g.getAttribute("position") as THREE.BufferAttribute;
    const span = built.d1 - built.d0;
    built.climbers.forEach((c, k) => {
      let nd = c + d * 0.012;
      if (nd > built.d1) nd -= span;
      built.climbers[k] = nd;
      routePoint(route, nd, p);
      posAttr.setXYZ(built.staticCount + k, p[0], p[1] + 0.05, p[2]);
    });
    posAttr.needsUpdate = true;
  });
  return <points geometry={built.g} material={material} frustumCulled={false} renderOrder={10} />;
}

// --------------------------------------------------------------------------
// Ice glints drifting around the camera: depth cues when flying close.
const glintVertex = /* glsl */ `
  attribute vec3 aSeed;
  uniform vec3 uCam;
  uniform float uBox;
  uniform float uTime;
  uniform float uDpr;
  varying float vA;
  void main() {
    vec3 p = position * uBox + vec3(uTime * 0.8 * (0.5 + aSeed.x), -uTime * 0.25 * (0.4 + aSeed.y), uTime * 0.35);
    p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    gl_PointSize = clamp((0.3 + aSeed.z * 0.6) * 600.0 / max(depth, 0.5), 1.0, 7.0) * uDpr;
    vA = smoothstep(uBox * 0.02, uBox * 0.1, depth) * (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, depth)) * (0.4 + 0.6 * sin(uTime * (1.0 + aSeed.x * 3.0) + aSeed.y * 30.0) * 0.5 + 0.3);
    gl_Position = projectionMatrix * mv;
  }
`;

const glintFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = exp(-r * r * 5.0) * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export function Glints({ variant }: { variant: Variant }) {
  const geometry = useMemo(() => {
    const rand = rng(77);
    const n = 700;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set([rand() - 0.5, rand() - 0.5, rand() - 0.5], i * 3);
      seed.set([rand(), rand(), rand()], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
    return g;
  }, []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: glintVertex,
        fragmentShader: glintFragment,
        uniforms: {
          uCam: { value: new THREE.Vector3() },
          uBox: { value: 30 },
          uTime: { value: 0 },
          uDpr: { value: 1 },
          uColor: { value: new THREE.Color(variant === "night" ? "#c7d8ff" : "#fff6e6").multiplyScalar(variant === "night" ? 1.4 : 2.2) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [variant],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame((state, dt) => {
    const u = material.uniforms;
    u.uTime.value += Math.min(dt, 0.05);
    u.uCam.value.copy(state.camera.position);
    u.uDpr.value = state.gl.getPixelRatio();
    const ground = state.camera.position.y;
    u.uBox.value = THREE.MathUtils.clamp(ground * 0.35, 12, 60);
  });
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={11} />;
}
