"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { ATMOSPHERE_GLSL, type AtmosphereUniforms } from "@/worlds/scenes/dunes/atmosphere";

const vertex = /* glsl */ `
  uniform mat4 uProjInv;
  uniform mat4 uCamWorld;
  varying vec3 vDir;
  void main() {
    vec4 p = uProjInv * vec4(position.xy, 1.0, 1.0);
    vDir = (uCamWorld * vec4(p.xyz / p.w, 0.0)).xyz;
    gl_Position = vec4(position.xy, 0.99999, 1.0);
  }
`;

const fragment = /* glsl */ `
  ${ATMOSPHERE_GLSL}
  uniform vec3 uDiscDir;
  uniform vec3 uDiscColor;
  uniform float uDiscStrength;
  uniform float uDiscRadius;
  uniform float uNight;
  uniform float uTime;
  varying vec3 vDir;

  float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = hash13(vec3(i, 1.0)), b = hash13(vec3(i + vec2(1, 0), 1.0)), c = hash13(vec3(i + vec2(0, 1), 1.0)), d = hash13(vec3(i + 1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }

  void main() {
    vec3 d = normalize(vDir);
    vec3 col = dunesSky(d);
    float c = dot(d, uDiscDir);
    float r = radians(uDiscRadius);
    float ang = acos(clamp(c, -1.0, 1.0));
    float disc = smoothstep(r * 1.04, r * 0.96, ang);
    if (uNight > 0.5) {
      // Moon: limb-darkened disc with maria.
      vec3 t1 = normalize(cross(uDiscDir, vec3(0.0, 1.0, 0.0)));
      vec3 t2 = cross(t1, uDiscDir);
      vec2 q = vec2(dot(d, t1), dot(d, t2)) / r;
      float maria = 0.72 + 0.28 * vnoise(q * 3.0 + 7.0) * vnoise(q * 7.0 - 3.0) * 2.0;
      float limb = sqrt(max(0.0, 1.0 - dot(q, q)));
      col = mix(col, uDiscColor * uDiscStrength * maria * (0.55 + 0.45 * limb), disc);
      // Twinkle: only the part of a texel brighter than its neighborhood (the star itself) flickers.
      vec3 around = dunesSky(normalize(d + t1 * 0.004)) * 0.5 + dunesSky(normalize(d - t2 * 0.004)) * 0.5;
      vec3 star = max(col - around, 0.0);
      vec3 cell = floor(d * 900.0);
      float tw = 0.6 + 0.8 * sin(uTime * (1.5 + hash13(cell) * 4.0) + hash13(cell + 7.0) * 6.28);
      col += star * (tw - 1.0) * (1.0 - disc);
    } else {
      // Sun: hot disc, with the horizon's dust reddening its lower limb.
      float low = smoothstep(0.08, -0.02, d.y);
      col += uDiscColor * uDiscStrength * disc * mix(vec3(1.0), vec3(1.0, 0.55, 0.3), low);
      col += uSunColor * (exp(-ang / 0.012) * 3.0 + exp(-ang / 0.05) * 0.6);
    }
    // Keep the horizon band continuous with the haze on distant dunes.
    float band = exp(-abs(d.y) / 0.02);
    col = mix(col, dunesHaze(d), band * 0.35);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Full-screen sky: the painted map, the sun or moon disc, twinkling stars. */
export function Sky({ variant, atmosphere, disc }: { variant: Variant; atmosphere: AtmosphereUniforms; disc: { dir: THREE.Vector3; color: string; strength: number; radius: number } }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          ...atmosphere,
          uProjInv: { value: new THREE.Matrix4() },
          uCamWorld: { value: new THREE.Matrix4() },
          uDiscDir: { value: disc.dir.clone() },
          uDiscColor: { value: new THREE.Color(disc.color) },
          uDiscStrength: { value: disc.strength },
          uDiscRadius: { value: disc.radius },
          uNight: { value: variant === "night" ? 1 : 0 },
          uTime: { value: 0 },
        },
        depthWrite: false,
        depthTest: true,
      }),
    [atmosphere, disc, variant],
  );

  useFrame((state, dt) => {
    const cam = state.camera;
    material.uniforms.uProjInv.value.copy(cam.projectionMatrixInverse);
    material.uniforms.uCamWorld.value.copy(cam.matrixWorld);
    material.uniforms.uTime.value += Math.min(dt, 0.05);
  });

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    return g;
  }, []);

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={-100} />;
}
