"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { useSceneTime } from "@/components/three/engine/slot";
import { sampleTrack, type DnaData } from "@/worlds/scenes/dna/model";

/**
 * Space-filling B-DNA as ray-traced sphere impostors: one camera-facing quad
 * per atom, each fragment intersects a true sphere and writes its depth, so
 * atoms interpenetrate correctly and DOF/fog read real depth. Every atom's
 * position is computed on the GPU from its nucleotide template plus the
 * scene state (fork opening, nucleosome wrapping), mirroring dna_model.py.
 */

const vertex = /* glsl */ `
  precision highp float;
  attribute vec2 corner;
  attribute vec4 aA; // bp, strand, lx, ly
  attribute vec4 aB; // lz, radius, group, ao
  attribute float aEl; // element: 0 C, 1 N, 2 O, 3 P
  uniform sampler2D uFrames;
  uniform float uRise;
  uniform float uTwist;
  uniform float uFork;
  uniform float uForkWidth;
  uniform float uForkMaxSep;
  uniform float uBubble;
  uniform float uWrap;
  uniform float uNucStart;
  uniform float uNBp;
  uniform float uTime;
  uniform float uJitter;
  varying vec3 vCenter;
  varying vec3 vView;
  varying float vRadius;
  varying float vGroup;
  varying float vAO;
  varying float vStrand;
  varying float vBp;
  varying float vEl;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  vec3 texFrame(float i, int row) {
    return texelFetch(uFrames, ivec2(int(i), row), 0).xyz;
  }

  void main() {
    float i = aA.x;
    float strand = aA.y;
    vec3 local = vec3(aA.z, aA.w, aB.x);

    // Straight duplex frame: Ry(-i * twist), origin on the axis.
    float th = -i * uTwist;
    float c = cos(th), s = sin(th);
    vec3 ox = vec3(c, 0.0, -s);
    vec3 oy = vec3(0.0, 1.0, 0.0);
    vec3 oz = vec3(s, 0.0, c);
    vec3 origin = vec3(0.0, -i * uRise, 0.0);

    // Replication bubble: strands part below the upper fork and rejoin uBubble bp later.
    if (uFork > 0.0) {
      float a = smoothstep(0.0, 1.0, (i - uFork) / uForkWidth);
      float b = smoothstep(0.0, 1.0, (i - uFork - uBubble + uForkWidth) / uForkWidth);
      float open = a * (1.0 - b);
      float ang = i * 0.018;
      origin += vec3(cos(ang), 0.0, sin(ang)) * uForkMaxSep * open * (strand < 0.5 ? 1.0 : -1.0);
    }

    // Nucleosome wrapping: blend toward the precomputed superhelical frames.
    float span = max(1.0, uNBp - uNucStart);
    float w = clamp(uWrap * 1.6 - ((i - uNucStart) / span) * 0.6, 0.0, 1.0);
    w = w * w * (3.0 - 2.0 * w);
    if (w > 0.0) {
      vec3 wo = texFrame(i, 0);
      vec3 wy = texFrame(i, 1);
      vec3 wx = texFrame(i, 2);
      origin = mix(origin, wo, w);
      vec3 bx = normalize(mix(ox, wx, w));
      vec3 by = mix(oy, wy, w);
      by = normalize(by - bx * dot(by, bx));
      ox = bx;
      oy = by;
      oz = cross(bx, by);
    }

    vec3 center = origin + ox * local.x + oy * local.y + oz * local.z;
    // Thermal motion: atoms never sit perfectly still.
    float h = hash(float(gl_InstanceID) * 1.37);
    center += uJitter * vec3(sin(uTime * 3.1 + h * 40.0), sin(uTime * 2.7 + h * 17.0), sin(uTime * 3.7 + h * 29.0));

    vec4 mv = modelViewMatrix * vec4(center, 1.0);
    float radius = aB.y;
    // Grow the quad a little so perspective never clips the silhouette.
    vec3 view = mv.xyz + vec3(corner * radius * 1.35, 0.0);
    vCenter = mv.xyz;
    vView = view;
    vRadius = radius;
    vGroup = aB.z;
    vAO = aB.w;
    vStrand = strand;
    vBp = i;
    vEl = aEl;
    gl_Position = projectionMatrix * vec4(view, 1.0);
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  uniform mat4 projectionMatrix;
  uniform vec3 uColors[6];
  uniform vec3 uRim;
  uniform vec3 uFog;
  uniform float uFogDensity;
  uniform float uNight;
  uniform float uOpacity;
  uniform vec3 uKey;
  uniform float uTime;
  varying vec3 vCenter;
  varying vec3 vView;
  varying float vRadius;
  varying float vGroup;
  varying float vAO;
  varying float vStrand;
  varying float vBp;
  varying float vEl;

  vec3 groupColor(float g) {
    int k = int(g + 0.5);
    if (k == 0) return uColors[0];
    if (k == 1) return uColors[1];
    if (k == 2) return uColors[2];
    if (k == 3) return uColors[3];
    if (k == 4) return uColors[4];
    return uColors[5];
  }

  void main() {
    vec3 d = normalize(vView);
    float b = dot(d, vCenter);
    float disc = b * b - (dot(vCenter, vCenter) - vRadius * vRadius);
    // Analytic silhouette coverage (paired with alpha-to-coverage) instead of a hard discard.
    float fw = max(fwidth(disc), 1e-7);
    float coverage = clamp(disc / fw + 0.5, 0.0, 1.0);
    if (coverage <= 0.0) discard;
    float t = b - sqrt(max(disc, 0.0));
    vec3 p = d * t;
    vec3 n = normalize(p - vCenter);
    vec4 clip = projectionMatrix * vec4(p, 1.0);
    gl_FragDepth = clamp((clip.z / clip.w) * 0.5 + 0.5, 0.0, 1.0);

    float ao = clamp((vAO - 0.35) / 0.44, 0.0, 1.0);
    ao = 0.3 + 0.7 * pow(ao, 1.25);
    vec3 base = groupColor(vGroup);
    int el = int(vEl + 0.5);
    // Element tint within each component: oxygens warm, nitrogens cool, phosphorus amber.
    if (el == 2) base = mix(base, vec3(1.0, 0.42, 0.38), 0.18);
    else if (el == 1) base = mix(base, vec3(0.35, 0.5, 1.0), 0.16);
    else if (el == 3) base = mix(base, vec3(1.0, 0.62, 0.2), 0.35);
    float facing = clamp(-dot(n, d), 0.0, 1.0);
    float rim = pow(1.0 - facing, 3.0);
    vec3 col;
    if (uNight < 0.5) {
      // Colorized electron micrograph: wrapped key light, cool edge glow, soft gloss.
      vec3 l = normalize(uKey);
      float diff = pow(clamp(dot(n, l) * 0.55 + 0.45, 0.0, 1.0), 1.4);
      vec3 h = normalize(l - d);
      float spec = pow(max(dot(n, h), 0.0), 48.0) * 0.28;
      float sky = n.y * 0.5 + 0.5;
      col = base * (0.12 + 1.05 * diff) * ao;
      col += base * mix(vec3(0.3, 0.26, 0.36), vec3(0.55, 0.6, 0.72), sky) * 0.22 * ao;
      // Subsurface-ish translucency where light grazes the edge.
      col += base * pow(clamp(dot(-n, l) * 0.5 + 0.5, 0.0, 1.0), 3.0) * rim * 0.6;
      col += uRim * rim * 0.55 * ao;
      col += spec * (0.6 + 0.4 * ao);
    } else {
      // Fluorescence: dye glows from the body, brightest where it thins at the edge.
      float pulse = 0.9 + 0.1 * sin(uTime * 1.3 + vBp * 0.11);
      col = base * (0.35 + 0.65 * facing) * ao * 1.6 * pulse;
      col += uRim * rim * 2.2 * ao;
    }
    float fog = 1.0 - exp(-max(0.0, -p.z) * uFogDensity);
    col = mix(col, uFog, clamp(fog, 0.0, 1.0));
    gl_FragColor = vec4(col, coverage * uOpacity);
  }
`;

const PALETTES: Record<Variant, { colors: string[]; rim: string; fog: string; key: [number, number, number] }> = {
  day: {
    // phosphate, sugar, A, T, G, C
    colors: ["#e8563f", "#f5b98a", "#2fbf8f", "#7f5ce6", "#3f86f2", "#f5b43a"],
    rim: "#e6eeff",
    fog: "#e6dfe9",
    key: [0.6, 0.7, 0.45],
  },
  night: {
    colors: ["#3f7dff", "#2b52e6", "#1d44c9", "#1c3bb8", "#2350d8", "#2046c4"],
    rim: "#7fd6ff",
    fog: "#010207",
    key: [0.6, 0.7, 0.45],
  },
};

export function Helix({ data, variant }: { data: DnaData; variant: Variant }) {
  const time = useSceneTime();
  const { meta, atoms, frames } = data;

  const geometry = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("corner", new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const n = meta.atoms;
    const a = new Float32Array(n * 4);
    const bArr = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) {
      const r = k * meta.stride;
      a[k * 4] = atoms[r];
      a[k * 4 + 1] = atoms[r + 1];
      a[k * 4 + 2] = atoms[r + 2];
      a[k * 4 + 3] = atoms[r + 3];
      bArr[k * 4] = atoms[r + 4];
      bArr[k * 4 + 1] = atoms[r + 5];
      bArr[k * 4 + 2] = atoms[r + 6];
      bArr[k * 4 + 3] = atoms[r + 8];
    }
    const el = new Float32Array(n);
    for (let k = 0; k < n; k++) el[k] = atoms[k * meta.stride + 7];
    g.setAttribute("aA", new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute("aB", new THREE.InstancedBufferAttribute(bArr, 4));
    g.setAttribute("aEl", new THREE.InstancedBufferAttribute(el, 1));
    g.instanceCount = n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -meta.nBp * meta.rise * 0.5, 0), 1e5);
    return g;
  }, [meta, atoms]);

  const framesTex = useMemo(() => {
    const n = meta.nBp;
    const data = new Float32Array(n * 3 * 4);
    for (let i = 0; i < n; i++) {
      for (let row = 0; row < 3; row++) {
        const dst = (row * n + i) * 4;
        const src = i * 9 + row * 3;
        data[dst] = frames[src];
        data[dst + 1] = frames[src + 1];
        data[dst + 2] = frames[src + 2];
        data[dst + 3] = 1;
      }
    }
    const tex = new THREE.DataTexture(data, n, 3, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    return tex;
  }, [meta, frames]);

  const material = useMemo(() => {
    const pal = PALETTES[variant];
    return new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uFrames: { value: framesTex },
        uRise: { value: meta.rise },
        uTwist: { value: meta.twist },
        uFork: { value: 0 },
        uForkWidth: { value: meta.fork.width },
        uForkMaxSep: { value: meta.fork.maxSep },
        uBubble: { value: meta.fork.bubble },
        uWrap: { value: 0 },
        uNucStart: { value: meta.nucStart },
        uNBp: { value: meta.nBp },
        uTime: { value: 0 },
        uJitter: { value: 0.006 },
        uColors: { value: pal.colors.map((c) => new THREE.Color(c)) },
        uRim: { value: new THREE.Color(pal.rim) },
        uFog: { value: new THREE.Color(pal.fog) },
        uFogDensity: { value: 0.05 },
        uNight: { value: variant === "night" ? 1 : 0 },
        uOpacity: { value: 1 },
        uKey: { value: new THREE.Vector3(...pal.key) },
      },
      transparent: false,
      alphaToCoverage: true,
    });
  }, [variant, framesTex, meta]);

  useFrame((state, dt) => {
    const u = material.uniforms;
    const s = time.s;
    u.uTime.value += Math.min(dt, 0.05);
    u.uFork.value = sampleTrack(meta, "fork", s);
    u.uWrap.value = sampleTrack(meta, "wrap", s);
    // Fog tracks scale: thick at molecular zoom, thin as we pull back.
    const cam = state.camera as THREE.PerspectiveCamera;
    const dist = Math.hypot(cam.position.x, cam.position.z);
    u.uFogDensity.value = 0.16 / Math.max(3, dist * 2.2);
  });

  const visible = sampleTrack(meta, "helix", time.s) > 0.01;
  return <mesh geometry={geometry} material={material} frustumCulled={false} visible={visible} />;
}

export { PALETTES as HELIX_PALETTES };
