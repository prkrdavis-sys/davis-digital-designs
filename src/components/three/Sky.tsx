"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { sceneState } from "@/components/three/sceneState";

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform float uNight;
  uniform float uTime;
  uniform float uDay;
  uniform vec2 uSun;
  uniform vec2 uPointer;
  uniform float uAspect;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 uv = vUv;
    // Subtle parallax with the pointer so the sky feels deep.
    uv += uPointer * 0.012;

    float g = smoothstep(0.0, 1.0, uv.y);
    vec3 col = mix(uBottom, uTop, g);

    // Soft horizon glow
    float horizon = exp(-pow((uv.y - 0.32) * 4.0, 2.0));
    col += horizon * mix(vec3(0.12, 0.08, 0.02), vec3(0.05, 0.05, 0.12), uNight) * 0.9;

    // Sun / moon disc
    vec2 d = (uv - uSun) * vec2(uAspect, 1.0);
    float dist = length(d);
    float sun = smoothstep(0.075, 0.06, dist);
    float halo = exp(-dist * 6.0) * 0.55;
    vec3 sunColor = mix(vec3(1.0, 0.95, 0.75), vec3(0.9, 0.93, 1.0), uNight);
    col += (sun + halo * (1.0 - uNight * 0.6)) * sunColor * (0.8 + 0.2 * uDay);

    // Stars fade in with night
    vec2 sp = uv * vec2(180.0 * uAspect, 180.0);
    vec2 cell = floor(sp);
    float star = step(0.985, hash(cell));
    float twinkle = 0.55 + 0.45 * sin(uTime * 2.0 + hash(cell + 3.1) * 40.0);
    float starMask = star * twinkle * smoothstep(0.35, 1.0, uv.y);
    col += starMask * uNight * 0.9;

    // Slow drifting cloud bands (day) / aurora ribbons (night)
    float band = sin(uv.x * 6.0 + uTime * 0.12 + sin(uv.y * 9.0 + uTime * 0.07) * 1.5) * 0.5 + 0.5;
    float bandMask = smoothstep(0.55, 0.95, uv.y) * band * 0.08;
    col += bandMask * mix(vec3(1.0), vec3(0.3, 0.9, 0.7), uNight);

    // Vignette
    float v = smoothstep(1.4, 0.4, length((vUv - 0.5) * vec2(1.2, 1.0)));
    col *= 0.85 + 0.15 * v;

    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * Fullscreen gradient sky rendered behind everything. Time of day, night
 * blend, sun position and star field are all driven from sceneState.
 */
export function Sky() {
  const mat = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTop: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uNight: { value: 0 },
      uTime: { value: 0 },
      uDay: { value: 0 },
      uSun: { value: new THREE.Vector2(0.75, 0.7) },
      uPointer: { value: new THREE.Vector2() },
      uAspect: { value: 1 },
    }),
    [],
  );

  useFrame((state, dt) => {
    const u = mat.current?.uniforms;
    if (!u) return;
    u.uTime.value += dt;
    u.uTop.value.copy(sceneState.skyTop);
    u.uBottom.value.copy(sceneState.skyBottom);
    u.uNight.value = sceneState.night;
    u.uDay.value = 1 - sceneState.time;
    u.uAspect.value = state.size.width / state.size.height;
    // Sun arcs from upper right (dawn) down to the horizon (dusk), moon rises at night.
    const t = sceneState.time;
    const arc = Math.sin(t * Math.PI);
    u.uSun.value.set(0.82 - t * 0.6, 0.42 + arc * 0.4);
    u.uPointer.value.lerp(new THREE.Vector2(state.pointer.x, state.pointer.y), 0.05);
  });

  return (
    <mesh frustumCulled={false} renderOrder={-100}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={mat}
        vertexShader={vertex}
        fragmentShader={fragment}
        uniforms={uniforms}
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
      />
    </mesh>
  );
}
