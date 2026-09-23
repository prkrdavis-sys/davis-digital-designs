"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { useUi } from "@/lib/store";
import { cn } from "@/lib/utils";

interface MagneticProps {
  children: ReactNode;
  /** How far the element chases the pointer, in px at the edge. */
  strength?: number;
  className?: string;
}

/**
 * Wraps anything and makes it lean toward the pointer while hovered, then
 * springs back. The inner content gets a smaller counter-move for parallax.
 */
export function Magnetic({ children, strength = 18, className }: MagneticProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isTouch = useUi((s) => s.isTouch);
  const reducedMotion = useUi((s) => s.reducedMotion);

  useEffect(() => {
    const el = ref.current;
    if (!el || isTouch || reducedMotion) return;
    const inner = el.firstElementChild as HTMLElement | null;

    const xTo = gsap.quickTo(el, "x", { duration: 0.6, ease: "elastic.out(1, 0.45)" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.6, ease: "elastic.out(1, 0.45)" });
    const ixTo = inner ? gsap.quickTo(inner, "x", { duration: 0.6, ease: "elastic.out(1, 0.45)" }) : null;
    const iyTo = inner ? gsap.quickTo(inner, "y", { duration: 0.6, ease: "elastic.out(1, 0.45)" }) : null;

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      xTo(dx * strength);
      yTo(dy * strength);
      ixTo?.(dx * strength * 0.4);
      iyTo?.(dy * strength * 0.4);
    };
    const onLeave = () => {
      xTo(0);
      yTo(0);
      ixTo?.(0);
      iyTo?.(0);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [strength, isTouch, reducedMotion]);

  return (
    <div ref={ref} className={cn("inline-block will-change-transform", className)}>
      {children}
    </div>
  );
}
