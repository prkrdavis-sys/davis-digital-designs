"use client";

import { use, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { pointer } from "@/lib/store";
import { useSceneTime } from "@/components/three/engine/slot";

/** Camera samples exported from Blender by art/lib/ddd/rails.py. */
export interface Rail {
  step: number;
  sMax: number;
  count: number;
  p: number[];
  q: number[];
  fov: number[];
}

const cache = new Map<string, Promise<Rail>>();

export function loadRail(url: string): Promise<Rail> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`rail ${url}: ${r.status}`);
      return r.json() as Promise<Rail>;
    });
    cache.set(url, p);
  }
  return p;
}

/** Suspends until the rail JSON is loaded. */
export function useRail(url: string): Rail {
  return use(loadRail(url));
}

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();

/** Interpolated camera pose at chapter time `s`. Returns the vertical FOV in degrees. */
export function sampleRail(rail: Rail, s: number, pos: THREE.Vector3, quat: THREE.Quaternion): number {
  const f = THREE.MathUtils.clamp(s / rail.step, 0, rail.count - 1);
  const i = Math.min(Math.floor(f), rail.count - 2);
  const t = rail.count > 1 ? f - i : 0;
  const j = Math.min(i + 1, rail.count - 1);
  const p = rail.p;
  pos.set(
    p[i * 3] + (p[j * 3] - p[i * 3]) * t,
    p[i * 3 + 1] + (p[j * 3 + 1] - p[i * 3 + 1]) * t,
    p[i * 3 + 2] + (p[j * 3 + 2] - p[i * 3 + 2]) * t,
  );
  const q = rail.q;
  qa.set(q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]);
  qb.set(q[j * 4], q[j * 4 + 1], q[j * 4 + 2], q[j * 4 + 3]);
  quat.slerpQuaternions(qa, qb, t);
  return rail.fov[i] + (rail.fov[j] - rail.fov[i]) * t;
}

interface RailCameraProps {
  rail: Rail;
  /** Meters the camera slides with the pointer. */
  parallax?: number;
  /** Radians the camera turns toward the pointer. */
  look?: number;
  /** Map scene time before sampling (parked views, slow-downs). */
  remap?: (s: number) => number;
  /** Portrait screens: widen the vertical FOV so the subject stays in frame. */
  portraitBoost?: number;
}

const offset = new THREE.Vector3();
const turn = new THREE.Euler();
const turnQ = new THREE.Quaternion();

/** Drives the scene camera along a Blender-authored rail with pointer parallax. */
export function RailCamera({ rail, parallax = 0.25, look = 0.035, remap, portraitBoost = 0.6 }: RailCameraProps) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const time = useSceneTime();
  const pos = useMemo(() => new THREE.Vector3(), []);
  const quat = useMemo(() => new THREE.Quaternion(), []);

  useFrame(() => {
    const s = remap ? remap(time.s) : time.s;
    let fov = sampleRail(rail, s, pos, quat);
    const px = pointer.sx;
    const py = pointer.sy;
    offset.set(px * parallax, py * parallax * 0.6, 0).applyQuaternion(quat);
    camera.position.copy(pos).add(offset);
    turn.set(py * look * 0.6, -px * look, 0);
    turnQ.setFromEuler(turn);
    camera.quaternion.copy(quat).multiply(turnQ);
    if (camera.aspect < 1) {
      // Keep roughly the same horizontal coverage on tall phones.
      const hFov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * 1);
      const want = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hFov / 2) / camera.aspect));
      fov = THREE.MathUtils.lerp(fov, Math.min(want, 100), portraitBoost);
    }
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}
