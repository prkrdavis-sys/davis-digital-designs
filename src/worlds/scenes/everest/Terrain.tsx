"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useKTX2, useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { pointer } from "@/lib/store";
import { cursorBridge } from "@/components/cursor/core";
import { firstMeshGeometry, useWorldGLTF } from "@/components/three/engine/assets";
import { elevationAt, groundY, halfExtent, type EverestData } from "@/worlds/scenes/everest/data";
import { HAZE_GLSL, LOOKS, hazeUniforms } from "@/worlds/scenes/everest/look";

export const TERRAIN_TEX = {
  day: "/worlds/everest/hi/terrain-day.ktx2",
  night: "/worlds/everest/hi/terrain-night.ktx2",
  normal: "/worlds/everest/hi/terrain-normal.webp",
};
export const BASIS_PATH = "/basis/";

/** Low floor the map edges sink into, under the haze. */
const SKIRT_Y = 14;

const vertex = /* glsl */ `
  uniform vec2 uHalf;
  varying vec3 vWorld;
  varying vec2 vUv;
  varying float vEdge;
  void main() {
    vec3 p = position;
    float edge = min(uHalf.x - abs(p.x), uHalf.y - abs(p.z));
    // Map edges bow down into the haze so the crop never reads as a cliff.
    float k = smoothstep(0.0, 26.0, edge);
    p.y = mix(${SKIRT_Y.toFixed(1)}, p.y, k * k * (3.0 - 2.0 * k));
    vEdge = edge;
    vUv = vec2((p.x + uHalf.x) / (2.0 * uHalf.x), (p.z + uHalf.y) / (2.0 * uHalf.y));
    vec4 w = modelMatrix * vec4(p, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uColor;
  uniform sampler2D uNormal;
  uniform float uGain;
  uniform vec3 uTint;
  uniform float uContrast;
  uniform float uShadowDepth;
  uniform float uSaturation;
  uniform float uNight;
  uniform float uExag;
  uniform vec3 uKeyColor;
  uniform vec3 uContour;
  uniform float uContourStrength;
  uniform float uTime;
  varying vec3 vWorld;
  varying vec2 vUv;
  varying float vEdge;
  ${HAZE_GLSL}

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.07 + 13.1; a *= 0.5; } return v; }

  vec3 srgbToLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }

  void main() {
    vec3 baked = srgbToLinear(texture2D(uColor, vUv).rgb);
    // Grade: sky-lit (bluish) snow sinks into cool shadow while sunlit faces keep their warmth,
    // so the massif reads with the warm/cool split of a golden-hour photograph.
    float bl = dot(baked, vec3(0.2126, 0.7152, 0.0722));
    float cool = clamp((baked.b - baked.r) / max(baked.b, 1e-3) * 3.0, 0.0, 1.0);
    vec3 graded = baked * mix(1.0, uShadowDepth, cool * smoothstep(0.12, 0.4, bl));
    graded = mix(vec3(dot(graded, vec3(0.2126, 0.7152, 0.0722))), graded, uSaturation);
    vec3 base = 0.2 * pow(max(graded, vec3(1e-4)) / 0.2, vec3(uContrast)) * uGain * uTint;
    vec3 n = normalize(texture2D(uNormal, vUv).xyz * 2.0 - 1.0);
    vec3 toCam = cameraPosition - vWorld;
    float dist = length(toCam);
    vec3 v = toCam / dist;
    float lum = dot(baked, vec3(0.2126, 0.7152, 0.0722));

    // Micro relief the 30 m DEM cannot carry: fbm slope detail, lit by the key light, only up close.
    float near = 1.0 - smoothstep(25.0, 140.0, dist);
    if (near > 0.0) {
      vec2 q = vWorld.xz * 2.2;
      float e = 0.08;
      float h0 = fbm(q);
      vec2 grad = vec2(fbm(q + vec2(e, 0.0)) - h0, fbm(q + vec2(0.0, e)) - h0) / e;
      float rockiness = 1.0 - smoothstep(0.55, 0.85, n.y);
      vec3 nd = normalize(n + vec3(-grad.x, 0.0, -grad.y) * (0.18 + 0.35 * rockiness));
      float lit = smoothstep(0.08, 0.45, lum);
      float shade = (dot(nd, uKey) - dot(n, uKey)) * 1.4 * lit;
      base *= 1.0 + shade * near;
      // Snow grain: faint glitter where the key light grazes clean snow.
      float snow = smoothstep(0.55, 0.8, lum) * smoothstep(0.7, 0.9, n.y);
      float spark = step(0.985, hash(floor(vWorld.xz * 60.0) + floor(uTime * 3.0))) * snow * near;
      base += uKeyColor * spark * (uNight > 0.5 ? 1.2 : 0.8) * uGain;
    }

    // Sheen on snow toward the key light (the bake is diffuse only).
    vec3 r = reflect(-v, n);
    float spec = pow(max(dot(r, uKey), 0.0), 24.0);
    float snowy = smoothstep(0.35, 0.75, lum) * smoothstep(0.6, 0.9, n.y);
    base += uKeyColor * spec * snowy * (uNight > 0.5 ? 0.6 : 0.3) * uGain;

    // Survey contours: 200 m lines, every fifth one heavier. Fade with distance.
    float meters = vWorld.y * 100.0 / uExag;
    float c = meters / 200.0;
    float fw = max(fwidth(c), 1e-4);
    float line = 1.0 - smoothstep(0.0, fw * 1.3, abs(fract(c + 0.5) - 0.5));
    float cm = meters / 1000.0;
    float fwm = max(fwidth(cm), 1e-4);
    float major = 1.0 - smoothstep(0.0, fwm * 1.6, abs(fract(cm + 0.5) - 0.5));
    // Survey lines read from altitude, and get out of the way up close (they would look like roads).
    float cFade = smoothstep(55.0, 140.0, dist) * (1.0 - smoothstep(380.0, 620.0, dist)) * smoothstep(0.0, 20.0, vEdge);
    float contour = max(line * 0.4, major) * cFade * uContourStrength;
    base = mix(base, uContour * (uNight > 0.5 ? 0.5 : 1.0), contour);

    // Aerial perspective, then the map edges dissolve into the same haze.
    float fog = hazeAmount(cameraPosition, vWorld);
    vec3 air = inscatter(-v);
    vec3 col = mix(base, air, fog);
    col = mix(air, col, smoothstep(0.0, 34.0, vEdge));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const skirtFragment = /* glsl */ `
  varying vec3 vWorld;
  ${HAZE_GLSL}
  void main() {
    vec3 v = normalize(vWorld - cameraPosition);
    gl_FragColor = vec4(inscatter(v), 1.0);
  }
`;

const skirtVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();

/** Ray-march the heightfield from the camera through the pointer; returns meters or null. */
function pointerElevation(data: EverestData, camera: THREE.Camera): number | null {
  ndc.set(pointer.nx, pointer.ny);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin;
  const d = ray.ray.direction;
  let t = 0.5;
  let prev = t;
  for (let i = 0; i < 220; i++) {
    const x = o.x + d.x * t;
    const y = o.y + d.y * t;
    const z = o.z + d.z * t;
    const g = groundY(data, x, z);
    const gap = y - g;
    if (gap < 0.02) {
      // Bisect between the last point above ground and this one.
      let a = prev;
      let b = t;
      for (let k = 0; k < 8; k++) {
        const m = (a + b) / 2;
        const gy = groundY(data, o.x + d.x * m, o.z + d.z * m);
        if (o.y + d.y * m - gy > 0) a = m;
        else b = m;
      }
      return elevationAt(data, o.x + d.x * b, o.z + d.z * b);
    }
    prev = t;
    t += Math.max(0.25, gap * 0.45);
    if (t > 2500 || (d.y > 0 && y > 120)) break;
  }
  return null;
}

export function Terrain({ data, variant }: { data: EverestData; variant: Variant }) {
  const look = LOOKS[variant];
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const gltf = useWorldGLTF("everest", "terrain.glb");
  const geometry = useMemo(() => firstMeshGeometry(gltf), [gltf]);
  const color = useKTX2(variant === "night" ? TERRAIN_TEX.night : TERRAIN_TEX.day, BASIS_PATH) as THREE.Texture;
  const normal = useTexture(TERRAIN_TEX.normal) as THREE.Texture;
  const [hx, hz] = halfExtent(data.meta);

  useMemo(() => {
    // Decoded in the shader: some drivers skip the hardware sRGB decode for compressed (BC7) textures.
    color.colorSpace = THREE.NoColorSpace;
    color.anisotropy = gl.capabilities.getMaxAnisotropy();
    color.wrapS = color.wrapT = THREE.ClampToEdgeWrapping;
    color.needsUpdate = true;
    normal.flipY = false;
    normal.colorSpace = THREE.NoColorSpace;
    normal.anisotropy = 8;
    normal.wrapS = normal.wrapT = THREE.ClampToEdgeWrapping;
    normal.needsUpdate = true;
  }, [color, normal, gl]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uColor: { value: color },
        uNormal: { value: normal },
        uGain: { value: look.terrainGain },
        uTint: { value: new THREE.Color(look.terrainTint) },
        uContrast: { value: look.terrainContrast },
        uShadowDepth: { value: look.shadowDepth },
        uSaturation: { value: look.saturation },
        uHalf: { value: new THREE.Vector2(hx, hz) },
        uNight: { value: variant === "night" ? 1 : 0 },
        uExag: { value: data.meta.exag },
        uKeyColor: { value: new THREE.Color(look.keyColor) },
        uContour: { value: new THREE.Color(look.contour) },
        uContourStrength: { value: look.contourStrength },
        uTime: { value: 0 },
        ...hazeUniforms(look),
      },
    });
  }, [color, normal, variant, look, data, hx, hz]);

  const skirt = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skirtVertex,
        fragmentShader: skirtFragment,
        uniforms: hazeUniforms(look),
      }),
    [look],
  );

  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => skirt.dispose(), [skirt]);

  useFrame((_, dt) => {
    material.uniforms.uTime.value += Math.min(dt, 0.05);
    cursorBridge.elevation = pointer.active ? pointerElevation(data, camera) : null;
  });
  useEffect(
    () => () => {
      cursorBridge.elevation = null;
    },
    [],
  );

  return (
    <>
      <mesh geometry={geometry} material={material} frustumCulled={false} />
      <mesh material={skirt} rotation={[-Math.PI / 2, 0, 0]} position={[0, SKIRT_Y - 0.4, 0]} renderOrder={-1}>
        <planeGeometry args={[6000, 6000]} />
      </mesh>
    </>
  );
}
