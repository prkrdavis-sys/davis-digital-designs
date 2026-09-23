"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";
import { EASE_CURVE, DUR } from "@/lib/motion";

interface RevealProps extends HTMLMotionProps<"div"> {
  children: ReactNode;
  delay?: number;
  /** Distance to travel in px. */
  y?: number;
  once?: boolean;
}

/** Fade-and-rise into view when scrolled to. */
export function Reveal({ children, delay = 0, y = 32, once = true, ...rest }: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y, filter: "blur(4px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once, margin: "-10% 0px -10% 0px" }}
      transition={{ duration: DUR.slow, ease: EASE_CURVE.out, delay }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
