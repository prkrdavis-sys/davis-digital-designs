import * as THREE from "three";
import type { Variant } from "@/worlds/types";

const fluoroVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vColor;
  attribute vec3 color;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = mv.xyz;
    vColor = color;
    gl_Position = projectionMatrix * mv;
  }
`;

const fluoroFragment = /* glsl */ `
  uniform vec3 uTint;
  uniform vec3 uRim;
  uniform float uOpacity;
  uniform float uIntensity;
  uniform vec3 uFog;
  uniform float uFogDensity;
  uniform bool uVertexColor;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vColor;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(-vV);
    float facing = clamp(dot(n, v), 0.0, 1.0);
    float rim = pow(1.0 - facing, 2.5);
    vec3 base = uTint * (uVertexColor ? mix(vec3(1.0), vColor, 0.35) : vec3(1.0));
    vec3 col = base * (0.25 + 0.75 * facing) * uIntensity + uRim * rim * uIntensity * 1.6;
    float fog = 1.0 - exp(-length(vV) * uFogDensity);
    col = mix(col, uFog, clamp(fog, 0.0, 1.0));
    gl_FragColor = vec4(col, uOpacity);
  }
`;

/** Glowing dye-labelled surface for the night (fluorescence) look. */
export function fluoroMaterial(tint: string, rim: string, fog: string, opts: { intensity?: number; vertexColor?: boolean; transparent?: boolean } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: fluoroVertex,
    fragmentShader: fluoroFragment,
    uniforms: {
      uTint: { value: new THREE.Color(tint) },
      uRim: { value: new THREE.Color(rim) },
      uOpacity: { value: 1 },
      uIntensity: { value: opts.intensity ?? 1.4 },
      uFog: { value: new THREE.Color(fog) },
      uFogDensity: { value: 0.02 },
      uVertexColor: { value: opts.vertexColor ?? true },
    },
    transparent: opts.transparent ?? false,
    depthWrite: !opts.transparent,
  });
}

/** Soft pastel "colorized SEM" surface for the day look. */
export function micrographMaterial(tint: string, opts: { transparent?: boolean; vertexColors?: boolean } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(tint),
    vertexColors: opts.vertexColors ?? true,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.3,
    sheen: 0.6,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color("#ffffff"),
    transparent: opts.transparent ?? false,
  });
}

export const PROTEIN_TINTS: Record<Variant, Record<"histone" | "pcna" | "helicase" | "polymerase" | "groel" | "chromosome", string>> = {
  day: { histone: "#ffb8cf", pcna: "#9de8d4", helicase: "#ffcf8a", polymerase: "#b3c3ff", groel: "#e9e6f2", chromosome: "#f29ac2" },
  night: { histone: "#ff3f8e", pcna: "#3dff8b", helicase: "#4dff9a", polymerase: "#ff4f9a", groel: "#5566dd", chromosome: "#ff4fa0" },
};

export function proteinMaterial(variant: Variant, key: keyof (typeof PROTEIN_TINTS)["day"], fog: string, transparent = false) {
  const tint = PROTEIN_TINTS[variant][key];
  // The chromosome is procedural (no per-chain vertex colors).
  const vertexColors = key !== "chromosome";
  return variant === "night" ? fluoroMaterial(tint, tint, fog, { transparent, vertexColor: vertexColors }) : micrographMaterial(tint, { transparent, vertexColors });
}
