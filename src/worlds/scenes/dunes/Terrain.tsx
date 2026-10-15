"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { node, useWorldGLTF } from "@/components/three/engine/assets";
import { ATMOSPHERE_GLSL, type AtmosphereUniforms } from "@/worlds/scenes/dunes/atmosphere";
import { BASE, type DunesData } from "@/worlds/scenes/dunes/data";
import { PALETTES } from "@/worlds/scenes/dunes/palette";
import type { PanelLight } from "@/worlds/scenes/dunes/Monoliths";

export const TERRAIN_TEXTURES = (variant: Variant) => [`${BASE}/hi/light-${variant}.webp`, `${BASE}/hi/terrain-data.webp`, `${BASE}/hi/sand-albedo.webp`, `${BASE}/hi/sand-normal.webp`];

const MAX_PANELS = 10;

const vertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormalW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    // Node transforms are rotation + uniform (quantization) scale.
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  ${ATMOSPHERE_GLSL}
  uniform sampler2D tLight;
  uniform sampler2D tData;
  uniform sampler2D tGrain;
  uniform sampler2D tGrainN;
  uniform float uLightScale;
  uniform vec3 uCore;
  uniform vec3 uSandA;
  uniform vec3 uSandB;
  uniform float uSunIntensity;
  uniform float uNight;
  uniform float uSpill;
  uniform vec3 uPanelPos[${MAX_PANELS}];
  uniform vec3 uPanelN[${MAX_PANELS}];
  uniform vec3 uPanelCol[${MAX_PANELS}];
  varying vec3 vWorld;
  varying vec3 vNormalW;

  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
  }

  // Lighting for the horizon skirt (and the core's outer rim): sun + sky, no cast shadows.
  vec3 analyticIrradiance(vec3 n) {
    vec3 sky = dunesSky(vec3(0.0, 1.0, 0.0)) * 0.55 + dunesHaze(normalize(vec3(uSunDir.x, 0.0, uSunDir.z))) * 0.25;
    return uSunColor * uSunIntensity * max(dot(n, uSunDir), 0.0) * 0.3183 + sky * (0.55 + 0.45 * n.y);
  }

  void main() {
    vec3 p = vWorld;
    vec3 L = uSunDir;
    vec3 V = normalize(cameraPosition - p);
    vec2 uv = vec2((p.x - uCore.x) / uCore.z, (-p.z - uCore.y) / uCore.z);
    float rim = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float core = smoothstep(0.0, 0.025, rim);

    vec3 Nm = normalize(vNormalW);
    float vis = 1.0;
    vec3 irr = analyticIrradiance(Nm);
    #ifndef FAR
      vec4 dat = texture2D(tData, uv);
      vec2 nb = dat.rg * 2.0 - 1.0;
      vec3 nTex = normalize(vec3(nb.x, sqrt(max(0.0, 1.0 - dot(nb, nb))), -nb.y));
      Nm = normalize(mix(Nm, nTex, core));
      vis = mix(1.0, dat.b, core);
      vec3 baked = pow(texture2D(tLight, uv).rgb, vec3(2.2)) * uLightScale;
      irr = mix(irr, baked, core);
    #endif

    // Surface frame: T follows the wind (+x) across the slope.
    vec3 T = normalize(vec3(1.0, 0.0, 0.0) - Nm * Nm.x);
    vec3 B = cross(Nm, T);
    float stoss = smoothstep(0.84, 0.93, Nm.y);
    vec2 q = p.xz;
    float dist = length(cameraPosition - p);

    // Wind ripples: asymmetric, warped, filtered by their own screen frequency.
    float warp = vnoise(q * 0.045) * 7.0 + vnoise(q * 0.19 + 3.0) * 1.6;
    float ph1 = (p.x + warp) / 0.45 + vnoise(q * 0.7) * 0.5;
    float ph2 = (p.x * 0.85 + p.z * 0.3 + warp * 1.4) / 1.6;
    float w1 = 1.0 - smoothstep(0.06, 0.24, fwidth(ph1));
    float w2 = 1.0 - smoothstep(0.06, 0.24, fwidth(ph2));
    float s1 = cos(6.2832 * ph1 + 0.7 * sin(6.2832 * ph1));
    float s2 = cos(6.2832 * ph2 + 0.5 * sin(6.2832 * ph2));
    float grad = (s1 * 0.06 * w1 + s2 * 0.04 * w2) * stoss;
    // Slip faces: avalanche grooves running down the fall line.
    float across = dot(q, normalize(B.xz + 1e-4));
    float grooves = (vnoise(vec2(across * 0.7, dot(q, T.xz) * 0.04)) - 0.5) * (1.0 - stoss) * 0.14 * (1.0 - smoothstep(0.15, 0.6, fwidth(across * 0.7)));
    vec3 Nd = normalize(Nm - T * grad + B * grooves);
    float near = 1.0 - smoothstep(6.0, 40.0, dist);
    vec3 gn = texture2D(tGrainN, q / 1.4).xyz * 2.0 - 1.0;
    Nd = normalize(Nd + (T * gn.x + B * gn.y) * 0.3 * near);

    // Sand color: broad mottling, redder in the slip faces, grain up close.
    float n1 = vnoise(q * 0.0035) * 0.55 + vnoise(q * 0.018) * 0.3 + vnoise(q * 0.09) * 0.15;
    vec3 albedo = mix(uSandB, uSandA, smoothstep(0.25, 0.75, n1));
    albedo *= mix(vec3(0.9, 0.84, 0.8), vec3(1.03, 1.02, 1.0), stoss);
    float g = texture2D(tGrain, q / 1.4).r;
    albedo *= mix(1.0, 0.82 + g * 0.36, near);
    albedo *= 1.0 - 0.07 * max(0.0, -s1) * w1 * stoss;

    // Ripple relief changes only the direct sun term (the bake stores E / pi); skylight is untouched.
    float ndlM = max(dot(Nm, L), 0.0);
    float ndlD = max(dot(Nd, L), 0.0);
    vec3 direct = uSunColor * uSunIntensity * 0.3183 * vis;
    vec3 col = albedo * max(irr + direct * (ndlD - ndlM), irr * 0.4);

    // Glints: a few grains catch the sun like mica.
    vec2 gc = q * 26.0;
    vec2 cell = floor(gc);
    float rnd = hash12(cell);
    vec3 jit = vec3(hash12(cell + 1.3) - 0.5, 0.0, hash12(cell + 7.1) - 0.5) * 1.4;
    vec3 H = normalize(L + V);
    float spark = pow(max(dot(normalize(Nd + jit), H), 0.0), 700.0) * step(0.955, rnd);
    float gfade = 1.0 - smoothstep(0.2, 0.7, fwidth(gc.x) + fwidth(gc.y));
    col += uSunColor * uSunIntensity * spark * vis * gfade * mix(22.0, 6.0, uNight);
    // Forward scattering: sand glows at grazing angles toward the sun.
    float fwd = pow(max(dot(-V, L), 0.0), 5.0) * pow(1.0 - max(dot(Nd, V), 0.0), 3.0);
    col += uSunColor * uSunIntensity * albedo * fwd * vis * 0.05;

    // Warm light pooling in front of the glowing panels.
    if (uSpill > 0.0) {
      for (int i = 0; i < ${MAX_PANELS}; i++) {
        vec3 dv = uPanelPos[i] - p;
        float dd = dot(dv, dv);
        vec3 dl = dv * inversesqrt(dd);
        col += albedo * uPanelCol[i] * max(dot(Nd, dl), 0.0) * max(dot(uPanelN[i], -dl), 0.0) * uSpill * 40.0 / (dd + 25.0);
      }
    }
    gl_FragColor = vec4(dunesFog(col, p), 1.0);
  }
`;

/** Light-baked sand: Cycles irradiance + sun visibility, live ripples, glints and haze. */
export function Terrain({ data, variant, atmosphere, panels }: { data: DunesData; variant: Variant; atmosphere: AtmosphereUniforms; panels: PanelLight[] }) {
  const gltf = useWorldGLTF("dunes", "terrain.glb");
  const [light, dat, grain, grainN] = useTexture(TERRAIN_TEXTURES(variant)) as THREE.Texture[];
  const pal = PALETTES[variant];

  useEffect(() => {
    for (const t of [light, dat]) {
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = 8;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
    }
    for (const t of [grain, grainN]) {
      t.colorSpace = THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      t.needsUpdate = true;
    }
  }, [light, dat, grain, grainN]);

  const uniforms = useMemo(() => {
    const pos = Array.from({ length: MAX_PANELS }, (_, i) => panels[i]?.pos.clone() ?? new THREE.Vector3(0, -1e4, 0));
    const nrm = Array.from({ length: MAX_PANELS }, (_, i) => panels[i]?.normal.clone() ?? new THREE.Vector3(0, 1, 0));
    const col = Array.from({ length: MAX_PANELS }, (_, i) => panels[i]?.color.clone() ?? new THREE.Color(0, 0, 0));
    const { core } = data.meta;
    return {
      ...atmosphere,
      tLight: { value: light },
      tData: { value: dat },
      tGrain: { value: grain },
      tGrainN: { value: grainN },
      uLightScale: { value: data.meta.light[variant].scale },
      uCore: { value: new THREE.Vector3(core.x0, core.y0, core.size) },
      uSandA: { value: new THREE.Color(pal.sandA) },
      uSandB: { value: new THREE.Color(pal.sandB) },
      uSunIntensity: { value: pal.sunIntensity },
      uNight: { value: variant === "night" ? 1 : 0 },
      uSpill: { value: pal.spill },
      uPanelPos: { value: pos },
      uPanelN: { value: nrm },
      uPanelCol: { value: col },
    };
  }, [atmosphere, light, dat, grain, grainN, data, variant, pal, panels]);

  const materials = useMemo(() => {
    const make = (far: boolean) => new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms, defines: far ? { FAR: 1 } : {} });
    return { core: make(false), far: make(true) };
  }, [uniforms]);

  const scene = useMemo(() => {
    const coreMesh = node<THREE.Mesh>(gltf, "terrain");
    const farMesh = node<THREE.Mesh>(gltf, "far");
    coreMesh.material = materials.core;
    farMesh.material = materials.far;
    coreMesh.frustumCulled = false;
    farMesh.frustumCulled = false;
    return gltf.scene;
  }, [gltf, materials]);

  useFrame(() => {
    uniforms.uSunIntensity.value = pal.sunIntensity;
  });

  return <primitive object={scene} />;
}
