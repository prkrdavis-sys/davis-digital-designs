"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { pointer, scrollState, useQuality, useUi, useVariant } from "@/lib/store";
import { WORLDS } from "@/lib/worlds";
import { SCENE_COMPONENTS } from "@/worlds/registry";
import type { SceneId, TransitionKind } from "@/worlds/types";
import { chapters, chapterTimeAt, engine, routeIntent } from "@/components/three/engine/state";
import { createCompositor, TONE_INDEX, TRANSITION_INDEX } from "@/components/three/engine/compositor";
import { SceneSlot, type SlotHandle } from "@/components/three/engine/slot";
import { buildSegments, emptyFrame, resolveFrame, type Frame } from "@/components/three/engine/timeline";

const KEEP_MS = 5000;
const ROUTE_SECONDS = 1.15;

/** Seconds off screen before a mounted scene gives its GPU buffers back. */
const RELEASE_AFTER = 1.5;

/**
 * Owns the frame: decides which scenes are mounted, advances their time from
 * scroll, renders one or two of them to HDR targets, and composites them with
 * the chapter's transition. Route changes crossfade from the old world's last
 * frame once the new world has compiled.
 */
export function WorldDirector() {
  const worldId = useUi((s) => s.world);
  const parked = useUi((s) => s.parked);
  const chapterIds = useUi((s) => s.chapterIds);
  const variant = useVariant();
  const quality = useQuality();
  const world = WORLDS[worldId];

  const segs = useMemo(() => buildSegments(world, chapterIds), [world, chapterIds]);
  const segsRef = useRef(segs);
  segsRef.current = segs;
  const fallbackRef = useRef(world.scene);
  fallbackRef.current = world.scene;

  const [mounted, setMounted] = useState<SceneId[]>([world.scene]);
  const mountedKey = useRef(world.scene as string);
  const lastNeeded = useRef(new Map<SceneId, number>());
  const slots = useRef(new Map<SceneId, SlotHandle>());
  const register = useCallback((h: SlotHandle | null, id: SceneId) => {
    if (h) slots.current.set(id, h);
    else slots.current.delete(id);
  }, []);

  const frame = useRef<Frame>(emptyFrame(world.scene));
  const route = useRef({ from: null as SceneId | null, mix: 1, kind: "dissolve" as TransitionKind, waited: 0 });
  const prevWorld = useRef(worldId);
  const lastPrimary = useRef<SceneId | null>(null);
  const opacity = useRef(0);

  const lastRendered = useRef(new Map<SceneId, number>());
  const comp = useMemo(() => createCompositor(), []);
  useEffect(() => () => comp.dispose(), [comp]);
  const seam = useMemo(() => new THREE.Color(), []);
  const bufferSize = useMemo(() => new THREE.Vector2(), []);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    // Dev-only handle for poking at the engine from the browser console or automation.
    const toT = (t: number) => {
      const a = chapters.anchors;
      const i = Math.min(Math.floor(t), a.length - 2);
      return a[i] + (a[i + 1] - a[i]) * (t - i);
    };
    (window as unknown as { __ddd: unknown }).__ddd = { engine, slots: slots.current, frame: frame.current, route: route.current, chapters, scrollToT: (t: number) => window.scrollTo(0, toT(t)) };
  }, []);

  useEffect(() => {
    if (prevWorld.current === worldId) return;
    prevWorld.current = worldId;
    route.current = { from: lastPrimary.current, mix: 0, kind: routeIntent.kind ?? WORLDS[worldId].entry, waited: 0 };
    routeIntent.kind = null;
    // New page starts at the top: jump camera time instead of sweeping back through chapters.
    engine.t = 0;
    engine.rawT = 0;
  }, [worldId]);

  // Advance time and decide what is on screen. Runs before scene frame callbacks.
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.1);
    engine.time += d;
    engine.fps += (1 / Math.max(dt, 1e-3) - engine.fps) * 0.05;
    const pk = 1 - Math.exp(-d * 4);
    pointer.sx += (pointer.nx - pointer.sx) * pk;
    pointer.sy += (pointer.ny - pointer.sy) * pk;

    const raw = chapterTimeAt(scrollState.y);
    engine.rawT = raw;
    const prevT = engine.t;
    engine.t += (raw - engine.t) * (1 - Math.exp(-d * 5));
    engine.velocity += ((engine.t - prevT) / Math.max(d, 1e-3) - engine.velocity) * 0.15;
    engine.chapter = Math.floor(engine.t);

    const f = resolveFrame(segsRef.current, engine.t, fallbackRef.current, frame.current);
    const r = route.current;
    if (r.mix < 1) {
      const incoming = slots.current.get(f.a);
      if (incoming?.ready || !r.from) r.mix = Math.min(1, r.mix + d / ROUTE_SECONDS);
      else r.waited += d;
      if (r.waited > 3) r.mix = 1;
    }

    const now = performance.now();
    const needed = [f.a, f.b, f.soon, r.mix < 1 ? r.from : null].filter(Boolean) as SceneId[];
    for (const id of needed) lastNeeded.current.set(id, now);
    const keep = [...lastNeeded.current.entries()].filter(([, at]) => now - at < KEEP_MS).map(([id]) => id);
    for (const id of lastNeeded.current.keys()) if (!keep.includes(id)) lastNeeded.current.delete(id);
    const key = [...keep].sort().join(",");
    if (key !== mountedKey.current) {
      mountedKey.current = key;
      setMounted([...keep].sort());
    }

    for (const [id, slot] of slots.current) {
      const t = slot.time;
      t.visible = false;
      t.weight = 0;
      t.velocity = engine.velocity;
      if (id === f.a) {
        t.s = f.sA;
        t.visible = true;
        t.weight = 1 - f.mix;
      }
      if (id === f.b) {
        t.s = f.sB;
        t.visible = true;
        t.weight = f.mix;
      }
      if (r.mix < 1 && id === r.from && id !== f.a) t.visible = true;
    }
    engine.primaryScene = f.b && f.mix > 0.5 ? f.b : f.a;
  }, -1);

  // Render + composite. Priority 1 takes over R3F's default render.
  useFrame((state, dt) => {
    const gl = state.gl;
    const size = state.size;
    gl.getDrawingBufferSize(bufferSize);
    const f = frame.current;
    const r = route.current;
    const u = comp.material.uniforms;

    let first: SlotHandle | undefined;
    let second: SlotHandle | undefined;
    let mix = 0;
    let kind: TransitionKind = f.kind;
    const a = slots.current.get(f.a);
    const b = f.b ? slots.current.get(f.b) : undefined;
    const from = r.from ? slots.current.get(r.from) : undefined;

    if (r.mix < 1 && from?.ready && from !== a) {
      first = from;
      second = a?.ready ? a : undefined;
      mix = second ? r.mix : 0;
      kind = r.kind;
    } else if (a?.ready) {
      first = a;
      if (b?.ready && f.mix > 0.0005) {
        second = b;
        mix = f.mix;
      }
    } else if (b?.ready) {
      first = b;
    }

    const texA = first ? first.render(gl, size, bufferSize) : null;
    const texB = second ? second.render(gl, size, bufferSize) : null;
    if (first) lastPrimary.current = mix > 0.5 && second ? second.id : first.id;
    for (const s of [first, second]) if (s) lastRendered.current.set(s.id, engine.time);
    for (const [id, slot] of slots.current) {
      const at = lastRendered.current.get(id) ?? 0;
      if (slot !== first && slot !== second && engine.time - at > RELEASE_AFTER && at > 0) {
        slot.release();
        lastRendered.current.set(id, 0);
      }
    }

    u.tA.value = texA;
    u.tB.value = texB;
    u.uHasA.value = Boolean(first);
    u.uHasB.value = Boolean(second);
    u.uMix.value = mix;
    u.uKind.value = TRANSITION_INDEX[kind];
    u.uExposureA.value = first?.look.exposure ?? 1;
    u.uExposureB.value = second?.look.exposure ?? 1;
    u.uToneA.value = TONE_INDEX[first?.look.tone ?? "agx"];
    u.uToneB.value = TONE_INDEX[second?.look.tone ?? "agx"];
    const lead = second && mix > 0.5 ? second : first;
    u.uGrain.value = lead?.look.grain ?? 0.03;
    u.uVignette.value = lead?.look.vignette ?? 0.3;
    seam.set((second ?? first)?.look.seam ?? "#ffffff");
    u.uSeam.value.copy(seam);
    u.uTime.value = engine.time;
    u.uRes.value.set(bufferSize.x, bufferSize.y);
    u.uVelocity.value = engine.velocity * 10;
    comp.render(gl);

    const want = first ? 1 : 0;
    // Wall-clock fade: a heavy scene still appears within a beat, even when a frame takes a long time.
    const step = 1 - Math.exp(-dt * 5);
    const next = opacity.current + (want - opacity.current) * step;
    if (Math.abs(next - opacity.current) > 0.002 || (want === 1 && opacity.current < 1)) {
      opacity.current = Math.abs(want - next) < 0.003 ? want : next;
      gl.domElement.style.opacity = opacity.current.toFixed(3);
    }
  }, 1);

  return (
    <>
      {mounted.map((id) => {
        const Scene = SCENE_COMPONENTS[id];
        const mode = parked && id === world.scene ? "parked" : "tour";
        return (
          <SceneSlot key={`${id}:${quality}`} id={id} quality={quality} register={register}>
            <Scene variant={variant} quality={quality} mode={mode} />
          </SceneSlot>
        );
      })}
    </>
  );
}
