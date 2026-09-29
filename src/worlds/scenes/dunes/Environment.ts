"use client";

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ATMOSPHERE_GLSL, type AtmosphereUniforms } from "@/worlds/scenes/dunes/atmosphere";

const vertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  ${ATMOSPHERE_GLSL}
  uniform vec3 uDiscColor;
  uniform float uDiscStrength;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    vec3 col = dunesSky(d);
    // A broad, bright sun keeps glossy highlights crisp after prefiltering.
    float ang = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
    col += uDiscColor * uDiscStrength * smoothstep(0.045, 0.02, ang);
    // Sand below the horizon: warm, lit by the low sun.
    float below = smoothstep(0.02, -0.08, d.y);
    col = mix(col, dunesHaze(d) * vec3(1.05, 0.82, 0.62) * 0.9, below);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Prefiltered environment from the painted sky, for glass, metal and props. */
export function useSkyEnvironment(atmosphere: AtmosphereUniforms, disc: { color: string; strength: number }): THREE.Texture {
  const gl = useThree((s) => s.gl);
  const target = useMemo(() => {
    const scene = new THREE.Scene();
    const material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { ...atmosphere, uDiscColor: { value: new THREE.Color(disc.color) }, uDiscStrength: { value: disc.strength } },
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), material);
    scene.add(sphere);
    const pmrem = new THREE.PMREMGenerator(gl);
    const rt = pmrem.fromScene(scene, 0, 0.1, 400);
    pmrem.dispose();
    sphere.geometry.dispose();
    material.dispose();
    return rt;
  }, [gl, atmosphere, disc.color, disc.strength]);
  useEffect(() => () => target.dispose(), [target]);
  return target.texture;
}
