"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { lin, NOISE_GLSL, sky, skyGLSL } from "@/worlds/scenes/planes/shaders";

const vertex = /* glsl */ `
  varying vec2 vNdc;
  void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`;

function fragment(variant: Variant) {
  return /* glsl */ `
  varying vec2 vNdc;
  uniform mat4 uCamWorld;
  uniform mat4 uProjInv;
  uniform float uTime;
  uniform vec3 uDisc;
  uniform float uDiscCos;
  uniform vec3 uCirrus;
  uniform float uNight;
  ${skyGLSL(variant)}
  ${NOISE_GLSL}

  vec3 stars(vec3 dir) {
    vec3 acc = vec3(0.0);
    for (int l = 0; l < 3; l++) {
      float scale = l == 0 ? 70.0 : (l == 1 ? 140.0 : 260.0);
      vec3 p = dir * scale;
      vec3 cell = floor(p);
      vec3 fr = fract(p);
      float h = hash13(cell + float(l) * 17.0);
      float thresh = l == 0 ? 0.972 : (l == 1 ? 0.955 : 0.93);
      if (h > thresh) {
        vec3 sp = vec3(hash13(cell + 1.3), hash13(cell + 7.1), hash13(cell + 3.7)) * 0.7 + 0.15;
        float d = length(fr - sp);
        float b = (h - thresh) / (1.0 - thresh);
        float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 4.0) + h * 60.0);
        vec3 tint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.86, 0.72), hash13(cell + 11.0));
        acc += tint * exp(-d * d * (l == 0 ? 90.0 : 160.0)) * (0.6 + b * 5.0) * tw * (l == 0 ? 1.6 : 1.0);
      }
    }
    return acc;
  }

  void main() {
    vec4 v = uProjInv * vec4(vNdc, 1.0, 1.0);
    vec3 dir = normalize(mat3(uCamWorld) * normalize(v.xyz / v.w));
    vec3 col = skyColor(dir);
    float e = dir.y;

    // High pastel cirrus, streaked along the wind, brightest toward the light.
    if (e > 0.01) {
      vec2 q = dir.xz / (e + 0.18);
      float n = fbm(q * vec2(0.9, 3.2) + vec2(uTime * 0.004, 0.0));
      float n2 = fbm(q * vec2(2.5, 7.0) - vec2(0.0, uTime * 0.006));
      float band = smoothstep(0.03, 0.14, e) * (1.0 - smoothstep(0.35, 0.8, e));
      float c = smoothstep(0.52, 0.85, n * 0.75 + n2 * 0.35) * band;
      float glow = pow(max(dot(dir, SKY_LIGHT), 0.0), 3.0);
      col = mix(col, uCirrus * (0.7 + glow * 1.6), c * 0.55);
    }

    // Sun or moon disc.
    float d = dot(dir, SKY_LIGHT);
    float disc = smoothstep(uDiscCos, mix(uDiscCos, 1.0, 0.3), d);
    if (uNight > 0.5) {
      vec3 t = normalize(cross(SKY_LIGHT, vec3(0.0, 1.0, 0.0)));
      vec3 bt = cross(t, SKY_LIGHT);
      vec2 mp = vec2(dot(dir, t), dot(dir, bt)) / sqrt(max(1e-6, 1.0 - uDiscCos * uDiscCos));
      float maria = fbm(mp * 3.0 + 4.0) * 0.6 + fbm(mp * 9.0) * 0.4;
      float limb = sqrt(max(0.0, 1.0 - dot(mp, mp)));
      col = mix(col, uDisc * (0.55 + 0.45 * smoothstep(0.35, 0.7, maria)) * (0.55 + 0.45 * limb), disc);
      col += stars(dir) * smoothstep(0.0, 0.18, e) * (1.0 - disc) * 0.9;
    } else {
      col += uDisc * disc;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;
}

/** Full-screen sky: gradient + halos (matching Cycles), disc, cirrus, stars. */
export function Sky({ variant }: { variant: Variant }) {
  const night = variant === "night";
  const s = sky(variant);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment(variant),
        uniforms: {
          uCamWorld: { value: new THREE.Matrix4() },
          uProjInv: { value: new THREE.Matrix4() },
          uTime: { value: 0 },
          uDisc: { value: lin(s.light.disc, night ? 5 : 40) },
          uDiscCos: { value: Math.cos(THREE.MathUtils.degToRad(s.light.discSize)) },
          uCirrus: { value: night ? lin("#8c93d6", 0.35) : lin("#fff0e6", 1.05) },
          uNight: { value: night ? 1 : 0 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    [variant, night, s],
  );
  useFrame((state, dt) => {
    const u = material.uniforms;
    u.uTime.value += Math.min(dt, 0.05);
    u.uCamWorld.value.copy(state.camera.matrixWorld);
    u.uProjInv.value.copy(state.camera.projectionMatrixInverse);
  });
  return (
    <mesh frustumCulled={false} renderOrder={-100} material={material}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3]} />
      </bufferGeometry>
    </mesh>
  );
}
