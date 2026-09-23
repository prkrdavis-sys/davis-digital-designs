"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { EASE_CURVE } from "@/lib/motion";
import { SplitHeading } from "@/components/ui/SplitHeading";

interface Props {
  eyebrow?: string;
  title: string;
  blurb?: string;
  children?: ReactNode;
}

/** Shared page header: eyebrow pill, kinetic title, blurb, optional actions. */
export function PageHero({ eyebrow, title, blurb, children }: Props) {
  return (
    <header className="px-6 pb-12 pt-36 md:px-12 md:pt-44">
      <div className="mx-auto max-w-6xl">
        {eyebrow && (
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, ease: EASE_CURVE.out }}
            className="font-display mb-5 inline-block rounded-full bg-[color-mix(in_oklab,var(--bg-elev)_75%,transparent)] px-4 py-2 text-sm font-bold tracking-tight backdrop-blur"
          >
            {eyebrow}
          </motion.p>
        )}
        <SplitHeading as="h1" immediate delay={0.35} className="block text-[clamp(3rem,9vw,8rem)] font-black leading-[0.9] tracking-[-0.04em]">
          {title}
        </SplitHeading>
        {(blurb || children) && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.9, duration: 0.8, ease: EASE_CURVE.out }}
            className="mt-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between"
          >
            {blurb && <p className="max-w-xl text-lg leading-relaxed text-[var(--ink-soft)] md:text-xl">{blurb}</p>}
            {children}
          </motion.div>
        )}
      </div>
    </header>
  );
}
