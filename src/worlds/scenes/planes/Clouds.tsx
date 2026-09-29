"use client";

import { use, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { lightDir, lin, sky, skyGLSL, WORLD } from "@/worlds/scenes/planes/shaders";
import { mulberry32 } from "@/worlds/scenes/planes/sim";

export interface CloudCell {
  kind: "puff" | "tower";
  /** x, y (from the top), w, h in atlas UV. */
  uv: [number, number, number, number];
  /** World size of the rendered frame. */
  size: [number, number];
}
interface CloudMeta {
  vmax: number;
  cells: CloudCell[];
}
export interface CloudAtlas {
  texture: THREE.Texture;
  meta: CloudMeta;
}

const BASE = "/worlds/planes/hi";
let atlasPromise: Promise<CloudAtlas> | null = null;

/**
 * The relightable impostor atlas (art/worlds/planes/pl_atlas.py). Decoded as
 * an ImageBitmap with no premultiplication or color conversion: the channels
 * are light passes, not colors.
 */
export function loadCloudAtlas(): Promise<CloudAtlas> {
  if (!atlasPromise) {
    const meta = fetch(`${BASE}/clouds.json`).then((r) => r.json() as Promise<CloudMeta>);
    const bitmap = new Promise<ImageBitmap>((resolve, reject) => {
      const loader = new THREE.ImageBitmapLoader();
      loader.setOptions({ imageOrientation: "from-image", premultiplyAlpha: "none", colorSpaceConversion: "none" });
      loader.load(`${BASE}/clouds.webp`, resolve, undefined, reject);
    });
    atlasPromise = Promise.all([meta, bitmap]).then(([m, bmp]) => {
      const texture = new THREE.Texture(bmp);
      texture.flipY = false;
      texture.colorSpace = THREE.NoColorSpace;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      return { texture, meta: m };
    });
  }
  return atlasPromise;
}

const vertex = /* glsl */ `
  attribute vec3 iPos;
  attribute vec2 iSize;
  attribute vec4 iCell;
  attribute vec4 iParams;
  uniform vec3 uCam;
  uniform vec3 uSun;
  varying vec2 vUv;
  varying vec2 vAtlas;
  varying float vFade;
  varying float vSide;
  varying float vBack;
  varying float vTone;
  varying vec3 vWorld;
  void main() {
    vec3 toCam = uCam - iPos;
    vec3 n = normalize(vec3(toCam.x, toCam.y * 0.8, toCam.z));
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), n));
    vec3 up = cross(n, right);
    vec3 p = iPos + right * (uv.x - 0.5) * iSize.x + up * uv.y * iSize.y;
    vUv = uv;
    vAtlas = vec2(iCell.x + uv.x * iCell.z, iCell.y + (1.0 - uv.y) * iCell.w);
    vec2 sl = vec2(dot(uSun, right), dot(uSun, up));
    vSide = clamp(0.5 + 0.5 * sl.x / max(length(sl), 0.25), 0.0, 1.0);
    vBack = dot(uSun, -n);
    vFade = iParams.x;
    vTone = iParams.y;
    vWorld = p;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

function fragment(variant: Variant) {
  return /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uVmax;
  uniform vec3 uKey;
  uniform vec3 uAmb;
  uniform vec3 uLow;
  uniform vec3 uCam;
  uniform float uFog;
  uniform float uSilver;
  varying vec2 vUv;
  varying vec2 vAtlas;
  varying float vFade;
  varying float vSide;
  varying float vBack;
  varying float vTone;
  varying vec3 vWorld;
  ${skyGLSL(variant)}
  void main() {
    vec4 t = texture2D(uAtlas, vAtlas);
    float a = t.a * vFade;
    if (a < 0.004) discard;
    vec3 v = t.rgb * t.rgb * uVmax;
    float key = mix(v.r, v.g, vSide);
    float back = max(vBack, 0.0);
    // Thin, sun-facing edges go silver when we look toward the light.
    float silver = pow(key, 1.6) * back * uSilver;
    vec3 col = uKey * (key * (0.75 + 0.5 * back) + silver) + uAmb * v.b;
    col *= mix(uLow, vec3(1.0), smoothstep(0.0, 0.6, vUv.y) * (0.6 + 0.4 * vTone));
    vec3 d = vWorld - uCam;
    float dist = length(d);
    vec3 dir = d / dist;
    float fog = 1.0 - exp(-dist * uFog);
    vec3 fc = skyColor(normalize(vec3(dir.x, max(dir.y, 0.0) * 0.4 + 0.015, dir.z)));
    col = mix(col, fc, clamp(fog, 0.0, 0.94));
    gl_FragColor = vec4(col, a);
  }
`;
}

interface Pop {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  w: Float32Array;
  h: Float32Array;
  cell: Uint8Array;
  tone: Float32Array;
  /** Tile size the sprite wraps in around the camera. */
  tile: Float32Array;
  /** 0 = near sea, 1 = far sea, 2 = tower. */
  band: Uint8Array;
}

function population(cells: CloudCell[]): Pop {
  const puffs = cells.map((c, i) => (c.kind === "puff" ? i : -1)).filter((i) => i >= 0);
  const towers = cells.map((c, i) => (c.kind === "tower" ? i : -1)).filter((i) => i >= 0);
  const rnd = mulberry32(77);
  const items: { x: number; y: number; z: number; w: number; h: number; cell: number; tone: number; tile: number; band: number }[] = [];
  const top = WORLD.clouds.seaTop;
  const bump = (x: number, z: number) => Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.009 - 0.4) * 0.5 + Math.sin(x * 0.023 - z * 0.017) * 0.35;
  // Near sea: dense cumulus tops in a 1000 m tile, with a few open patches.
  const NEAR = 1000;
  while (items.length < 760) {
    const x = (rnd() - 0.5) * NEAR;
    const z = (rnd() - 0.5) * NEAR;
    const b = bump(x, z);
    if (b < -0.55 && rnd() < 0.7) continue;
    const cell = puffs[Math.floor(rnd() * puffs.length)];
    const w = 42 + rnd() * 46;
    const [cw, ch] = cells[cell].size;
    const h = (w * ch) / cw;
    items.push({ x, y: top + b * 6 - h * (0.62 + rnd() * 0.12), z, w, h, cell, tone: rnd(), tile: NEAR, band: 0 });
  }
  // Far sea: big billows out to the horizon.
  const FAR = 6400;
  for (let k = 0; k < 420; k++) {
    const x = (rnd() - 0.5) * FAR;
    const z = (rnd() - 0.5) * FAR;
    const cell = puffs[Math.floor(rnd() * puffs.length)];
    const w = 170 + rnd() * 260;
    const [cw, ch] = cells[cell].size;
    const h = (w * ch) / cw;
    items.push({ x, y: top - 6 - h * (0.58 + rnd() * 0.1), z, w, h, cell, tone: rnd(), tile: FAR, band: 1 });
  }
  // Towering cumulus: the hand-placed ones plus smaller filler towers.
  const TOW = 2600;
  for (const [x, z, height, c] of WORLD.clouds.towers) {
    const cell = towers[c % towers.length];
    const [cw, ch] = cells[cell].size;
    const h = height * 1.25;
    items.push({ x, y: top - 18, z, w: (h * cw) / ch, h, cell, tone: rnd(), tile: TOW, band: 2 });
  }
  for (let k = 0; k < 18; k++) {
    const x = (rnd() - 0.5) * TOW;
    const z = (rnd() - 0.5) * TOW;
    if (Math.hypot(x, z) < 220) continue;
    const cell = towers[Math.floor(rnd() * towers.length)];
    const [cw, ch] = cells[cell].size;
    const h = 55 + rnd() * 80;
    items.push({ x, y: top - 12, z, w: (h * cw) / ch, h, cell, tone: rnd(), tile: TOW, band: 2 });
  }
  const n = items.length;
  const pop: Pop = {
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    w: new Float32Array(n),
    h: new Float32Array(n),
    cell: new Uint8Array(n),
    tone: new Float32Array(n),
    tile: new Float32Array(n),
    band: new Uint8Array(n),
  };
  items.forEach((it, i) => {
    pop.x[i] = it.x;
    pop.y[i] = it.y;
    pop.z[i] = it.z;
    pop.w[i] = it.w;
    pop.h[i] = it.h;
    pop.cell[i] = it.cell;
    pop.tone[i] = it.tone;
    pop.tile[i] = it.tile;
    pop.band[i] = it.band;
  });
  return pop;
}

const PALETTE: Record<Variant, { key: THREE.Color; amb: THREE.Color; low: THREE.Color; fog: number; silver: number }> = {
  day: { key: lin(sky("day").light.color, 2.1), amb: lin("#cdb9f0", 1.0), low: lin("#b7a2d6"), fog: 0.00115, silver: 1.4 },
  night: { key: lin(sky("night").light.color, 0.75), amb: lin("#3a4180", 0.55), low: lin("#5a5c9a"), fog: 0.0012, silver: 1.0 },
};

const wrap = (v: number, t: number) => v - t * Math.round(v / t);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The cloud sea: ~1200 Cycles-rendered cumulus impostors, relit per frame for
 * the sun or moon, sorted back to front, fogged into the sky, and streaming
 * past on a treadmill (the flock "flies" while it holds formation).
 */
export function Clouds({ variant, flow }: { variant: Variant; flow: { offset: number } }) {
  const { texture, meta } = use(loadCloudAtlas());
  const pop = useMemo(() => population(meta.cells), [meta]);
  const count = pop.x.length;
  const pal = PALETTE[variant];

  const { geometry, attrs, order, keys } = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0.5, 0.5, 0);
    g.index = quad.index;
    g.setAttribute("position", quad.getAttribute("position"));
    g.setAttribute("uv", quad.getAttribute("uv"));
    const mk = (size: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(count * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    const attrs = { pos: mk(3), size: mk(2), cell: mk(4), params: mk(4) };
    g.setAttribute("iPos", attrs.pos);
    g.setAttribute("iSize", attrs.size);
    g.setAttribute("iCell", attrs.cell);
    g.setAttribute("iParams", attrs.params);
    g.instanceCount = 0;
    return { geometry: g, attrs, order: new Uint16Array(count), keys: new Float32Array(count) };
  }, [count]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment(variant),
        uniforms: {
          uAtlas: { value: texture },
          uVmax: { value: meta.vmax },
          uKey: { value: pal.key },
          uAmb: { value: pal.amb },
          uLow: { value: pal.low },
          uCam: { value: new THREE.Vector3() },
          uSun: { value: lightDir(variant) },
          uFog: { value: pal.fog },
          uSilver: { value: pal.silver },
        },
        transparent: true,
        depthWrite: false,
      }),
    [variant, texture, meta, pal],
  );

  const wx = useMemo(() => new Float32Array(count * 3), [count]);
  const fades = useMemo(() => new Float32Array(count), [count]);
  const fwd = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    const cam = state.camera;
    const cp = cam.position;
    material.uniforms.uCam.value.copy(cp);
    cam.getWorldDirection(fwd);
    const off = flow.offset;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const T = pop.tile[i];
      const x = cp.x + wrap(pop.x[i] - cp.x, T);
      const z = cp.z + wrap(pop.z[i] + off - cp.z, T);
      const y = pop.y[i];
      const dx = x - cp.x;
      const dz = z - cp.z;
      const cheb = Math.max(Math.abs(dx), Math.abs(dz));
      let fade = 1 - smooth(T * 0.36, T * 0.49, cheb);
      if (pop.band[i] === 1) fade *= smooth(330, 520, Math.hypot(dx, dz));
      const cy = y + pop.h[i] * 0.5 - cp.y;
      const d2 = dx * dx + cy * cy + dz * dz;
      const d = Math.sqrt(d2);
      fade *= smooth(pop.w[i] * 0.18, pop.w[i] * 0.55, d);
      // Behind the camera by more than the sprite's size: skip.
      if (fade < 0.002 || dx * fwd.x + cy * fwd.y + dz * fwd.z < -pop.w[i]) continue;
      wx[i * 3] = x;
      wx[i * 3 + 1] = y;
      wx[i * 3 + 2] = z;
      fades[i] = fade;
      keys[i] = -d2;
      order[n++] = i;
    }
    // Back to front.
    const idx = Array.from(order.subarray(0, n));
    idx.sort((a, b) => keys[a] - keys[b]);
    const P = attrs.pos.array as Float32Array;
    const S = attrs.size.array as Float32Array;
    const C = attrs.cell.array as Float32Array;
    const Q = attrs.params.array as Float32Array;
    for (let k = 0; k < n; k++) {
      const i = idx[k];
      P[k * 3] = wx[i * 3];
      P[k * 3 + 1] = wx[i * 3 + 1];
      P[k * 3 + 2] = wx[i * 3 + 2];
      S[k * 2] = pop.w[i];
      S[k * 2 + 1] = pop.h[i];
      const uv = meta.cells[pop.cell[i]].uv;
      C[k * 4] = uv[0];
      C[k * 4 + 1] = uv[1];
      C[k * 4 + 2] = uv[2];
      C[k * 4 + 3] = uv[3];
      Q[k * 4] = fades[i];
      Q[k * 4 + 1] = pop.tone[i];
    }
    for (const a of Object.values(attrs)) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
    geometry.instanceCount = n;
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={1} />;
}
