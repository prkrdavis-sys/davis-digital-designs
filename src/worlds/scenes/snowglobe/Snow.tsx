"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { useSceneTime } from "@/components/three/engine/slot";
import { sampleScalar, type SnowMeta } from "@/worlds/scenes/snowglobe/data";

const vertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform vec3 uCenter;
  uniform float uRadius;
  uniform float uBottom;
  uniform float uFall;
  uniform float uSpin;
  uniform float uShake;
  uniform float uTime;
  uniform float uProj;
  uniform float uFocus;
  varying float vAlpha;
  varying float vBlur;
  varying float vTwinkle;
  void main() {
    float top = uCenter.y + uRadius;
    float h = top - uBottom;
    // Settled snow falls slowly; a shake lifts it and throws it around the dome.
    float speed = 0.35 + 0.65 * aSeed.x;
    float y = uBottom + mod(aSeed.y * h - uFall * speed * 0.03, h);
    float lift = uShake * (0.35 + 0.65 * aSeed.w) * h * 0.35 * (0.5 + 0.5 * sin(uTime * 0.6 + aSeed.z * 30.0));
    y = min(y + lift, top - 0.02);
    float r0 = sqrt(aSeed.z);
    float ang = aSeed.w * 6.2831 + uSpin * (1.4 - r0) * (0.6 + aSeed.x);
    float dy = y - uCenter.y;
    float rMax = sqrt(max(uRadius * uRadius - dy * dy, 0.0)) * 0.96;
    vec3 p = vec3(cos(ang) * r0 * rMax, y, sin(ang) * r0 * rMax);
    // Flutter
    float t = uTime * (0.6 + aSeed.x);
    p.x += sin(t * 1.3 + aSeed.y * 40.0) * 0.006 * (1.0 + uShake * 3.0);
    p.z += cos(t * 1.1 + aSeed.w * 40.0) * 0.006 * (1.0 + uShake * 3.0);
    p.xz += uCenter.xz;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    float size = 0.0026 + 0.0042 * aSeed.x * aSeed.x;
    float coc = clamp(abs(depth - uFocus) / max(uFocus, 1e-3) * 1.2, 0.0, 1.0);
    vBlur = coc;
    gl_PointSize = clamp(size * uProj / max(depth, 1e-3) * (1.0 + coc * 2.2), 1.0, 70.0);
    vAlpha = smoothstep(0.012, 0.06, depth) * (1.0 - coc * 0.6);
    vTwinkle = 0.75 + 0.25 * sin(uTime * (2.0 + aSeed.y * 5.0) + aSeed.z * 20.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vBlur;
  varying float vTwinkle;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float bead = exp(-r * r * 3.5);
    float disc = smoothstep(1.0, 0.8, r) * 0.55;
    float a = mix(bead, disc, vBlur) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * vTwinkle, a);
  }
`;

const COUNT = 3200;

/** Snowfall inside the globe: settles slowly, swirls when the globe is "shaken" (scroll + the outro). */
export function Snow({ meta, variant, focus }: { meta: SnowMeta; variant: Variant; focus: { distance: number } }) {
  const time = useSceneTime();
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const seed = new Float32Array(COUNT * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    return g;
  }, []);
  const uniforms = useMemo(
    () => ({
      uCenter: { value: new THREE.Vector3(...meta.globe.center) },
      uRadius: { value: meta.globe.rIn },
      uBottom: { value: meta.globe.baseTop + 0.02 },
      uFall: { value: 0 },
      uSpin: { value: 0 },
      uShake: { value: 0 },
      uTime: { value: 0 },
      uProj: { value: 1000 },
      uFocus: { value: 1 },
      uColor: { value: new THREE.Color(variant === "night" ? "#dfe9ff" : "#ffffff").multiplyScalar(variant === "night" ? 1.4 : 1.15) },
    }),
    [meta, variant],
  );

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    const shake = Math.min(1, sampleScalar(meta.shake, time.s) + Math.min(0.5, Math.abs(time.velocity) * 0.6));
    uniforms.uShake.value += (shake - uniforms.uShake.value) * (1 - Math.exp(-d * 3));
    const k = uniforms.uShake.value;
    uniforms.uFall.value += d * (1 - 0.7 * k);
    uniforms.uSpin.value += d * (0.04 + k * 1.6);
    uniforms.uTime.value += d;
    const cam = state.camera as THREE.PerspectiveCamera;
    uniforms.uProj.value = (state.gl.getDrawingBufferSize(tmp).y * 0.5) / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    uniforms.uFocus.value = focus.distance;
  });

  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={6}>
      <shaderMaterial vertexShader={vertex} fragmentShader={fragment} uniforms={uniforms} transparent depthWrite={false} />
    </points>
  );
}

const tmp = new THREE.Vector2();
