import * as THREE from "three";
import WORLD from "@/worlds/scenes/planes/world.json";

/** Same generator as art/worlds/planes/pl_flock.py, so both build the same formation. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Slot {
  home: [number, number, number];
  print: number;
  tint: number;
  scale: number;
  phase: number;
}

export function slots(): Slot[] {
  const { count, extent } = WORLD.flock;
  const [ex, ey, ez] = extent;
  const rnd = mulberry32(1234);
  const out: Slot[] = [];
  for (let i = 0; i < count; i++) {
    const zf = rnd() * 2 - 1;
    const back = (zf + 1) / 2;
    const x = ex * (rnd() * 2 - 1) * (0.35 + 0.65 * back);
    const y = ey * (rnd() * 2 - 1);
    out.push({ home: [x, y, ez * zf], print: Math.min(3, Math.floor(rnd() * 4)), tint: rnd(), scale: 0.85 + rnd() * 0.3, phase: rnd() * Math.PI * 2 });
  }
  return out;
}

const UP = new THREE.Vector3(0, 1, 0);
const _f = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

/**
 * Orientation for a paper plane (nose along local -Z) flying along `heading`,
 * rolled by `bank` radians (positive = right wing down).
 */
export function planeMatrix(out: THREE.Matrix4, pos: THREE.Vector3, heading: THREE.Vector3, bank: number, pitch: number, scale: number) {
  _f.copy(heading).normalize();
  _f.y += pitch;
  _f.normalize();
  _z.copy(_f).negate();
  _x.crossVectors(UP, _z).normalize();
  _y.crossVectors(_z, _x);
  const c = Math.cos(bank);
  const s = Math.sin(bank);
  const x = _x.clone().multiplyScalar(c).addScaledVector(_y, -s);
  const y = _y.clone().multiplyScalar(c).addScaledVector(_x, s);
  out.makeBasis(x.multiplyScalar(scale), y.multiplyScalar(scale), _z.multiplyScalar(scale));
  out.setPosition(pos);
  return out;
}

/**
 * Loose formation flight. Planes spring toward their slot around a swaying
 * anchor, keep apart, dodge the camera, and bank with their sideways motion.
 * The world streams past (clouds on a treadmill), so velocities here are
 * relative to the flock's airspeed along -Z.
 */
export class FlockSim {
  readonly slots = slots();
  readonly n = this.slots.length;
  readonly pos = new Float32Array(this.n * 3);
  readonly vel = new Float32Array(this.n * 3);
  readonly acc = new Float32Array(this.n * 3);
  readonly bank = new Float32Array(this.n);
  readonly anchor = new THREE.Vector3();
  readonly airspeed = WORLD.flock.airspeed;
  private readonly base = new THREE.Vector3(...(WORLD.flock.anchor as [number, number, number]));

  constructor() {
    this.setAnchor(0);
    this.slots.forEach((s, i) => {
      this.pos[i * 3] = this.anchor.x + s.home[0];
      this.pos[i * 3 + 1] = this.anchor.y + s.home[1];
      this.pos[i * 3 + 2] = this.anchor.z + s.home[2];
    });
  }

  setAnchor(t: number) {
    this.anchor.set(6 * Math.sin(0.21 * t) + 2 * Math.sin(0.07 * t), 1.2 * Math.sin(0.15 * t + 1), 3 * Math.sin(0.11 * t + 2)).add(this.base);
  }

  step(dt: number, t: number, cam: THREE.Vector3) {
    this.setAnchor(t);
    const { n, pos, vel, acc } = this;
    for (let i = 0; i < n; i++) {
      const s = this.slots[i];
      const ph = s.phase;
      const tx = this.anchor.x + s.home[0] + 1.2 * Math.sin(0.37 * t + ph);
      const ty = this.anchor.y + s.home[1] + 0.5 * Math.sin(0.53 * t + 2 * ph);
      const tz = this.anchor.z + s.home[2] + 1.6 * Math.sin(0.29 * t + 3 * ph);
      const px = pos[i * 3];
      const py = pos[i * 3 + 1];
      const pz = pos[i * 3 + 2];
      let ax = (tx - px) * 0.9 - vel[i * 3] * 1.4;
      let ay = (ty - py) * 0.9 - vel[i * 3 + 1] * 1.4;
      let az = (tz - pz) * 0.9 - vel[i * 3 + 2] * 1.4;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dx = px - pos[j * 3];
        const dy = py - pos[j * 3 + 1];
        const dz = pz - pos[j * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 3.2 && d2 > 1e-6) {
          const k = 1.6 / d2;
          ax += dx * k;
          ay += dy * k;
          az += dz * k;
        }
      }
      const cx = px - cam.x;
      const cy = py - cam.y;
      const cz = pz - cam.z;
      const cd = Math.hypot(cx, cy, cz);
      if (cd < 4.5 && cd > 1e-4) {
        const k = ((4.5 - cd) * 5) / cd;
        ax += cx * k;
        ay += cy * k;
        az += cz * k;
      }
      acc[i * 3] = ax;
      acc[i * 3 + 1] = ay;
      acc[i * 3 + 2] = az;
    }
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        const k = i * 3 + c;
        vel[k] = THREE.MathUtils.clamp(vel[k] + acc[k] * dt, -4.5, 4.5);
        pos[k] += vel[k] * dt;
      }
      // Heading is airspeed along -Z plus the relative velocity; bank into sideways motion.
      const hx = vel[i * 3];
      const hz = vel[i * 3 + 2] - this.airspeed;
      const inv = 1 / Math.hypot(hx, hz);
      // Right of the heading is (-hz, hx) in XZ; project velocity and acceleration onto it.
      const lat = (vel[i * 3] * -hz + vel[i * 3 + 2] * hx) * inv;
      const latAcc = (acc[i * 3] * -hz + acc[i * 3 + 2] * hx) * inv;
      const target = THREE.MathUtils.clamp(lat * 0.2 + latAcc * 0.05, -0.95, 0.95);
      this.bank[i] += (target - this.bank[i]) * (1 - Math.exp(-dt * 2.5));
    }
  }

  /** Nose direction (world) of plane i. */
  heading(i: number, out: THREE.Vector3) {
    return out.set(this.vel[i * 3], this.vel[i * 3 + 1] * 0.8, this.vel[i * 3 + 2] - this.airspeed).normalize();
  }
}
