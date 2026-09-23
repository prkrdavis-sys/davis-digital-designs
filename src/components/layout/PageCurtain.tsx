"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useUi } from "@/lib/store";
import { EASE_CURVE } from "@/lib/motion";
import { transitionOrigin } from "@/components/layout/TransitionLink";

const SHAPES = 14;

/**
 * The "season wipe": a circle of season gradient blooms from the click point,
 * a flurry of petals/leaves sweeps across, then it dissolves once the new page
 * has mounted.
 */
export function PageCurtain() {
  const transitioning = useUi((s) => s.transitioning);
  const setTransitioning = useUi((s) => s.setTransitioning);
  const pathname = usePathname();
  const lastPath = useRef(pathname);

  useEffect(() => {
    if (pathname !== lastPath.current) {
      lastPath.current = pathname;
      if (useUi.getState().transitioning) {
        // Give the new page one frame to paint under the curtain, then lift.
        const id = window.setTimeout(() => setTransitioning(false), 140);
        return () => window.clearTimeout(id);
      }
    }
  }, [pathname, setTransitioning]);

  // Safety valve: never leave the curtain stuck.
  useEffect(() => {
    if (!transitioning) return;
    const id = window.setTimeout(() => setTransitioning(false), 2600);
    return () => window.clearTimeout(id);
  }, [transitioning, setTransitioning]);

  const shapes = useMemo(
    () =>
      Array.from({ length: SHAPES }, (_, i) => ({
        id: i,
        x: (i / SHAPES) * 100 + (Math.sin(i * 7.3) * 6),
        delay: (i % 5) * 0.04,
        rot: Math.sin(i * 3.1) * 60,
        size: 26 + ((i * 37) % 40),
      })),
    [],
  );

  const origin = `${(transitionOrigin.x * 100).toFixed(1)}% ${(transitionOrigin.y * 100).toFixed(1)}%`;

  return (
    <AnimatePresence>
      {transitioning && (
        <motion.div
          key="curtain"
          className="pointer-events-none fixed inset-0 z-[90] overflow-hidden"
          initial={{ clipPath: `circle(0% at ${origin})` }}
          animate={{ clipPath: `circle(150% at ${origin})` }}
          exit={{ opacity: 0, transition: { duration: 0.45, ease: EASE_CURVE.inOut } }}
          transition={{ duration: 0.55, ease: EASE_CURVE.inOut }}
        >
          <div className="season-gradient absolute inset-0" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.35),transparent_60%)]" />
          {shapes.map((s) => (
            <motion.span
              key={s.id}
              className="absolute block rounded-[60%_40%_55%_45%/50%_60%_40%_50%] bg-white/70 shadow-lg"
              style={{ left: `${s.x}%`, width: s.size, height: s.size * 0.6 }}
              initial={{ top: "110%", rotate: s.rot, opacity: 0 }}
              animate={{ top: "-20%", rotate: s.rot + 180, opacity: [0, 1, 1, 0] }}
              transition={{ duration: 1.1, delay: s.delay + 0.1, ease: EASE_CURVE.out }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
