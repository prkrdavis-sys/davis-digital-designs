import * as THREE from "three";
import type { Variant } from "@/worlds/types";

export const COLORS: Record<string, string> = {
  pink: "#ff5c9d",
  cyan: "#3edcff",
  yellow: "#ffd84a",
  violet: "#9b6bff",
  orange: "#ff8a3d",
  green: "#5dffa8",
  red: "#ff3b4e",
  white: "#fff4e0",
};

const hdr = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);

/**
 * Real-time stand-ins for the Blender materials, keyed by the Blender material
 * name carried in the GLB. Returns null for keys handled by dedicated shaders.
 */
export function hardwareMaterial(key: string, variant: Variant): THREE.Material | null {
  const night = variant === "night";
  const suffix = key.split("_").slice(1).join("_");
  const tint = COLORS[suffix] ?? "#ffffff";
  switch (true) {
    case key === "chrome":
      return new THREE.MeshStandardMaterial({ color: "#f2f2f8", metalness: 1, roughness: 0.07, envMapIntensity: 1.15 });
    case key === "chrome_dark":
      return new THREE.MeshStandardMaterial({ color: "#a5a5b4", metalness: 1, roughness: 0.2 });
    case key === "white_plastic":
      return new THREE.MeshPhysicalMaterial({ color: "#f6f1ea", roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, emissive: night ? hdr("#ffe2c4", 0.05) : new THREE.Color(0) });
    case key.startsWith("rubber_"):
      return new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.42, clearcoat: 0.4, clearcoatRoughness: 0.2, sheen: 0.4, sheenColor: new THREE.Color("#ffffff"), emissive: hdr(tint, night ? 0.08 : 0) });
    case key.startsWith("plastic_"):
      return new THREE.MeshPhysicalMaterial({
        color: tint,
        roughness: 0.06,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        transparent: true,
        opacity: night ? 0.72 : 0.64,
        emissive: hdr(tint, night ? 0.55 : 0.12),
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    case key === "ramp_plastic":
      return new THREE.MeshPhysicalMaterial({
        color: "#c6f7ff",
        roughness: 0.04,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        transparent: true,
        opacity: night ? 0.32 : 0.28,
        emissive: hdr("#3edcff", night ? 0.3 : 0.04),
        envMapIntensity: 1.6,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    case key === "print":
      return new THREE.MeshStandardMaterial({ color: "#fbf7ef", roughness: 0.35, emissive: hdr("#fff3e6", night ? 0.12 : 0) });
    case key === "bumper_body":
      return new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.25, transparent: true, opacity: 0.78, clearcoat: 1, emissive: hdr("#ffd9b0", night ? 0.9 : 0.12) });
    case key.startsWith("cap_"):
      return new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.04, emissive: new THREE.Color(tint), emissiveIntensity: night ? 1.2 : 0.35 });
    case key.startsWith("insert_"):
      return new THREE.MeshBasicMaterial({ color: hdr(tint, night ? 5 : 2.2), toneMapped: false });
    case key.startsWith("target_"):
      return new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05, emissive: hdr(tint, night ? 0.35 : 0.05) });
    case key === "bulb":
      return new THREE.MeshBasicMaterial({ color: hdr("#ffc58a", night ? 7 : 2.5), toneMapped: false });
    case key.startsWith("neon_"):
      return new THREE.MeshBasicMaterial({ color: hdr(tint, night ? 9 : 1.6), toneMapped: false });
    case key === "ball":
      return new THREE.MeshStandardMaterial({ color: "#f4f4fa", metalness: 1, roughness: 0.03 });
    case key.startsWith("chase_"):
    case key === "backglass":
    case key === "dmd":
    case key === "dmd_text":
      return null;
    default:
      return new THREE.MeshStandardMaterial({ color: "#cccccc", roughness: 0.5 });
  }
}

const lampVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute vec2 aLamp;
  varying vec3 vColor;
  varying vec2 vLamp;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vColor = aColor;
    vLamp = aLamp;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

/**
 * Playfield inserts: aLamp = (group id, index within group). Patterns per group
 * (chases, blinks, the MULTIBALL letters) are evaluated on the GPU.
 */
const insertFragment = /* glsl */ `
  uniform float uTime;
  uniform float uS;
  uniform float uLetters;
  uniform float uMulti;
  uniform float uGain;
  uniform float uIdle;
  varying vec3 vColor;
  varying vec2 vLamp;
  varying vec3 vN;
  varying vec3 vV;
  float chase(float speed, float seq, float count) { return step(fract(uTime * speed - seq / count), 1.0 / count + 0.02); }
  void main() {
    float g = vLamp.x;
    float k = vLamp.y;
    float lit = 0.0;
    if (g < 0.5) lit = max(chase(1.6, k, 3.0), smoothstep(0.55, 0.8, uS) * (1.0 - smoothstep(1.3, 1.5, uS)));
    else if (g < 1.5) lit = chase(1.2, k, 3.0);
    else if (g < 2.5) lit = 0.5 + 0.5 * sin(uTime * 3.2 - k * 0.9);
    else if (g < 3.5) lit = max(step(0.5, fract(uTime * 1.6)), uMulti);
    else if (g < 4.5) lit = step(0.5, fract(uTime * 0.7));
    else if (g < 5.5) lit = step(0.35, fract(uTime * 0.5 + k * 0.23));
    else if (g < 6.5) lit = max(step(0.5, fract(uTime * 2.0 + k * 0.25)) * uMulti, 0.25);
    else if (g < 7.5) lit = chase(1.1, k, 6.0);
    else if (g < 8.5) lit = chase(1.8, 2.0 - k, 3.0);
    else lit = max(step(k + 0.5, uLetters), uMulti * step(0.5, fract(uTime * 3.0)));
    lit = max(lit, uIdle);
    float facing = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
    vec3 off = vColor * 0.08;
    vec3 on = vColor * uGain * (0.75 + 0.25 * facing);
    gl_FragColor = vec4(mix(off, on, lit), 1.0);
  }
`;

export function insertMaterial(variant: Variant) {
  return new THREE.ShaderMaterial({
    vertexShader: lampVertex,
    fragmentShader: insertFragment,
    uniforms: { uTime: { value: 0 }, uS: { value: 0 }, uLetters: { value: 0 }, uMulti: { value: 0 }, uGain: { value: variant === "night" ? 6 : 2.6 }, uIdle: { value: 0 } },
    toneMapped: false,
  });
}

/** Backglass border bulbs: a three-colour chase that speeds up for multiball. */
const chaseFragment = /* glsl */ `
  uniform float uTime;
  uniform float uMulti;
  uniform float uGain;
  varying vec3 vColor;
  varying vec2 vLamp;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float k = vLamp.y;
    float slow = step(0.5, fract(uTime * 0.8 - k / 6.0));
    float fast = step(0.66, fract(uTime * 4.0 - k / 3.0));
    float lit = mix(slow, max(fast, 0.35), uMulti);
    float facing = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
    gl_FragColor = vec4(vColor * (0.12 + lit * uGain * (0.6 + 0.4 * facing)), 1.0);
  }
`;

export function chaseMaterial(variant: Variant) {
  return new THREE.ShaderMaterial({
    vertexShader: lampVertex,
    fragmentShader: chaseFragment,
    uniforms: { uTime: { value: 0 }, uMulti: { value: 0 }, uGain: { value: variant === "night" ? 7 : 3.2 } },
    toneMapped: false,
  });
}

export const INSERT_GROUPS = ["ramp", "orbit", "arc", "jackpot", "shoot", "lanes", "targets", "toplanes", "right", "letters"];
