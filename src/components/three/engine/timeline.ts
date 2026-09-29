import type { World } from "@/lib/worlds";
import type { SceneId, TransitionKind } from "@/worlds/types";

export interface Segment {
  scene: SceneId;
  /** Scene-local time at the start of this chapter. */
  sStart: number;
  transition: TransitionKind;
}

/** Map the page's chapters onto scenes. Unknown chapter ids continue the previous scene. */
export function buildSegments(world: World, ids: string[]): Segment[] {
  const segs: Segment[] = [];
  let prev: Segment | null = null;
  for (const id of ids) {
    const binding = world.chapters.find((c) => c.id === id);
    const scene = binding?.scene ?? prev?.scene ?? world.scene;
    const sStart = prev && prev.scene === scene ? prev.sStart + 1 : 0;
    const seg: Segment = { scene, sStart, transition: binding?.transition ?? "dissolve" };
    segs.push(seg);
    prev = seg;
  }
  return segs;
}

export interface Frame {
  a: SceneId;
  sA: number;
  b: SceneId | null;
  sB: number;
  mix: number;
  kind: TransitionKind;
  /** A scene worth mounting soon (next or previous boundary). */
  soon: SceneId | null;
}

// Transition window around a chapter boundary where the scene changes.
const WIN_BEFORE = 0.22;
const WIN_AFTER = 0.08;
const PRELOAD = 0.9;

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function resolveFrame(segs: Segment[], t: number, fallback: SceneId, out: Frame): Frame {
  const n = segs.length;
  out.b = null;
  out.mix = 0;
  out.soon = null;
  if (!n) {
    out.a = fallback;
    out.sA = 0;
    return out;
  }
  const i = Math.min(n - 1, Math.max(0, Math.floor(t)));
  const local = t - i;
  for (const b of [i + 1, i]) {
    if (b <= 0 || b >= n || segs[b].scene === segs[b - 1].scene) continue;
    if (t >= b - WIN_BEFORE && t <= b + WIN_AFTER) {
      out.a = segs[b - 1].scene;
      out.sA = segs[b - 1].sStart + (t - (b - 1));
      out.b = segs[b].scene;
      out.sB = segs[b].sStart + (t - b);
      out.mix = smoothstep(b - WIN_BEFORE, b + WIN_AFTER, t);
      out.kind = segs[b].transition;
      return out;
    }
  }
  out.a = segs[i].scene;
  out.sA = segs[i].sStart + local;
  if (i + 1 < n && segs[i + 1].scene !== segs[i].scene && 1 - local < PRELOAD) out.soon = segs[i + 1].scene;
  else if (i > 0 && segs[i - 1].scene !== segs[i].scene && local < PRELOAD) out.soon = segs[i - 1].scene;
  return out;
}

export function emptyFrame(scene: SceneId): Frame {
  return { a: scene, sA: 0, b: null, sB: 0, mix: 0, kind: "dissolve", soon: null };
}
