import * as THREE from "three";

export const MAX_RIPPLES = 16;

/**
 * Traveling wave packets, the same shape as the old pool ripple, shared by the
 * grass shader and the flower lean. `y` of each vector is world z.
 */
export const meadowWave = {
  data: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0)),
  next: 0,
  now: 0,
  add(x: number, z: number, t: number, strength: number) {
    this.data[this.next].set(x, z, t, strength);
    this.next = (this.next + 1) % MAX_RIPPLES;
  },
};

/** Radial wave slope. Kept in step with `meadowGrad` in the grass shader. */
function packet(r: number, front: number, width: number, k: number) {
  const x = r - front;
  const env = Math.exp(-(x * x) / (width * width));
  return env * (k * Math.cos(k * x) - ((2 * x) / (width * width)) * Math.sin(k * x));
}

const WIND = 2.4;

/** World-space lean (x, z) at a point on the ground. */
export function meadowLean(x: number, z: number, time: number, out: THREE.Vector2) {
  let gx = 0;
  let gz = 0;
  const data = meadowWave.data;
  for (let i = 0; i < MAX_RIPPLES; i++) {
    const rp = data[i];
    const age = time - rp.z;
    if (rp.w <= 0 || age < 0 || age > 5) continue;
    const dx = x - rp.x;
    const dz = z - rp.y;
    const r = Math.hypot(dx, dz) + 1e-4;
    const front = age * 1.35;
    const amp = (rp.w * Math.exp(-age * 0.9)) / (1 + front * 1.2);
    const g = packet(r, front, 0.22 + age * 0.12, 11) * amp;
    gx += (dx / r) * g;
    gz += (dz / r) * g;
  }
  const w1 = Math.sin(x * 0.65 + time * 1.25) * Math.cos(z * 0.45 - time * 0.55);
  const w2 = Math.cos(x * 0.35 - time * 0.8) * Math.sin(z * 0.7 + time * 1.05);
  gx += w1 * WIND;
  gz += w2 * WIND;
  return out.set(gx, gz);
}
