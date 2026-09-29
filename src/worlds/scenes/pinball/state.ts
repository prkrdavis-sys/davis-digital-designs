import * as THREE from "three";
import { circuits, heroU, smooth, type Circuits, type PinballMeta } from "@/worlds/scenes/pinball/model";

export interface Ball {
  pos: THREE.Vector3;
  visible: boolean;
}

/** Everything the table animates, recomputed each frame by `stepTable`. */
export interface TableState {
  time: number;
  s: number;
  balls: Ball[];
  bumperFlash: number[];
  /** 0 = rest, 1 = fully flipped. */
  flippers: number[];
  spinnerAngle: number;
  spinnerVel: number;
  /** 0 = standing, 1 = dropped. */
  targets: number[];
  /** Outro multiball intensity (backglass, chase lights, DMD). */
  multiball: number;
  /** MULTIBALL letters lit so far (0..9). */
  letters: number;
  /** Hero ball position, used as the depth-of-field focus. */
  focus: THREE.Vector3;
}

interface Internal {
  c: Circuits;
  leadLen: number;
  heroFree: number;
  launchAt: number[];
  orbitJoin: number;
}

export const BALL_COUNT = 8;
const ORBIT_SPEED = 4.6;
const BUMPER_SPEED = 3.2;
const LAUNCH_SPEED = 11;

export function createTableState(meta: PinballMeta): TableState & { internal: Internal } {
  const c = circuits(meta);
  // Where the ramp starts along the flipper -> ramp -> flipper loop.
  const start = c.ramp.at(0, new THREE.Vector3());
  const p = new THREE.Vector3();
  let best = 0;
  let bestD = Infinity;
  for (let u = 0; u < c.rampLoop.length * 0.5; u += 0.02) {
    const d = c.rampLoop.at(u, p).distanceToSquared(start);
    if (d < bestD) {
      bestD = d;
      best = u;
    }
  }
  const end = c.launch.at(c.launch.length, new THREE.Vector3());
  let join = 0;
  bestD = Infinity;
  for (let u = 0; u < c.orbit.length; u += 0.02) {
    const d = c.orbit.at(u, p).distanceToSquared(end);
    if (d < bestD) {
      bestD = d;
      join = u;
    }
  }
  return {
    time: 0,
    s: 0,
    balls: Array.from({ length: BALL_COUNT }, () => ({ pos: new THREE.Vector3(), visible: false })),
    bumperFlash: [0, 0, 0],
    flippers: [0, 0],
    spinnerAngle: 0,
    spinnerVel: 0,
    targets: meta.targets.map(() => 0),
    multiball: 0,
    letters: 0,
    focus: new THREE.Vector3(),
    internal: { c, leadLen: best, heroFree: 0, launchAt: meta.launch.times.map(() => -1), orbitJoin: join },
  };
}

function flipPulse(f: number) {
  if (f < 0.05) return f / 0.05;
  if (f < 0.16) return 1;
  if (f < 0.27) return 1 - (f - 0.16) / 0.11;
  return 0;
}

const tmp = new THREE.Vector3();

export function stepTable(st: TableState & { internal: Internal }, meta: PinballMeta, s: number, dt: number, cam: THREE.Vector3) {
  const d = Math.min(dt, 0.05);
  const I = st.internal;
  const { c } = I;
  st.time += d;
  st.s = s;
  const t = st.time;

  // Hero ball: rolls from the right flipper to the ramp during the intro, then
  // stays just ahead of the riding camera, then rejoins play on its own.
  const hero = st.balls[0];
  let u: number;
  if (s < 1) u = THREE.MathUtils.lerp(0.4, I.leadLen + meta.camU.lead, smooth(0.05, 1.0, s));
  else u = I.leadLen + heroU(meta, s);
  if (s > 3.04) I.heroFree += d * ORBIT_SPEED;
  else I.heroFree = 0;
  c.rampLoop.at(u + I.heroFree, hero.pos);
  hero.visible = true;
  st.focus.copy(hero.pos);

  // One ball keeps the pop bumpers busy, one works the orbit and the spinner.
  c.bumpers.at(t * BUMPER_SPEED, st.balls[1].pos);
  st.balls[1].visible = true;
  c.orbit.at(t * ORBIT_SPEED + 7, st.balls[2].pos);
  st.balls[2].visible = true;

  // Multiball: balls wait in the plunger lane and launch as the outro scrolls in.
  let launched = 0;
  meta.launch.times.forEach((ts, k) => {
    const b = st.balls[3 + k];
    if (s >= ts) {
      if (I.launchAt[k] < 0) I.launchAt[k] = t;
      const la = (t - I.launchAt[k]) * LAUNCH_SPEED;
      if (la < c.launch.length) c.launch.at(la, b.pos);
      else c.orbit.at(I.orbitJoin + (la - c.launch.length) * (ORBIT_SPEED / LAUNCH_SPEED) + k * 3.1, b.pos);
      b.visible = true;
      launched++;
    } else {
      I.launchAt[k] = -1;
      const q = meta.plunger;
      b.pos.set(q[0], q[1], q[2] + (k - launched) * 0.34);
      b.visible = k === launched;
    }
  });
  for (let i = 3 + meta.launch.times.length; i < BALL_COUNT; i++) st.balls[i].visible = false;
  st.multiball = smooth(3.1, 3.75, s);
  st.letters = 9 * smooth(2.85, 3.55, s);

  // Pop bumpers flash when a ball touches them, and in a strobe as the camera sweeps past.
  meta.bumpers.forEach((bm, i) => {
    let hit = 0;
    for (const b of st.balls) {
      if (!b.visible) continue;
      const dx = b.pos.x - bm.p[0];
      const dz = b.pos.z - bm.p[2];
      if (b.pos.y < 0.5 && dx * dx + dz * dz < (bm.r + 0.22) ** 2) hit = 1;
    }
    tmp.set(bm.p[0], 0.4, bm.p[2]);
    const near = 1 - smooth(1.4, 3.6, tmp.distanceTo(cam));
    const strobe = near > 0.05 && ((t * 7 + i * 0.37) % 1) < 0.35 ? near : 0;
    const idle = st.multiball * (((t * 3.2 + i * 0.33) % 1) < 0.25 ? 1 : 0);
    st.bumperFlash[i] = Math.max(st.bumperFlash[i] * Math.exp(-d * 9), hit, strobe, idle);
  });

  // Flippers: an occasional lazy flip, rapid-fire during multiball.
  const rate = THREE.MathUtils.lerp(0.35, 1.6, st.multiball);
  st.flippers[0] = flipPulse((t * rate) % 1);
  st.flippers[1] = flipPulse((t * rate + 0.47) % 1);

  // Spinner: kicked by the orbit ball, coasts down.
  const sp = meta.spinner.p;
  for (const b of st.balls) {
    if (!b.visible) continue;
    const dx = b.pos.x - sp[0];
    const dz = b.pos.z - sp[2];
    if (Math.abs(dz) < 0.12 && Math.abs(dx) < meta.spinner.w * 0.6 && b.pos.y < 0.4) st.spinnerVel = Math.max(st.spinnerVel, 38);
  }
  st.spinnerVel *= Math.exp(-d * 0.9);
  st.spinnerAngle += st.spinnerVel * d;

  // Drop targets fall one by one during the finale.
  st.targets.forEach((_, k) => (st.targets[k] = smooth(3.22 + k * 0.09, 3.3 + k * 0.09, s)));
}
