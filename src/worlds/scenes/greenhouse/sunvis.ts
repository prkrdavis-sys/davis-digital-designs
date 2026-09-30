import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { HI, type GreenhouseMeta, type SunVisMeta } from "@/worlds/scenes/greenhouse/data";

/**
 * Sun (moon) visibility on a 25 cm grid, ray-cast in Blender (build step
 * `sunvis`) and shipped as z-slices tiled into one grayscale PNG. It shadows
 * the live foliage and gives the haze its light shafts.
 */
const cache = new Map<string, Promise<THREE.Data3DTexture>>();

async function decode(url: string, vis: SunVisMeta): Promise<THREE.Data3DTexture> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`greenhouse sunvis: ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("greenhouse sunvis: no 2D context");
  g.drawImage(bitmap, 0, 0);
  bitmap.close();
  const px = g.getImageData(0, 0, canvas.width, canvas.height).data;
  const [nx, ny, nz] = vis.dims;
  const data = new Uint8Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    const r = Math.floor(k / vis.cols);
    const c = k % vis.cols;
    for (let y = 0; y < ny; y++) {
      const row = ((r * ny + y) * canvas.width + c * nx) * 4;
      const dst = k * nx * ny + y * nx;
      for (let x = 0; x < nx; x++) data[dst + x] = px[row + x * 4];
    }
  }
  const tex = new THREE.Data3DTexture(data, nx, ny, nz);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** A single fully lit voxel: the scene still renders (unshadowed) if the grid is missing. */
const FALLBACK: SunVisMeta = { min: [-1e4, -1e4, -1e4], cell: 2e4, dims: [1, 1, 1], cols: 1 };

function litTexture() {
  const tex = new THREE.Data3DTexture(new Uint8Array([255]), 1, 1, 1);
  tex.format = THREE.RedFormat;
  tex.needsUpdate = true;
  return tex;
}

export function loadSunVis(meta: GreenhouseMeta, variant: Variant): Promise<THREE.Data3DTexture> {
  const url = `${HI}/sunvis-${variant}.png`;
  let p = cache.get(url);
  if (!p) {
    p = meta.sunvis
      ? decode(url, meta.sunvis).catch((e: unknown) => {
          console.warn("greenhouse: sun visibility unavailable, rendering unshadowed", e);
          return litTexture();
        })
      : Promise.resolve(litTexture());
    cache.set(url, p);
  }
  return p;
}

/** Grid placement as shader uniforms (Blender coordinates, meters). */
export function sunVisUniforms(meta: GreenhouseMeta, tex: THREE.Data3DTexture) {
  const { min, cell, dims } = tex.image.width === 1 ? FALLBACK : (meta.sunvis ?? FALLBACK);
  return {
    tVis: { value: tex },
    uVisMin: { value: new THREE.Vector3(...min) },
    uVisSize: { value: new THREE.Vector3(dims[0] * cell, dims[1] * cell, dims[2] * cell) },
  };
}

/** GLSL: visibility at a three.js world position (1 outside the grid). */
export const SUNVIS_GLSL = /* glsl */ `
  uniform highp sampler3D tVis;
  uniform vec3 uVisMin;
  uniform vec3 uVisSize;
  float sunVisibility(vec3 p) {
    vec3 uvw = (vec3(p.x, -p.z, p.y) - uVisMin) / uVisSize;
    if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return 1.0;
    return texture(tVis, uvw).r;
  }
`;
