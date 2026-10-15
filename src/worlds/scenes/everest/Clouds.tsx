"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { halfExtent, heightTexture, type EverestData } from "@/worlds/scenes/everest/data";
import { HAZE_GLSL, LOOKS, hazeUniforms } from "@/worlds/scenes/everest/look";

/** Must match Terrain.tsx: the map edges bow down to this floor. */
const SKIRT_Y = 14;

const vertex = /* glsl */ `
  uniform vec2 uHalf;
  uniform float uBase;
  uniform float uRim;
  varying vec3 vWorld;
  varying float vEdge;
  void main() {
    vec3 p = position;
    float edge = min(uHalf.x - abs(p.x), uHalf.y - abs(p.z));
    // The deck climbs toward the map edges, so the crop sinks into a sea of cloud.
    float k = 1.0 - smoothstep(-30.0, 36.0, edge);
    p.y = mix(uBase, uRim, k * k * (3.0 - 2.0 * k));
    vEdge = edge;
    vec4 w = modelMatrix * vec4(p, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uHeight;
  uniform vec2 uHalf;
  uniform float uTime;
  uniform vec3 uCloud;
  uniform vec3 uShade;
  uniform vec3 uKeyColor;
  uniform float uOpacity;
  uniform float uCoverIn;
  uniform float uCoverOut;
  uniform float uScale;
  uniform float uClear;
  varying vec3 vWorld;
  varying float vEdge;
  ${HAZE_GLSL}

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  const mat2 ROT = mat2(1.6, 1.2, -1.2, 1.6);
  float fbm3(vec2 p) {
    float v = 0.5 * vnoise(p); p = ROT * p + 7.3;
    v += 0.25 * vnoise(p); p = ROT * p + 7.3;
    return (v + 0.125 * vnoise(p)) / 0.875;
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = ROT * p + 7.3; a *= 0.5; }
    return v / 0.96875;
  }

  void main() {
    vec2 uv = (vWorld.xz + uHalf) / (2.0 * uHalf);
    vec2 hr = texture2D(uHeight, clamp(uv, 0.0, 1.0)).rg;
    float inside = smoothstep(0.0, 26.0, vEdge);
    float ground = mix(${SKIRT_Y.toFixed(1)}, hr.r * 128.0, inside * inside * (3.0 - 2.0 * inside));
    float depth = vWorld.y - ground;
    if (depth < 0.0) discard;

    float cover = mix(uCoverOut, uCoverIn, smoothstep(-10.0, 34.0, vEdge));
    vec2 q = vWorld.xz * uScale + vec2(uTime * 0.006, uTime * 0.0025);
    // Domain warp gives billows instead of blobs.
    vec2 wq = q + (vec2(fbm3(q * 0.7 + 3.1), fbm3(q * 0.7 + 9.7)) - 0.5) * 1.6;
    float d = smoothstep(cover, cover + 0.2, fbm(wq));
    // Thin out where the ground rises into the deck, and part around the trail.
    d *= smoothstep(0.0, 6.0, depth);
    d *= mix(1.0, smoothstep(0.08, 0.2, hr.g), uClear * inside);
    float dc = length(vWorld - cameraPosition);
    d *= smoothstep(8.0, 40.0, dc) * (1.0 - smoothstep(1100.0, 1600.0, length(vWorld.xz)));
    if (d < 0.004) discard;

    // Relief shading from the low-octave gradient: sunlit billow tops, cool undersides.
    float e = 0.08;
    float n0 = fbm3(wq);
    vec2 g = vec2(fbm3(wq + vec2(e, 0.0)) - n0, fbm3(wq + vec2(0.0, e)) - n0) / e;
    vec3 n = normalize(vec3(-g.x * 1.1, 1.0, -g.y * 1.1));
    float lambert = clamp(dot(n, uKey), 0.0, 1.0);
    float lit = smoothstep(0.05, 0.75, lambert * 0.9 + d * 0.25);
    vec3 col = mix(uShade, uCloud, lit);
    col = mix(col, col * uKeyColor * 1.25, pow(lambert, 2.0) * 0.6);
    vec3 v = normalize(vWorld - cameraPosition);
    // Silver lining on thin edges when looking toward the key light.
    col += uKeyColor * pow(max(dot(v, uKey), 0.0), 6.0) * (1.0 - d) * 0.8;
    col = mix(col, inscatter(v), hazeAmount(cameraPosition, vWorld));
    gl_FragColor = vec4(col, d * uOpacity);
  }
`;

interface DeckProps {
  data: EverestData;
  variant: Variant;
  /** Deck altitude inside the map and beyond its edges, scene units. */
  base: number;
  rim: number;
  /** fbm thresholds: higher = sparser (inside the map / beyond the edge). */
  coverIn: number;
  coverOut: number;
  scale?: number;
  opacity?: number;
  /** 0..1 how much the deck parts around the trail. */
  clear?: number;
}

function Deck({ data, variant, base, rim, coverIn, coverOut, scale = 0.02, opacity = 1, clear = 1 }: DeckProps) {
  const look = LOOKS[variant];
  const [hx, hz] = halfExtent(data.meta);
  const geometry = useMemo(() => new THREE.PlaneGeometry(3400, 3400, 220, 220).rotateX(-Math.PI / 2), []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uHeight: { value: heightTexture(data) },
          uHalf: { value: new THREE.Vector2(hx, hz) },
          uBase: { value: base },
          uRim: { value: rim },
          uTime: { value: 0 },
          uCloud: { value: new THREE.Color(look.cloud) },
          uShade: { value: new THREE.Color(look.cloudShade) },
          uKeyColor: { value: new THREE.Color(look.keyColor) },
          uOpacity: { value: look.cloudOpacity * opacity },
          uCoverIn: { value: coverIn },
          uCoverOut: { value: coverOut },
          uScale: { value: scale },
          uClear: { value: clear },
          ...hazeUniforms(look),
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [data, look, hx, hz, base, rim, coverIn, coverOut, scale, opacity, clear],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, dt) => {
    material.uniforms.uTime.value += Math.min(dt, 0.05);
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={8} />;
}

/**
 * A sea of cloud around the massif that swallows the map edges, thinning to
 * scattered fog banks in the low southern gorges that part around the trail.
 */
export function Clouds({ data, variant }: { data: EverestData; variant: Variant }) {
  return <Deck data={data} variant={variant} base={25} rim={60} coverIn={0.58} coverOut={0.36} />;
}
