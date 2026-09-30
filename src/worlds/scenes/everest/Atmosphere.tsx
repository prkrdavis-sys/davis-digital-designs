"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { groundY, routePoint, type EverestData } from "@/worlds/scenes/everest/data";

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
// Summit plume: spindrift torn off the summit by the jet stream, streaming
// east. Each grain is a camera-facing streak stretched along its motion.
const plumeVertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform vec3 uOrigin;
  uniform vec3 uWind;
  uniform float uTime;
  uniform float uAspect;
  varying vec2 vQuad;
  varying float vAlpha;
  varying float vAge;
  vec3 grain(float age) {
    vec3 side = normalize(cross(uWind, vec3(0.0, 1.0, 0.0)));
    float spread = pow(age, 0.8) * (1.5 + aSeed.y * 4.5);
    vec3 p = uOrigin + uWind * age * (26.0 + aSeed.z * 18.0);
    p += side * (aSeed.y - 0.5) * spread * 1.8;
    p.y += (aSeed.w - 0.5) * spread * 0.6 - age * age * 2.5 + sin(age * 5.0 + aSeed.z * 6.28) * 0.5 * age;
    p += vec3(sin(uTime * 0.7 + aSeed.x * 40.0), cos(uTime * 0.53 + aSeed.y * 30.0), sin(uTime * 0.61 + aSeed.z * 20.0)) * 0.3 * age;
    return p;
  }
  void main() {
    float speed = 0.05 + aSeed.w * 0.025;
    float age = fract(uTime * speed + aSeed.x);
    vec3 head = grain(age);
    vec3 tail = grain(max(0.0, age - 0.035 - aSeed.y * 0.03));
    vec4 c0 = projectionMatrix * viewMatrix * vec4(head, 1.0);
    vec4 c1 = projectionMatrix * viewMatrix * vec4(tail, 1.0);
    vec2 dir = (c0.xy / c0.w - c1.xy / c1.w) * vec2(uAspect, 1.0);
    float len = length(dir);
    dir = len > 1e-6 ? dir / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    float t = position.x * 0.5 + 0.5;
    vec4 c = mix(c1, c0, t);
    float width = (0.18 + age * 1.1) * (0.6 + aSeed.w * 0.8) * projectionMatrix[1][1];
    c.xy += nrm * vec2(1.0 / uAspect, 1.0) * position.y * width;
    gl_Position = c;
    vQuad = position.xy;
    vAlpha = smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.3, 1.0, age));
    vAge = age;
  }
`;

const plumeFragment = /* glsl */ `
  uniform vec3 uLit;
  uniform vec3 uShade;
  uniform float uOpacity;
  varying vec2 vQuad;
  varying float vAlpha;
  varying float vAge;
  void main() {
    float across = exp(-vQuad.y * vQuad.y * 3.5);
    float along = smoothstep(-1.0, -0.2, vQuad.x) * smoothstep(1.0, 0.6, vQuad.x);
    float a = across * along * vAlpha * uOpacity;
    if (a < 0.002) discard;
    gl_FragColor = vec4(mix(uLit, uShade, clamp(vAge * 0.8 - vQuad.y * 0.2, 0.0, 1.0)), a);
  }
`;

export function SummitPlume({ data, variant }: { data: EverestData; variant: Variant }) {
  const peak = data.meta.peaks.Everest.local;
  const night = variant === "night";
  const geometry = useMemo(() => {
    const rand = rng(8849);
    const n = 1400;
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) seed.set([rand(), rand(), rand(), rand()], i * 4);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 4));
    g.instanceCount = n;
    return g;
  }, []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: plumeVertex,
        fragmentShader: plumeFragment,
        uniforms: {
          uOrigin: { value: new THREE.Vector3(peak[0] + 0.3, peak[1] - 0.4, peak[2] + 0.1) },
          // Westerly jet stream: the plume trails east-southeast of the summit.
          uWind: { value: new THREE.Vector3(0.93, -0.04, 0.36).normalize() },
          uTime: { value: 0 },
          uAspect: { value: 1.6 },
          uLit: { value: new THREE.Color(night ? "#b9c9f2" : "#fff1de").multiplyScalar(night ? 0.55 : 1.15) },
          uShade: { value: new THREE.Color(night ? "#2c3b62" : "#aebbd6") },
          uOpacity: { value: night ? 0.22 : 0.3 },
        },
        transparent: true,
        depthWrite: false,
      }),
    [peak, night],
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
    u.uAspect.value = state.size.width / Math.max(1, state.size.height);
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={9} />;
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
    gl_PointSize = clamp(px, 3.0, 30.0) * uDpr;
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
        attr.push(0.22 + rand() * 0.16, rand(), 0, 0);
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
        attr.push(0.2 + rand() * 0.12, rand(), 1, 0);
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
      attr.push(0.17, rand(), 0, 0.02 + rand() * 0.02);
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
