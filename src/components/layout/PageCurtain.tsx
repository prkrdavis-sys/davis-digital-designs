"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useUi } from "@/lib/store";
import { EASE_CURVE } from "@/lib/motion";
import { transitionOrigin } from "@/components/layout/TransitionLink";

/**
 * The route veil. Instead of hiding the screen, it dissolves the page content
 * (fade, blur, slight scale) while a soft bloom in the world's colors grows
 * from the click point, so the 3D world transition underneath stays the star.
 * The new page's template animates its content back in.
 */
export function PageCurtain() {
  const transitioning = useUi((s) => s.transitioning);
  const setTransitioning = useUi((s) => s.setTransitioning);
  const pathname = usePathname();
  const lastPath = useRef(pathname);

  useEffect(() => {
    const root = document.documentElement;
    if (transitioning) root.dataset.leaving = "true";
    else delete root.dataset.leaving;
  }, [transitioning]);

  useEffect(() => {
    if (pathname !== lastPath.current) {
      lastPath.current = pathname;
      if (useUi.getState().transitioning) {
        const id = window.setTimeout(() => setTransitioning(false), 60);
        return () => window.clearTimeout(id);
      }
    }
  }, [pathname, setTransitioning]);

  // Safety valve: never leave the page dissolved.
  useEffect(() => {
    if (!transitioning) return;
    const id = window.setTimeout(() => setTransitioning(false), 2600);
    return () => window.clearTimeout(id);
  }, [transitioning, setTransitioning]);

  const origin = `${(transitionOrigin.x * 100).toFixed(1)}% ${(transitionOrigin.y * 100).toFixed(1)}%`;

  return (
    <AnimatePresence>
      {transitioning && (
        <motion.div
          key="veil"
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[90] overflow-hidden mix-blend-soft-light"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.8, ease: EASE_CURVE.inOut } }}
          transition={{ duration: 0.35, ease: EASE_CURVE.out }}
        >
          <motion.div
            className="world-gradient absolute inset-0"
            style={{ transformOrigin: origin, clipPath: `circle(0% at ${origin})` }}
            animate={{ clipPath: `circle(140% at ${origin})` }}
            transition={{ duration: 0.7, ease: EASE_CURVE.inOut }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
