"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { useColorTextures } from "@/components/three/engine/assets";
import { useSceneTime, useSlot } from "@/components/three/engine/slot";
import type { PinballMeta } from "@/worlds/scenes/pinball/model";
import type { TableState } from "@/worlds/scenes/pinball/state";

export const MAX_BALLS = 8;

const vertex = /* glsl */ `
  uniform mat4 uTexMatrix;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec4 vRefl;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vRefl = uTexMatrix * wp;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uArt;
  uniform sampler2D uLight;
  uniform sampler2D uRefl;
  uniform vec2 uReflTexel;
  uniform float uLightScale;
  uniform float uReflStrength;
  uniform vec3 uBumperPos[3];
  uniform vec3 uBumperCol[3];
  uniform float uBumperFlash[3];
  uniform vec4 uBalls[${MAX_BALLS}];
  uniform float uNight;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec4 vRefl;

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }

  void main() {
    vec3 albedo = texture2D(uArt, vUv).rgb;
    vec3 light = texture2D(uLight, vUv).rgb * uLightScale;
    vec2 xz = vWorld.xz;

    // Live bumper flashes spill colour onto the paint.
    vec3 spill = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      float d = length(xz - uBumperPos[i].xz);
      spill += uBumperCol[i] * uBumperFlash[i] * exp(-d * d * 1.6) * (1.2 + uNight * 2.2);
    }
    // Soft contact shadows under balls rolling on the playfield.
    float shadow = 1.0;
    for (int i = 0; i < ${MAX_BALLS}; i++) {
      vec4 b = uBalls[i];
      if (b.w < 0.5) continue;
      float h = max(b.y - 0.16, 0.0);
      float d = length(xz - b.xz);
      float r = 0.12 + h * 0.35;
      shadow *= 1.0 - 0.72 * exp(-d * d / (r * r)) / (1.0 + h * 6.0);
    }
    vec3 base = albedo * (light * shadow + spill);

    // Clear coat: mirror reflection of the table, slightly wavy and softened.
    vec3 V = normalize(cameraPosition - vWorld);
    float cosT = clamp(V.y, 0.0, 1.0);
    float F = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
    vec2 wob = (vec2(vnoise(vUv * vec2(90.0, 180.0)), vnoise(vUv * vec2(90.0, 180.0) + 17.0)) - 0.5) * 0.0035;
    vec2 ruv = vRefl.xy / vRefl.w + wob;
    vec2 o = uReflTexel * 1.25;
    vec3 refl = texture2D(uRefl, ruv).rgb * 0.4
      + (texture2D(uRefl, ruv + vec2(o.x, 0.0)).rgb + texture2D(uRefl, ruv - vec2(o.x, 0.0)).rgb
      + texture2D(uRefl, ruv + vec2(0.0, o.y)).rgb + texture2D(uRefl, ruv - vec2(0.0, o.y)).rgb) * 0.15;
    vec3 col = base * (1.0 - F * 0.5) + refl * F * uReflStrength;
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * The playfield: the painted artwork multiplied by the Cycles lightmap for this
 * variant, under a live mirror-like clear coat. The mirror pass re-renders the
 * table from below the plane each frame at half resolution.
 */
export function Playfield({ variant, meta, state }: { variant: Variant; meta: PinballMeta; state: TableState }) {
  const [art, light] = useColorTextures(["/worlds/pinball/hi/playfield.webp", `/worlds/pinball/hi/lightmap-${variant}.webp`]);
  const slot = useSlot();
  const time = useSceneTime();
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const mesh = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(6, 12, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, -6);
    return g;
  }, []);
  const target = useMemo(() => new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true }), []);
  const mirror = useMemo(() => new THREE.PerspectiveCamera(), []);
  const material = useMemo(() => {
    art.anisotropy = 16;
    art.generateMipmaps = true;
    return new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uArt: { value: art },
        uLight: { value: light },
        uRefl: { value: target.texture },
        uReflTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
        uTexMatrix: { value: new THREE.Matrix4() },
        uLightScale: { value: 2.0 },
        uReflStrength: { value: variant === "night" ? 1.05 : 0.9 },
        uBumperPos: { value: meta.bumpers.map((b) => new THREE.Vector3(...b.p)) },
        uBumperCol: { value: meta.bumpers.map((b) => new THREE.Color(b.color)) },
        uBumperFlash: { value: [0, 0, 0] },
        uBalls: { value: Array.from({ length: MAX_BALLS }, () => new THREE.Vector4()) },
        uNight: { value: variant === "night" ? 1 : 0 },
      },
    });
  }, [art, light, target, variant, meta]);

  useEffect(
    () => () => {
      target.dispose();
      material.dispose();
      geometry.dispose();
    },
    [target, material, geometry],
  );

  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.0005), []);
  const tmp = useMemo(() => ({ fwd: new THREE.Vector3(), up: new THREE.Vector3(), at: new THREE.Vector3(), bias: new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1) }), []);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const u = material.uniforms;
    for (let i = 0; i < 3; i++) u.uBumperFlash.value[i] = state.bumperFlash[i];
    for (let i = 0; i < MAX_BALLS; i++) {
      const b = state.balls[i];
      if (b) u.uBalls.value[i].set(b.pos.x, b.pos.y, b.pos.z, b.visible ? 1 : 0);
      else u.uBalls.value[i].w = 0;
    }
    if (!time.visible) return;

    const dpr = gl.getPixelRatio();
    const w = Math.max(2, Math.round(size.width * dpr * 0.5));
    const h = Math.max(2, Math.round(size.height * dpr * 0.5));
    if (target.width !== w || target.height !== h) {
      target.setSize(w, h);
      u.uReflTexel.value.set(1 / w, 1 / h);
    }

    // Mirror the scene camera through the playfield plane (y = 0).
    const cam = slot.camera;
    cam.updateMatrixWorld();
    mirror.position.set(cam.position.x, -cam.position.y, cam.position.z);
    cam.getWorldDirection(tmp.fwd);
    tmp.fwd.y *= -1;
    tmp.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    tmp.up.y *= -1;
    mirror.up.copy(tmp.up);
    tmp.at.copy(mirror.position).add(tmp.fwd);
    mirror.lookAt(tmp.at);
    mirror.near = cam.near;
    mirror.far = cam.far;
    mirror.projectionMatrix.copy(cam.projectionMatrix);
    mirror.projectionMatrixInverse.copy(cam.projectionMatrixInverse);
    mirror.updateMatrixWorld();
    u.uTexMatrix.value.copy(tmp.bias).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

    const prevTarget = gl.getRenderTarget();
    const prevClip = gl.clippingPlanes;
    m.visible = false;
    gl.clippingPlanes = [plane];
    gl.setRenderTarget(target);
    gl.clear();
    gl.render(slot.scene, mirror);
    gl.setRenderTarget(prevTarget);
    gl.clippingPlanes = prevClip;
    m.visible = true;
  });

  return <mesh ref={mesh} geometry={geometry} material={material} renderOrder={0} />;
}
