"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { AnimatePresence, motion } from "motion/react";
import { pointer, useUi } from "@/lib/store";
import { EASE_CURVE } from "@/lib/motion";

const TRAIL = 6;

/**
 * Custom cursor: a dot that snaps to the pointer, a lazy ring that grows over
 * links and morphs into a label pill over anything with data-cursor="Label",
 * plus a comet trail of dots. Disabled on touch devices and reduced motion.
 */
export function CustomCursor() {
  const isTouch = useUi((s) => s.isTouch);
  const reducedMotion = useUi((s) => s.reducedMotion);
  const variant = useUi((s) => s.cursorVariant);
  const label = useUi((s) => s.cursorLabel);
  const setCursor = useUi((s) => s.setCursor);

  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const trailRefs = useRef<Array<HTMLDivElement | null>>([]);

  const enabled = !isTouch && !reducedMotion;

  useEffect(() => {
    if (!enabled) {
      delete document.documentElement.dataset.customCursor;
      return;
    }
    document.documentElement.dataset.customCursor = "true";

    const dot = dotRef.current!;
    const ring = ringRef.current!;
    const dotX = gsap.quickTo(dot, "x", { duration: 0.08, ease: "power3.out" });
    const dotY = gsap.quickTo(dot, "y", { duration: 0.08, ease: "power3.out" });
    const ringX = gsap.quickTo(ring, "x", { duration: 0.28, ease: "power3.out" });
    const ringY = gsap.quickTo(ring, "y", { duration: 0.28, ease: "power3.out" });
    const trails = trailRefs.current.filter(Boolean) as HTMLDivElement[];
    const trailTo = trails.map((el, i) => ({
      x: gsap.quickTo(el, "x", { duration: 0.14 + i * 0.05, ease: "power2.out" }),
      y: gsap.quickTo(el, "y", { duration: 0.14 + i * 0.05, ease: "power2.out" }),
    }));

    const tick = () => {
      dotX(pointer.x);
      dotY(pointer.y);
      ringX(pointer.x);
      ringY(pointer.y);
      trailTo.forEach((t) => {
        t.x(pointer.x);
        t.y(pointer.y);
      });
      // Squash the dot in the direction of travel for a fluid feel.
      const speed = Math.min(Math.hypot(pointer.vx, pointer.vy) / 40, 1);
      const angle = Math.atan2(pointer.vy, pointer.vx) * (180 / Math.PI);
      gsap.set(dot, { rotate: angle, scaleX: 1 + speed * 0.9, scaleY: 1 - speed * 0.35 });
      pointer.vx *= 0.8;
      pointer.vy *= 0.8;
    };
    gsap.ticker.add(tick);

    const onOver = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      const labelled = el?.closest<HTMLElement>("[data-cursor]");
      if (labelled) {
        const l = labelled.dataset.cursor;
        setCursor(l === "hidden" ? "hidden" : "view", l && l !== "hidden" ? l : null);
        return;
      }
      if (el?.closest("a, button, [role='button'], input, textarea, select, label")) {
        setCursor("link");
        return;
      }
      setCursor("default");
    };
    const onLeave = () => setCursor("hidden");
    document.addEventListener("pointerover", onOver, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);

    return () => {
      gsap.ticker.remove(tick);
      document.removeEventListener("pointerover", onOver);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      delete document.documentElement.dataset.customCursor;
    };
  }, [enabled, setCursor]);

  if (!enabled) return null;

  const ringSize = variant === "view" ? 88 : variant === "link" ? 56 : variant === "drag" ? 72 : 36;
  const hidden = variant === "hidden";

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[100] mix-blend-normal">
      {Array.from({ length: TRAIL }, (_, i) => (
        <div
          key={i}
          ref={(el) => {
            trailRefs.current[i] = el;
          }}
          className="absolute left-0 top-0 rounded-full bg-[var(--season-a)]"
          style={{
            width: 10 - i,
            height: 10 - i,
            marginLeft: -(10 - i) / 2,
            marginTop: -(10 - i) / 2,
            opacity: hidden ? 0 : 0.45 - i * 0.06,
            transition: "opacity 0.3s",
          }}
        />
      ))}
      <motion.div
        ref={ringRef}
        className="absolute left-0 top-0 flex items-center justify-center rounded-full border-2 border-[var(--ink)]"
        animate={{
          width: ringSize,
          height: ringSize,
          marginLeft: -ringSize / 2,
          marginTop: -ringSize / 2,
          opacity: hidden ? 0 : 1,
          backgroundColor: variant === "view" ? "var(--ink)" : "rgba(0,0,0,0)",
          borderColor: variant === "link" ? "var(--season-a)" : "var(--ink)",
        }}
        transition={{ type: "spring", stiffness: 320, damping: 24 }}
      >
        <AnimatePresence>
          {variant === "view" && label && (
            <motion.span
              key={label}
              initial={{ opacity: 0, scale: 0.6, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.25, ease: EASE_CURVE.bounce }}
              className="font-display text-xs font-bold uppercase tracking-wider text-[var(--bg)]"
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
      <div
        ref={dotRef}
        className="absolute left-0 top-0 h-2.5 w-2.5 -ml-[5px] -mt-[5px] rounded-full bg-[var(--ink)]"
        style={{ opacity: hidden || variant === "view" ? 0 : 1, transition: "opacity 0.2s" }}
      />
    </div>
  );
}
