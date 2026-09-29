"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { gsap } from "gsap";
import { pointer, useUi } from "@/lib/store";
import { WORLDS } from "@/lib/worlds";
import type { SceneId } from "@/worlds/types";
import { engine } from "@/components/three/engine/state";
import { cursor, cursorBridge, ThemeContext, type ThemeContextValue } from "@/components/cursor/core";
import { CURSOR_THEMES } from "@/components/cursor/themes";

const FADE = 0.35;

interface Mounted {
  id: SceneId;
  ctx: ThemeContextValue;
  target: number;
}

/** Hover state the DOM listeners write and the frame loop reads. */
const hover = { link: false, label: null as string | null, hidden: false, left: true };

function currentTheme(): SceneId {
  const ui = useUi.getState();
  return ui.cursorOverride ?? engine.primaryScene ?? WORLDS[ui.world].scene;
}

/**
 * Which theme is showing, plus any still fading out. Polls the engine (the
 * scene under the viewport changes mid-scroll without React knowing).
 */
function useThemeStack(): { active: SceneId; mounted: Mounted[] } {
  const [stack, setStack] = useState<{ active: SceneId; mounted: Mounted[] }>(() => ({ active: "garden", mounted: [] }));
  useEffect(() => {
    const sync = () => {
      const active = currentTheme();
      setStack((prev) => {
        let changed = prev.active !== active || !prev.mounted.some((m) => m.id === active);
        let mounted = prev.mounted.map((m) => {
          const target = m.id === active ? 1 : 0;
          if (target !== m.target) changed = true;
          return target === m.target ? m : { ...m, target };
        });
        if (!mounted.some((m) => m.id === active)) mounted = [...mounted, { id: active, target: 1, ctx: { weight: { current: 0 }, clicks: new Set() } }];
        const kept = mounted.filter((m) => m.target > 0 || m.ctx.weight.current > 0.01);
        if (kept.length !== mounted.length) changed = true;
        return changed ? { active, mounted: kept } : prev;
      });
    };
    sync();
    const id = window.setInterval(sync, 120);
    const unsub = useUi.subscribe(sync);
    return () => {
      window.clearInterval(id);
      unsub();
    };
  }, []);
  return stack;
}

function ThemeHost({ mounted }: { mounted: Mounted[] }) {
  // Advance cursor state and theme weights once per frame, before theme parts run.
  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    cursor.time += d;
    cursor.width = state.size.width;
    cursor.height = state.size.height;
    const px = pointer.x;
    const py = pointer.y;
    const dx = px - cursor.x;
    const dy = py - cursor.y;
    cursor.moved = Math.hypot(dx, dy);
    if (cursor.moved > 400) cursor.moved = 0;
    const k = 1 - Math.exp(-d * 18);
    cursor.vx += (dx / Math.max(d, 1e-3) - cursor.vx) * k;
    cursor.vy += (dy / Math.max(d, 1e-3) - cursor.vy) * k;
    cursor.speed = Math.hypot(cursor.vx, cursor.vy);
    cursor.x = px;
    cursor.y = py;
    cursor.down = pointer.down;
    cursor.hover += ((hover.link ? 1 : 0) - cursor.hover) * (1 - Math.exp(-d * 12));
    cursor.labelled = Boolean(hover.label);
    const present = pointer.active && !hover.hidden && !hover.left;
    cursor.presence += ((present ? 1 : 0) - cursor.presence) * (1 - Math.exp(-d * 10));
    for (const m of mounted) {
      const w = m.ctx.weight;
      w.current += Math.sign(m.target - w.current) * Math.min(Math.abs(m.target - w.current), d / FADE);
    }
  }, -1);

  return (
    <>
      {mounted.map((m) => {
        const { Parts } = CURSOR_THEMES[m.id];
        return (
          <ThemeContext.Provider key={m.id} value={m.ctx}>
            <Parts />
          </ThemeContext.Provider>
        );
      })}
    </>
  );
}

/**
 * The themed cursor: a transparent overlay canvas above the page. Each world
 * brings its own pointer, trail, click effect, and label style; they crossfade
 * as the scene under you changes. Off on touch devices and reduced motion.
 */
export function CursorLayer() {
  const isTouch = useUi((s) => s.isTouch);
  const reducedMotion = useUi((s) => s.reducedMotion);
  const enabled = !isTouch && !reducedMotion;
  const { active, mounted } = useThemeStack();
  const labelRef = useRef<HTMLDivElement>(null);
  const labelText = useRef<HTMLSpanElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const theme = CURSOR_THEMES[active];

  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    root.dataset.customCursor = "true";
    const onOver = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      const labelled = el?.closest<HTMLElement>("[data-cursor]");
      hover.left = false;
      if (labelled) {
        const l = labelled.dataset.cursor ?? "";
        hover.hidden = l === "hidden";
        hover.label = l && l !== "hidden" ? l : null;
        hover.link = false;
      } else {
        hover.hidden = false;
        hover.label = null;
        hover.link = Boolean(el?.closest("a, button, [role='button'], input, textarea, select, label, summary"));
      }
      const lab = labelRef.current;
      if (lab && labelText.current) {
        if (hover.label) labelText.current.textContent = hover.label;
        gsap.to(lab, { autoAlpha: hover.label ? 1 : 0, scale: hover.label ? 1 : 0.6, duration: 0.3, ease: "back.out(2)" });
      }
    };
    const onLeave = () => (hover.left = true);
    const onEnter = () => (hover.left = false);
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      for (const m of mounted) if (m.target > 0) m.ctx.clicks.forEach((fn) => fn(e.clientX, e.clientY));
    };
    const lab = labelRef.current;
    const ro = readoutRef.current;
    const lx = lab ? gsap.quickTo(lab, "x", { duration: 0.25, ease: "power3.out" }) : null;
    const ly = lab ? gsap.quickTo(lab, "y", { duration: 0.25, ease: "power3.out" }) : null;
    const tick = () => {
      lx?.(pointer.x);
      ly?.(pointer.y);
      if (ro) {
        ro.style.transform = `translate(${pointer.x + 26}px, ${pointer.y + 14}px)`;
        const e = cursorBridge.elevation;
        ro.textContent = e === null ? "— m" : `${Math.round(e).toLocaleString("en-US")} m`;
      }
    };
    gsap.ticker.add(tick);
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("pointerdown", onDown, { passive: true });
    root.addEventListener("pointerleave", onLeave);
    root.addEventListener("pointerenter", onEnter);
    return () => {
      gsap.ticker.remove(tick);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointerleave", onLeave);
      root.removeEventListener("pointerenter", onEnter);
      delete root.dataset.customCursor;
    };
  }, [enabled, mounted]);

  const labelStyle = useMemo(() => theme.label, [theme]);

  if (!enabled) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[100]">
      <Canvas
        orthographic
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: "low-power" }}
        camera={{ position: [0, 0, 100], zoom: 1, near: 0.1, far: 1000 }}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        events={undefined}
        flat
      >
        <ThemeHost mounted={mounted} />
      </Canvas>
      <div
        ref={labelRef}
        className="font-display absolute left-0 top-0 -ml-[44px] -mt-[18px] flex h-9 min-w-[88px] items-center justify-center px-4 text-xs font-bold uppercase tracking-wider opacity-0 transition-[background,color,border-color,border-radius] duration-500"
        style={{ ...labelStyle, visibility: "hidden" }}
      >
        <span ref={labelText} />
      </div>
      {theme.readout && (
        <div
          ref={readoutRef}
          className="absolute left-0 top-0 rounded-md border border-[rgba(244,197,82,0.5)] bg-[rgba(15,27,45,0.78)] px-2 py-1 font-mono text-[11px] font-bold tracking-wider text-[#f4c552] backdrop-blur"
        />
      )}
    </div>
  );
}
