"use client";

import { useRef, type ReactNode } from "react";
import { motion } from "motion/react";
import { EASE_CURVE } from "@/lib/motion";

/**
 * Remounts on every navigation so each page gets a fresh entrance.
 * Inline transform/filter styles are cleared afterwards: a lingering transform
 * or filter on this wrapper would break position: fixed pinning inside pages.
 */
export default function Template({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: EASE_CURVE.out, delay: 0.1 }}
      onAnimationComplete={() => {
        if (ref.current) {
          ref.current.style.transform = "";
          ref.current.style.filter = "";
          ref.current.style.opacity = "";
        }
      }}
      className="flex min-h-full flex-1 flex-col"
    >
      {children}
    </motion.div>
  );
}
