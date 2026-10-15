/** Per-frame monolith pose. Written by the glass, read by the light and the spectrum. No React state. */
export const drive = {
  /** 0 = one slab, 1 = five facets fanned apart. */
  split: 0,
  /** Radians the key light has swung from its rest angle. */
  yaw: 0,
  /** Radians the whole monolith has turned toward the cursor. */
  turn: 0,
};

export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
