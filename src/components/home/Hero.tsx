"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { motion } from "motion/react";
import { pointer, useUi } from "@/lib/store";
import { EASE_CURVE } from "@/lib/motion";
import { SplitHeading } from "@/components/ui/SplitHeading";
import { Button } from "@/components/ui/Button";

const ROLES = ["websites", "web apps", "games", "content", "templates"];

/**
 * Kinetic hero: letters bounce in, the headline leans with the cursor, and a
 * rotating word cycles through what the studio makes.
 */
export function Hero() {
  const wrap = useRef<HTMLDivElement>(null);
  const isTouch = useUi((s) => s.isTouch);
  const reducedMotion = useUi((s) => s.reducedMotion);

  useEffect(() => {
    const el = wrap.current;
    if (!el || isTouch || reducedMotion) return;
    const rx = gsap.quickTo(el, "rotateX", { duration: 0.8, ease: "power3.out" });
    const ry = gsap.quickTo(el, "rotateY", { duration: 0.8, ease: "power3.out" });
    const sk = gsap.quickTo(el, "skewX", { duration: 0.8, ease: "power3.out" });
    const tick = () => {
      rx(pointer.ny * -6);
      ry(pointer.nx * 8);
      sk(pointer.nx * -2);
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [isTouch, reducedMotion]);

  return (
    <section data-chapter="hero" className="relative flex min-h-[100svh] flex-col justify-center px-6 pb-24 pt-36 md:px-12">
      <div className="mx-auto w-full max-w-6xl [perspective:1200px]">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.8, ease: EASE_CURVE.out }}
          className="font-display mb-6 inline-flex items-center gap-3 rounded-full bg-[color-mix(in_oklab,var(--bg-elev)_70%,transparent)] px-4 py-2 text-sm font-bold tracking-tight backdrop-blur"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--leaf)] opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--leaf)]" />
          </span>
          Booking projects for this season
        </motion.p>

        <div ref={wrap} className="will-change-transform [transform-style:preserve-3d]">
          <h1 className="font-display text-[clamp(2.8rem,9vw,8.5rem)] font-black leading-[0.92] tracking-[-0.04em]">
            <SplitHeading as="span" immediate delay={0.3} className="block">
              Digital things
            </SplitHeading>
            <SplitHeading as="span" immediate delay={0.55} className="block">
              that make people
            </SplitHeading>
            <span className="block">
              <SplitHeading as="span" immediate delay={0.8} className="world-text">
                go &ldquo;ooh.&rdquo;
              </SplitHeading>
            </span>
          </h1>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.3, duration: 0.9, ease: EASE_CURVE.out }}
          className="mt-10 flex flex-col gap-8 md:flex-row md:items-end md:justify-between"
        >
          <p className="max-w-xl text-lg leading-relaxed text-[var(--ink-soft)] md:text-xl">
            I&rsquo;m Davis. I design and build <RotatingWord /> with professional bones and a playful heart. Scroll, and
            step through the worlds.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button href="/sites" size="lg">
              See the work
            </Button>
            <Button href="/contact" size="lg" variant="secondary">
              Say hello
            </Button>
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
        className="absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--ink-mute)]"
      >
        <span>Scroll</span>
        <span className="relative h-10 w-6 rounded-full border-2 border-current">
          <motion.span
            className="absolute left-1/2 top-1.5 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-current"
            animate={{ y: [0, 16, 0], opacity: [1, 0.2, 1] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
        </span>
      </motion.div>
    </section>
  );
}

function RotatingWord() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let i = 0;
    const id = window.setInterval(() => {
      i = (i + 1) % ROLES.length;
      gsap
        .timeline()
        .to(el, { yPercent: -100, opacity: 0, duration: 0.25, ease: "power2.in" })
        .set(el, { yPercent: 100, textContent: ROLES[i] })
        .to(el, { yPercent: 0, opacity: 1, duration: 0.45, ease: "back.out(1.8)" });
    }, 2200);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span className="inline-grid overflow-hidden align-bottom">
      <span ref={ref} className="font-display inline-block font-bold text-[var(--ink)]">
        {ROLES[0]}
      </span>
    </span>
  );
}
