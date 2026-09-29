import * as THREE from "three";

/** Layout + ball circuits written by art/worlds/pinball/pinball_model.py (three.js coordinates). */
export interface PinballMeta {
  ballR: number;
  sMax: number;
  bumpers: { p: [number, number, number]; r: number; color: string }[];
  flippers: { pivot: [number, number, number]; rest: number; up: number }[];
  spinner: { p: [number, number, number]; w: number };
  targets: [number, number, number][];
  backglass: { center: [number, number, number]; size: [number, number] };
  dmd: { center: [number, number, number]; size: [number, number] };
  ramp: { points: number[]; length: number; marks: Record<"plastic_end" | "top" | "cork_start" | "cork_end" | "end", number> };
  camU: { s0: number; step: number; u: number[]; lead: number };
  loops: Record<"orbit" | "bumpers" | "ramp", { points: number[]; length: number }>;
  launch: { points: number[]; length: number; times: number[]; plungerX: number };
  plunger: [number, number, number];
}

const META_URL = "/worlds/pinball/hi/pinball.json";
let metaPromise: Promise<PinballMeta> | null = null;

export function loadMeta(): Promise<PinballMeta> {
  if (!metaPromise) {
    metaPromise = fetch(META_URL).then((r) => {
      if (!r.ok) throw new Error(`pinball meta: ${r.status}`);
      return r.json() as Promise<PinballMeta>;
    });
  }
  return metaPromise;
}

/** Arc-length parameterized polyline (points are evenly spaced by the build). */
export class Polyline {
  readonly pts: Float32Array;
  readonly n: number;
  readonly length: number;
  readonly closed: boolean;

  constructor(points: number[], length: number, closed: boolean) {
    this.pts = Float32Array.from(points);
    this.n = points.length / 3;
    this.length = length;
    this.closed = closed;
  }

  /** Position at arc length u (wraps on closed loops, clamps on open paths). */
  at(u: number, out: THREE.Vector3): THREE.Vector3 {
    const span = this.closed ? this.n : this.n - 1;
    let f = (u / this.length) * span;
    if (this.closed) f = ((f % span) + span) % span;
    else f = THREE.MathUtils.clamp(f, 0, span);
    const i = Math.min(Math.floor(f), this.closed ? this.n - 1 : this.n - 2);
    const j = this.closed ? (i + 1) % this.n : i + 1;
    const t = f - i;
    const p = this.pts;
    return out.set(
      p[i * 3] + (p[j * 3] - p[i * 3]) * t,
      p[i * 3 + 1] + (p[j * 3 + 1] - p[i * 3 + 1]) * t,
      p[i * 3 + 2] + (p[j * 3 + 2] - p[i * 3 + 2]) * t,
    );
  }
}

export function sampleTable(values: number[], s0: number, step: number, s: number): number {
  const f = THREE.MathUtils.clamp((s - s0) / step, 0, values.length - 1);
  const i = Math.min(Math.floor(f), values.length - 2);
  return values[i] + (values[i + 1] - values[i]) * (f - i);
}

export const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export interface Circuits {
  ramp: Polyline;
  orbit: Polyline;
  bumpers: Polyline;
  rampLoop: Polyline;
  launch: Polyline;
}

export function circuits(meta: PinballMeta): Circuits {
  return {
    ramp: new Polyline(meta.ramp.points, meta.ramp.length, false),
    orbit: new Polyline(meta.loops.orbit.points, meta.loops.orbit.length, true),
    bumpers: new Polyline(meta.loops.bumpers.points, meta.loops.bumpers.length, true),
    rampLoop: new Polyline(meta.loops.ramp.points, meta.loops.ramp.length, true),
    launch: new Polyline(meta.launch.points, meta.launch.length, false),
  };
}

/** Where the hero ball sits on the ramp at chapter time s (just ahead of the riding camera). */
export function heroU(meta: PinballMeta, s: number): number {
  return sampleTable(meta.camU.u, meta.camU.s0, meta.camU.step, s) + meta.camU.lead;
}
