"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { mulberry32 } from "@/worlds/scenes/planes/sim";
import { lin, NOISE_GLSL, sky, skyGLSL, WORLD } from "@/worlds/scenes/planes/shaders";

const COUNT = 22;
const BOX = new THREE.Vector3(170, 26, 190);

const vertex = /* glsl */ `
  attribute vec3 iPos;
  attribute vec3 iSize;
  uniform vec3 uCam;
  varying vec2 vUv;
  varying float vSeed;
  varying float vFade;
  varying vec3 vWorld;
  void main() {
    vec3 n = normalize(uCam - iPos);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), n));
    vec3 up = cross(n, right);
    vec3 p = iPos + right * (uv.x - 0.5) * iSize.x + up * (uv.y - 0.5) * iSize.y;
    float d = length(uCam - iPos);
    vFade = smoothstep(5.0, 16.0, d) * (1.0 - smoothstep(70.0, 95.0, d));
    vUv = uv;
    vSeed = iSize.z;
    vWorld = p;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

function fragment(variant: Variant) {
  return /* glsl */ `
  uniform float uTime;
  uniform vec3 uKey;
  uniform vec3 uAmb;
  uniform vec3 uCam;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vSeed;
  varying float vFade;
  varying vec3 vWorld;
  ${skyGLSL(variant)}
  ${NOISE_GLSL}
  void main() {
    vec2 q = vUv - 0.5;
    float body = smoothstep(0.5, 0.1, length(q * vec2(1.0, 1.9)));
    float n = fbm(vec2(vUv.x * 2.2, vUv.y * 5.5) + vSeed * 17.0 + vec2(uTime * 0.03, 0.0));
    float n2 = fbm(vec2(vUv.x * 6.0, vUv.y * 11.0) - vSeed * 9.0 + vec2(uTime * 0.05, 0.0));
    float a = smoothstep(0.38, 0.78, n * 0.8 + n2 * 0.35) * body * vFade * uOpacity;
    if (a < 0.003) discard;
    vec3 dir = normalize(vWorld - uCam);
    float toward = max(dot(dir, SKY_LIGHT), 0.0);
    vec3 col = uAmb + uKey * (0.35 + 0.9 * pow(toward, 4.0)) * (0.6 + 0.4 * vUv.y);
    col = mix(col, skyColor(normalize(vec3(dir.x, max(dir.y, 0.0) * 0.4 + 0.02, dir.z))), 0.35);
    gl_FragColor = vec4(col, a);
  }
`;
}

/** Soft cloud wisps drifting past near the camera, for parallax and a sense of speed. */
export function Wisps({ variant, flow }: { variant: Variant; flow: { offset: number } }) {
  const night = variant === "night";
  const seeds = useMemo(() => {
    const rnd = mulberry32(99);
    return Array.from({ length: COUNT }, () => ({ x: rnd(), y: rnd(), z: rnd(), w: 22 + rnd() * 30, h: 7 + rnd() * 8, s: rnd() }));
  }, []);
  const { geometry, pos } = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0.5, 0.5, 0);
    g.index = quad.index;
    g.setAttribute("position", quad.getAttribute("position"));
    g.setAttribute("uv", quad.getAttribute("uv"));
    const pos = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const size = new THREE.InstancedBufferAttribute(new Float32Array(seeds.flatMap((s) => [s.w, s.h, s.s])), 3);
    g.setAttribute("iPos", pos);
    g.setAttribute("iSize", size);
    g.instanceCount = COUNT;
    return { geometry: g, pos };
  }, [seeds]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment(variant),
        uniforms: {
          uTime: { value: 0 },
          uKey: { value: lin(sky(variant).light.color, night ? 0.25 : 0.9) },
          uAmb: { value: night ? lin("#3b4382", 0.5) : lin("#f1dcf3", 0.9) },
          uCam: { value: new THREE.Vector3() },
          uOpacity: { value: night ? 0.3 : 0.42 },
        },
        transparent: true,
        depthWrite: false,
      }),
    [variant, night],
  );
  useEffect(() => () => material.dispose(), [material]);

  useFrame((state, dt) => {
    const cp = state.camera.position;
    material.uniforms.uTime.value += Math.min(dt, 0.05);
    material.uniforms.uCam.value.copy(cp);
    const a = pos.array as Float32Array;
    const top = WORLD.clouds.seaTop;
    seeds.forEach((s, i) => {
      const wrap = (v: number, b: number) => ((((v % b) + b) % b) - b / 2);
      a[i * 3] = cp.x + wrap(s.x * BOX.x - cp.x, BOX.x);
      a[i * 3 + 1] = top + 3 + s.y * BOX.y;
      a[i * 3 + 2] = cp.z + wrap(s.z * BOX.z + flow.offset * 1.15 - cp.z, BOX.z);
    });
    pos.needsUpdate = true;
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />;
}
