import * as THREE from "three";
import type { Variant } from "@/worlds/types";

/**
 * Light and air, shared by every part of the scene. The sun/moon directions
 * match art/worlds/everest/build.py LIGHT (the terrain bake), so live
 * highlights, haze glow and the sky agree with the baked shadows.
 */
export interface EverestLook {
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
  gold: string;
  goldHot: string;
  cloud: string;
  cloudShade: string;
  contour: string;
  contourStrength: number;
  label: string;
  labelMuted: string;
}

export const LOOKS: Record<Variant, EverestLook> = {
  day: {
    az: 242,
    el: 17,
    keyColor: "#ffc590",
    zenith: "#3a6db3",
    horizon: "#d9e3ee",
    haze: "#bfd0e6",
    hazeKey: "#ffd2a1",
    fogDensity: 0.0042,
    terrainGain: 1.0,
    gold: "#ffb52e",
    goldHot: "#fff1c4",
    cloud: "#fff6ec",
    cloudShade: "#9fb1cf",
    contour: "#fff4dc",
    contourStrength: 0.12,
    label: "#ffffff",
    labelMuted: "#e8eef7",
  },
  night: {
    az: 118,
    el: 34,
    keyColor: "#b9ccff",
    zenith: "#01030a",
    horizon: "#0f1c38",
    haze: "#0b1630",
    hazeKey: "#27406e",
    fogDensity: 0.0036,
    terrainGain: 1.0,
    gold: "#ffc043",
    goldHot: "#fff4d2",
    cloud: "#8ea3cf",
    cloudShade: "#1a2744",
    contour: "#7fb0ff",
    contourStrength: 0.16,
    label: "#f3f6ff",
    labelMuted: "#b8c6e6",
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
  // Exponential haze thinning with altitude (scale height ~2.6 km at 1 unit = 100 m, x1.15).
  float hazeAmount(vec3 cam, vec3 p) {
    float d = length(p - cam);
    float h = max(0.0, min(cam.y, p.y) * 0.5 + max(cam.y, p.y) * 0.5 - 20.0);
    float dens = uFogDensity * exp(-h * 0.028);
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
