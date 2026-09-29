"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { pointer } from "@/lib/store";
import { useSceneTime, useSlot } from "@/components/three/engine/slot";

const backdropVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const backdropFragment = /* glsl */ `
  varying vec3 vDir;
  uniform float uNight;
  uniform float uTime;
  uniform vec2 uPointer;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  vec3 bokeh(vec2 uv, float scale, float seed) {
    vec2 g = floor(uv * scale);
    vec2 f = fract(uv * scale) - 0.5;
    float h = hash(g + seed);
    vec2 o = vec2(hash(g + seed + 3.1), hash(g + seed + 7.7)) - 0.5;
    float r = length(f - o * 0.6);
    float size = 0.12 + h * 0.22;
    float disc = smoothstep(size, size - 0.03, r) * (0.55 + 0.45 * smoothstep(size - 0.05, size, r));
    vec3 c = h < 0.33 ? vec3(1.0, 0.36, 0.62) : h < 0.66 ? vec3(0.24, 0.86, 1.0) : vec3(1.0, 0.85, 0.3);
    float on = step(0.45, hash(g + seed + 11.0)) * (0.7 + 0.3 * sin(uTime * (0.5 + h) + h * 30.0));
    return c * disc * on;
  }
  void main() {
    vec3 d = normalize(vDir);
    float az = atan(d.x, -d.z);
    float el = d.y;
    if (uNight < 0.5) {
      // Photo studio: warm white cyc, soft coloured bounce cards left and right.
      vec3 top = vec3(0.98, 0.95, 0.94);
      vec3 hor = vec3(0.96, 0.86, 0.92);
      vec3 low = vec3(0.82, 0.78, 0.9);
      vec3 col = mix(hor, top, smoothstep(0.0, 0.7, el));
      col = mix(col, low, smoothstep(0.05, -0.5, el));
      col += vec3(1.0, 0.45, 0.7) * 0.22 * exp(-pow((az + 1.3) * 1.4, 2.0)) * smoothstep(-0.4, 0.2, el) * smoothstep(0.8, 0.1, el);
      col += vec3(0.3, 0.85, 1.0) * 0.2 * exp(-pow((az - 1.4) * 1.4, 2.0)) * smoothstep(-0.4, 0.2, el) * smoothstep(0.8, 0.1, el);
      gl_FragColor = vec4(col * 1.25, 1.0);
      return;
    }
    // Dark arcade: a band of out-of-focus cabinet lights around the horizon.
    vec3 col = mix(vec3(0.012, 0.006, 0.03), vec3(0.03, 0.012, 0.06), smoothstep(-0.2, 0.35, el));
    col += vec3(0.35, 0.08, 0.3) * 0.12 * exp(-pow(el * 3.0, 2.0));
    vec2 uv = vec2(az / 6.2832 + uPointer.x * 0.004, el * 0.9 + uPointer.y * 0.003);
    float band = smoothstep(-0.25, -0.02, el) * smoothstep(0.42, 0.08, el);
    col += bokeh(uv, 26.0, 1.0) * band * 0.9;
    col += bokeh(uv + 0.37, 14.0, 5.0) * band * 0.55;
    gl_FragColor = vec4(col, 1.0);
  }
`;

interface Fixture {
  kind: "box" | "tube" | "ring";
  pos: [number, number, number];
  size: [number, number, number];
  rot?: [number, number, number];
  color: string;
  power: number;
}

/** Studio fixtures (day) or neon signs (night): seen overhead and in every reflection. */
const FIXTURES: Record<Variant, Fixture[]> = {
  day: [
    { kind: "box", pos: [0, 9.5, -5.5], size: [7, 0.05, 11], color: "#ffffff", power: 3.2 },
    { kind: "tube", pos: [-2.4, 4.6, -5.5], size: [0.09, 13, 0.09], rot: [Math.PI / 2, 0, 0], color: "#eef6ff", power: 5 },
    { kind: "tube", pos: [2.4, 4.6, -5.5], size: [0.09, 13, 0.09], rot: [Math.PI / 2, 0, 0], color: "#eef6ff", power: 5 },
    { kind: "box", pos: [-9, 3.5, -4], size: [0.05, 5, 7], color: "#ffd1e6", power: 1.4 },
    { kind: "box", pos: [9, 3.5, -7], size: [0.05, 5, 7], color: "#d4f5ff", power: 1.4 },
  ],
  night: [
    { kind: "ring", pos: [-10, 5.5, -9], size: [2.2, 0.08, 0], rot: [0, 1.1, 0], color: "#ff4fa0", power: 9 },
    { kind: "ring", pos: [11, 4, -14], size: [1.6, 0.07, 0], rot: [0, -0.9, 0], color: "#2fe6ff", power: 9 },
    { kind: "tube", pos: [-9.5, 2.2, -3], size: [0.07, 6, 0.07], rot: [Math.PI / 2, 0, 0], color: "#2fe6ff", power: 8 },
    { kind: "tube", pos: [9.5, 6.5, -4], size: [0.07, 8, 0.07], rot: [Math.PI / 2, 0, 0], color: "#ff4fa0", power: 8 },
    { kind: "tube", pos: [0, 10.5, -19], size: [0.08, 12, 0.08], rot: [0, 0, Math.PI / 2], color: "#ffe066", power: 6 },
    { kind: "box", pos: [0, 9.8, -5.5], size: [6, 0.05, 10], color: "#3a2a8a", power: 0.35 },
  ],
};

function fixtureMesh(f: Fixture): THREE.Mesh {
  const geo =
    f.kind === "box"
      ? new THREE.BoxGeometry(...f.size)
      : f.kind === "tube"
        ? new THREE.CylinderGeometry(f.size[0], f.size[0], f.size[1], 12, 1)
        : new THREE.TorusGeometry(f.size[0], f.size[1], 12, 96);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(f.color).multiplyScalar(f.power), toneMapped: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...f.pos);
  if (f.rot) m.rotation.set(...f.rot);
  return m;
}

function buildRoom(variant: Variant) {
  const group = new THREE.Group();
  const material = new THREE.ShaderMaterial({
    vertexShader: backdropVertex,
    fragmentShader: backdropFragment,
    uniforms: { uNight: { value: variant === "night" ? 1 : 0 }, uTime: { value: 0 }, uPointer: { value: new THREE.Vector2() } },
    side: THREE.BackSide,
    depthWrite: false,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(90, 48, 24), material);
  sphere.position.set(0, 2, -6);
  sphere.renderOrder = -10;
  sphere.frustumCulled = false;
  group.add(sphere);
  for (const f of FIXTURES[variant]) group.add(fixtureMesh(f));
  return { group, material };
}

function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
}

/** Where the environment probe sits: above the middle of the playfield. */
const PROBE = new THREE.Vector3(0.3, 1.1, -6.2);

/**
 * The room around the machine plus image-based lighting. A PMREM of the bare
 * room lights the first frames; then a cube probe captures the finished table
 * (lit playfield, bumpers, backglass) so chrome and balls reflect the machine.
 */
export function Room({ variant }: { variant: Variant }) {
  const slot = useSlot();
  const gl = useThree((s) => s.gl);
  const time = useSceneTime();
  const room = useMemo(() => buildRoom(variant), [variant]);
  const probe = useRef({ frames: 0, done: false });

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envScene = new THREE.Scene();
    const copy = buildRoom(variant);
    envScene.add(copy.group);
    const rt = pmrem.fromScene(envScene, 0.02, 0.1, 200);
    slot.scene.environment = rt.texture;
    slot.scene.environmentIntensity = 1;
    disposeGroup(copy.group);
    probe.current = { frames: 0, done: false };
    return () => {
      if (slot.scene.environment === rt.texture) slot.scene.environment = null;
      rt.dispose();
      pmrem.dispose();
    };
  }, [gl, slot, variant]);

  const captured = useRef<THREE.WebGLRenderTarget | null>(null);
  useEffect(
    () => () => {
      captured.current?.dispose();
      captured.current = null;
    },
    [variant],
  );

  useFrame((_, dt) => {
    const u = room.material.uniforms;
    u.uTime.value += Math.min(dt, 0.05);
    u.uPointer.value.set(pointer.sx, pointer.sy);
    const p = probe.current;
    if (p.done || !time.visible) return;
    // Wait for materials and textures to settle, then capture the table once.
    if (++p.frames < 20) return;
    p.done = true;
    const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
    const cam = new THREE.CubeCamera(0.05, 200, cubeRT);
    cam.position.copy(PROBE);
    const prevTarget = gl.getRenderTarget();
    cam.update(gl, slot.scene);
    gl.setRenderTarget(prevTarget);
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromCubemap(cubeRT.texture);
    pmrem.dispose();
    cubeRT.dispose();
    const old = slot.scene.environment;
    slot.scene.environment = env.texture;
    captured.current?.dispose();
    captured.current = env;
    if (old && old !== env.texture) old.dispose();
  });

  useEffect(() => () => disposeGroup(room.group), [room]);

  return <primitive object={room.group} />;
}
