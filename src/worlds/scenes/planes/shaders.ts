import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import WORLD from "@/worlds/scenes/planes/world.json";

/** Shared numbers with art/worlds/planes (Cycles renders read the same JSON). */
export { WORLD };

export type SkySpec = (typeof WORLD.sky)["day"];

export function sky(variant: Variant): SkySpec {
  return WORLD.sky[variant];
}

/** Unit vector toward the sun (day) or moon (night). */
export function lightDir(variant: Variant): THREE.Vector3 {
  const { az, el } = WORLD.sky[variant].light;
  const a = THREE.MathUtils.degToRad(az);
  const e = THREE.MathUtils.degToRad(el);
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

/** Linear-space color from an sRGB hex (three's color management converts on set). */
export function lin(hex: string, k = 1): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(k);
}

const f = (x: number) => (Number.isInteger(x) ? `${x}.0` : `${x}`);
const v3 = (c: THREE.Color | THREE.Vector3) => ("r" in c ? `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})` : `vec3(${c.x.toFixed(5)}, ${c.y.toFixed(5)}, ${c.z.toFixed(5)})`);

/**
 * GLSL for the sky gradient, identical to pl_common.sky_world(): a piecewise
 * linear ramp over sin(elevation) plus power-law halos around the light.
 * Defines SKY_LIGHT, skyRamp(e) and skyColor(dir).
 */
export function skyGLSL(variant: Variant): string {
  const s = WORLD.sky[variant];
  const stops = s.ramp.map(([e, hex]) => [e as number, lin(hex as string)] as const);
  let ramp = `vec3 skyRamp(float e) {\n  if (e <= ${f(stops[0][0])}) return ${v3(stops[0][1])};\n`;
  for (let i = 1; i < stops.length; i++) {
    const [e0, c0] = stops[i - 1];
    const [e1, c1] = stops[i];
    ramp += `  if (e <= ${f(e1)}) return mix(${v3(c0)}, ${v3(c1)}, (e - ${f(e0)}) / ${f(e1 - e0)});\n`;
  }
  ramp += `  return ${v3(stops[stops.length - 1][1])};\n}\n`;
  const halos = s.halo.map(([hex, p, k]) => `  c += ${v3(lin(hex as string, k as number))} * min(pow(d, ${f(p as number)}), 1.0);`).join("\n");
  return `
const vec3 SKY_LIGHT = ${v3(lightDir(variant))};
${ramp}
vec3 skyColor(vec3 dir) {
  vec3 c = skyRamp(dir.y);
  float d = max(dot(dir, SKY_LIGHT), 0.0);
${halos}
  return c;
}
`;
}

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 u = fract(p); u = u * u * (3.0 - 2.0 * u);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; }
  return v;
}
`;
