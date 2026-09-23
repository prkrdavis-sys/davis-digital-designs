"use client";

import { motion } from "motion/react";
import { Reveal } from "@/components/ui/Reveal";
import { SplitHeading } from "@/components/ui/SplitHeading";

const SKILLS = [
  "Next.js", "React", "TypeScript", "Three.js", "GSAP", "Tailwind", "Supabase", "Figma", "Canva", "Premiere", "After Effects", "Game design", "Copywriting", "SEO", "Accessibility",
];

const VALUES = [
  { emoji: "🧭", title: "Clarity first", text: "Every animation earns its place by guiding attention, not stealing it." },
  { emoji: "🎈", title: "Joy is a feature", text: "People remember how a thing felt. I design for the smile." },
  { emoji: "🔧", title: "Built to be edited", text: "You get files and systems you can update yourself, with notes." },
  { emoji: "📈", title: "Measure, then polish", text: "Ship, watch the numbers, tune. Repeat until it sings." },
];

const TIMELINE = [
  { year: "Then", text: "Started with Canva templates for friends' small businesses. Discovered I liked the systems more than the one-offs." },
  { year: "Next", text: "Learned to code so the templates could become websites. The websites became apps. The apps got fun." },
  { year: "Now", text: "Davis Digital Designs: one studio, five doors. Sites, apps, games, content, and a shop full of templates." },
];

export function AboutStory() {
  return (
    <>
      <section className="px-6 py-16 md:px-12">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-6 md:grid-cols-4">
            {VALUES.map((v, i) => (
              <Reveal key={v.title} delay={i * 0.08}>
                <motion.div whileHover={{ y: -8, rotate: i % 2 ? 2 : -2 }} transition={{ type: "spring", stiffness: 300, damping: 18 }} className="card h-full p-6">
                  <span className="text-3xl">{v.emoji}</span>
                  <h3 className="font-display mt-4 text-xl font-bold">{v.title}</h3>
                  <p className="mt-2 text-[var(--ink-soft)]">{v.text}</p>
                </motion.div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="overflow-hidden py-10">
        <Reveal className="mx-auto mb-6 max-w-6xl px-6 md:px-12">
          <SplitHeading className="text-[clamp(2rem,4vw,3.5rem)] font-bold leading-[0.95] tracking-tight" split="words">
            Tools I reach for
          </SplitHeading>
        </Reveal>
        <div className="flex w-max gap-3 [animation:marquee_30s_linear_infinite] hover:[animation-play-state:paused]">
          {[...SKILLS, ...SKILLS].map((s, i) => (
            <span
              key={`${s}-${i}`}
              className="font-display wobble glass inline-flex h-14 items-center rounded-full px-6 text-lg font-bold tracking-tight"
              data-sfx
            >
              {s}
            </span>
          ))}
        </div>
      </section>

      <section className="px-6 py-20 md:px-12">
        <div className="mx-auto max-w-3xl">
          <ol className="relative space-y-10 border-l-2 border-[var(--line)] pl-8">
            {TIMELINE.map((t, i) => (
              <Reveal key={t.year} delay={i * 0.12}>
                <li className="relative">
                  <motion.span
                    className="season-gradient absolute -left-[41px] top-1 grid h-5 w-5 place-items-center rounded-full"
                    animate={{ scale: [1, 1.25, 1] }}
                    transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.4 }}
                  />
                  <span className="font-display text-sm font-bold uppercase tracking-widest text-[var(--ink-mute)]">{t.year}</span>
                  <p className="mt-2 text-lg leading-relaxed md:text-xl">{t.text}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
