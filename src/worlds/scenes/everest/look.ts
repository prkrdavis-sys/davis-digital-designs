import * as THREE from "three";
import type { ToneMap } from "@/components/three/engine/compositor";
import type { Variant } from "@/worlds/types";

/**
 * Light and air, shared by every part of the scene. The sun/moon directions
 * match art/worlds/everest/build.py LIGHT (the terrain bake), so live
 * highlights, haze glow and the sky agree with the baked shadows.
 *
 * The terrain bake is normalized so its brightest snow sits at 0.9 and is
 * shown display-referred: `terrainGain` and `terrainTint` grade it, and the
 * neutral tone mapper leaves everything under ~0.8 untouched, so the frame
 * keeps the bake's contrast while the gold line and lamps still bloom.
 */
export interface EverestLook {
  tone: ToneMap;
  exposure: number;
  /** Azimuth (clockwise from north) and elevation of the key light, degrees. */
  az: number;
  el: number;
  keyColor: string;
  zenith: string;
  horizon: string;
  /** Aerial perspective color, and its warm tint toward the key light. */
  haze: string;
  hazeKey: string;
  fogDensity: number;
  /** Multiplies the baked terrain color. */
  terrainGain: number;
  terrainTint: string;
  /** Pushes the baked shading apart around mid grey (1 = as baked). */
  terrainContrast: number;
  /** Multiplier for sky-lit (bluish) snow: < 1 deepens the cool shadows. */
  shadowDepth: number;
  saturation: number;
  gold: string;
  goldHot: string;
  cloud: string;
  cloudShade: string;
  cloudOpacity: number;
  contour: string;
  contourStrength: number;
  label: string;
  labelMuted: string;
  card: string;
  cardOpacity: number;
}

export const LOOKS: Record<Variant, EverestLook> = {
  day: {
    tone: "neutral",
    exposure: 1.0,
    az: 242,
    el: 17,
    keyColor: "#ffc590",
    zenith: "#164a9a",
    horizon: "#a9c3e3",
    haze: "#9cb6d9",
    hazeKey: "#ffd3a6",
    fogDensity: 0.0021,
    terrainGain: 1.0,
    terrainTint: "#ffffff",
    terrainContrast: 1.16,
    shadowDepth: 0.55,
    saturation: 1.02,
    gold: "#ffb21f",
    goldHot: "#fff0bf",
    cloud: "#fffaf3",
    cloudShade: "#8fa3c4",
    cloudOpacity: 0.92,
    contour: "#fff6e2",
    contourStrength: 0.07,
    label: "#ffffff",
    labelMuted: "#c9d6ea",
    card: "#0d1a2c",
    cardOpacity: 0.68,
  },
  night: {
    tone: "neutral",
    exposure: 1.0,
    az: 118,
    el: 34,
    keyColor: "#b9ccff",
    zenith: "#01030a",
    horizon: "#0d1a36",
    haze: "#0a1530",
    hazeKey: "#1f3766",
    fogDensity: 0.003,
    terrainGain: 0.34,
    terrainTint: "#a9bcff",
    terrainContrast: 1.15,
    shadowDepth: 0.7,
    saturation: 0.85,
    gold: "#ffbd3a",
    goldHot: "#fff3cf",
    cloud: "#7f93c2",
    cloudShade: "#141f3a",
    cloudOpacity: 0.8,
    contour: "#8fb6ff",
    contourStrength: 0.06,
    label: "#f3f6ff",
    labelMuted: "#aab9dc",
    card: "#050a16",
    cardOpacity: 0.72,
  },
};

/** Unit vector toward the key light in three.js axes (north = -z). */
export function keyDirection(look: EverestLook, out = new THREE.Vector3()): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(look.az);
  const el = THREE.MathUtils.degToRad(look.el);
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/** GLSL shared by the terrain, skirt, clouds and sky: aerial perspective. */
export const HAZE_GLSL = /* glsl */ `
  uniform vec3 uHaze;
  uniform vec3 uHazeKey;
  uniform vec3 uKey;
  uniform float uFogDensity;
  vec3 inscatter(vec3 dir) {
    float mu = max(dot(dir, uKey), 0.0);
    return mix(uHaze, uHazeKey, pow(mu, 5.0) * 0.85);
  }
  // Exponential haze thinning with altitude (scale height ~4.3 km at 1 unit = 100 m, x1.15).
  float hazeAmount(vec3 cam, vec3 p) {
    float d = length(p - cam);
    float h = max(0.0, min(cam.y, p.y) * 0.5 + max(cam.y, p.y) * 0.5 - 20.0);
    float dens = uFogDensity * exp(-h * 0.02);
    return 1.0 - exp(-d * dens);
  }
`;

export function hazeUniforms(look: EverestLook) {
  return {
    uHaze: { value: new THREE.Color(look.haze) },
    uHazeKey: { value: new THREE.Color(look.hazeKey) },
    uKey: { value: keyDirection(look) },
    uFogDensity: { value: look.fogDensity },
  };
}
