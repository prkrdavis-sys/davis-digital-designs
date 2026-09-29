"use client";

import { motion } from "motion/react";
import { SplitHeading } from "@/components/ui/SplitHeading";
import { Reveal } from "@/components/ui/Reveal";
import { Button } from "@/components/ui/Button";

const PROCESS = [
  { step: "01", title: "Chat", text: "A 30 minute call. You talk, I sketch." },
  { step: "02", title: "Build", text: "Weekly previews you can click around in." },
  { step: "03", title: "Launch", text: "Ship it, then tune it with real numbers." },
];

/** Closing section: by now the sky is night and the fireflies are bright. */
export function CTA() {
  return (
    <section data-chapter="cta" className="relative px-6 py-32 md:px-12">
      <div className="mx-auto max-w-6xl">
        <Reveal className="mb-16 grid gap-6 md:grid-cols-3">
          {PROCESS.map((p, i) => (
            <motion.div
              key={p.step}
              whileHover={{ y: -8, rotate: i % 2 ? 1.5 : -1.5 }}
              transition={{ type: "spring", stiffness: 280, damping: 18 }}
              className="glass rounded-[var(--radius-card)] p-7"
            >
              <span className="font-display world-text text-5xl font-black">{p.step}</span>
              <h3 className="font-display mt-4 text-2xl font-bold">{p.title}</h3>
              <p className="mt-2 text-[var(--ink-soft)]">{p.text}</p>
            </motion.div>
          ))}
        </Reveal>

        <div className="text-center">
          <SplitHeading className="text-[clamp(2.6rem,7vw,7rem)] font-black leading-[0.92] tracking-[-0.04em]" split="words">
            Let&rsquo;s make something people remember.
          </SplitHeading>
          <Reveal delay={0.3} className="mt-10 flex flex-wrap justify-center gap-4">
            <Button href="/contact" size="lg" variant="world">
              Start a project
            </Button>
            <Button href="/shop" size="lg" variant="secondary">
              Browse templates
            </Button>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
