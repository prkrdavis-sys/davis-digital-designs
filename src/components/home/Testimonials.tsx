"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { TESTIMONIALS } from "@/lib/testimonials";
import { EASE_CURVE, springy } from "@/lib/motion";
import { SplitHeading } from "@/components/ui/SplitHeading";
import { Reveal } from "@/components/ui/Reveal";
import { sfx } from "@/lib/sfx";

/** Auto-rotating quote carousel with swipe-to-change and bouncy dots. */
export function Testimonials() {
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setDir(1);
      setIndex((i) => (i + 1) % TESTIMONIALS.length);
    }, 5200);
    return () => window.clearInterval(id);
  }, [paused]);

  const go = (next: number) => {
    setDir(next > index ? 1 : -1);
    setIndex((next + TESTIMONIALS.length) % TESTIMONIALS.length);
    sfx.pop();
  };

  const t = TESTIMONIALS[index];

  return (
    <section data-chapter="voices" className="relative px-6 py-24 md:px-12">
      <div className="mx-auto max-w-5xl">
        <Reveal className="mb-10 text-center">
          <SplitHeading className="text-[clamp(2rem,4.5vw,4rem)] font-bold leading-[0.95] tracking-tight" split="words">
            Kind words from kind people
          </SplitHeading>
        </Reveal>

        <div
          className="card relative overflow-hidden p-8 md:p-14"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          data-cursor="Drag"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full blur-3xl transition-colors duration-1000"
            style={{ background: t.accent, opacity: 0.35 }}
          />
          <span className="font-display absolute left-6 top-4 text-[8rem] leading-none text-[var(--line)]">&ldquo;</span>

          <div className="relative min-h-[220px]">
            <AnimatePresence mode="wait" custom={dir}>
              <motion.figure
                key={index}
                custom={dir}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.4}
                onDragEnd={(_, info) => {
                  if (info.offset.x < -80) go(index + 1);
                  else if (info.offset.x > 80) go(index - 1);
                }}
                initial={{ opacity: 0, x: dir * 60, rotate: dir * 2 }}
                animate={{ opacity: 1, x: 0, rotate: 0 }}
                exit={{ opacity: 0, x: dir * -60, rotate: dir * -2 }}
                transition={{ duration: 0.5, ease: EASE_CURVE.out }}
                className="cursor-grab active:cursor-grabbing"
              >
                <blockquote className="font-display text-2xl font-semibold leading-snug tracking-tight md:text-4xl">{t.quote}</blockquote>
                <figcaption className="mt-8 flex items-center gap-4">
                  <span className="grid h-12 w-12 place-items-center rounded-full font-display text-lg font-bold text-[#1b2a22]" style={{ background: t.accent }}>
                    {t.name.charAt(0)}
                  </span>
                  <span>
                    <span className="block font-bold">{t.name}</span>
                    <span className="block text-sm text-[var(--ink-mute)]">{t.role}</span>
                  </span>
                </figcaption>
              </motion.figure>
            </AnimatePresence>
          </div>

          <div className="mt-10 flex items-center justify-between">
            <div className="flex gap-2">
              {TESTIMONIALS.map((_, i) => (
                <button
                  key={i}
                  aria-label={`Show testimonial ${i + 1}`}
                  onClick={() => go(i)}
                  className="relative h-3 rounded-full"
                  data-sfx="silent"
                >
                  <motion.span
                    className="block h-3 rounded-full bg-[var(--ink)]"
                    animate={{ width: i === index ? 36 : 12, opacity: i === index ? 1 : 0.3 }}
                    transition={springy}
                  />
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => go(index - 1)} aria-label="Previous" className="grid h-11 w-11 place-items-center rounded-full border border-[var(--line)] transition-transform hover:-translate-x-0.5 hover:bg-[var(--ink)] hover:text-[var(--bg)]">
                ←
              </button>
              <button onClick={() => go(index + 1)} aria-label="Next" className="grid h-11 w-11 place-items-center rounded-full border border-[var(--line)] transition-transform hover:translate-x-0.5 hover:bg-[var(--ink)] hover:text-[var(--bg)]">
                →
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
