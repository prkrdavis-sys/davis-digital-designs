"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { motion } from "motion/react";
import { useUi } from "@/lib/store";
import { EASE_CURVE } from "@/lib/motion";
import { SplitHeading } from "@/components/ui/SplitHeading";
import { Button } from "@/components/ui/Button";
import { facetReadout } from "@/worlds/scenes/monolith/labels";

gsap.registerPlugin(ScrollTrigger);

/**
 * The homepage opening: a short line over the glass gallery.
 * Scroll lifts the type away as the monolith splits into the five doors.
 */
export function Hero() {
  const section = useRef<HTMLElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const labels = useRef<(HTMLSpanElement | null)[]>([]);
  const reducedMotion = useUi((s) => s.reducedMotion);

  useEffect(() => {
    const el = copy.current;
    const trigger = section.current;
    if (!el || !trigger || reducedMotion) return;
    const tween = gsap.to(el, {
      y: -64,
      opacity: 0,
      ease: "none",
      scrollTrigger: { trigger, start: "top top", end: "bottom bottom", scrub: 0.4 },
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [reducedMotion]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      facetReadout.forEach((item, i) => {
        const node = labels.current[i];
        if (!node) return;
        node.style.left = `${item.x * 100}%`;
        node.style.top = `${item.y * 100}%`;
        node.style.opacity = String(item.a);
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section ref={section} data-chapter="hero" className="relative h-[190dvh]">
      <div className="sticky top-0 flex min-h-[100dvh] flex-col justify-center px-6 md:px-12">
        <div ref={copy} className="mx-auto w-full max-w-6xl">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.8, ease: EASE_CURVE.out }}
            className="font-display mb-6 inline-flex items-center gap-3 rounded-full bg-[color-mix(in_oklab,var(--bg-elev)_70%,transparent)] px-4 py-2 text-sm font-bold tracking-tight backdrop-blur"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--leaf)] opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--leaf)]" />
            </span>
            Booking projects for this season
          </motion.p>

          <h1
            aria-label="Websites, apps, and games built to be remembered."
            className="font-display max-w-[14ch] text-[clamp(2.6rem,6.2vw,5.6rem)] font-bold leading-[0.96] tracking-[-0.035em] text-[var(--ink)]"
          >
            <SplitHeading as="span" calm immediate split="words" delay={0.15} className="block">
              Websites, apps, and games
            </SplitHeading>
            <SplitHeading as="span" calm immediate split="words" delay={0.32} className="block">
              built to be remembered.
            </SplitHeading>
          </h1>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.8, ease: EASE_CURVE.out }}
            className="mt-8 flex max-w-xl flex-col gap-8"
          >
            <p className="text-lg leading-relaxed text-[var(--ink-soft)] md:text-xl">
              Davis Digital Designs designs and builds the whole thing, from first sketch to launch.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button href="/sites" size="lg">
                See the work
              </Button>
              <Button href="/contact" size="lg" variant="secondary">
                Start a project
              </Button>
            </div>
          </motion.div>
        </div>

        <div aria-hidden className="pointer-events-none absolute inset-0">
          {facetReadout.map((item, i) => (
            <span
              key={item.label}
              ref={(node) => {
                labels.current[i] = node;
              }}
              className="font-display absolute text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--ink)]"
              style={{ opacity: 0, transform: "translate(-50%, -140%)" }}
            >
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
