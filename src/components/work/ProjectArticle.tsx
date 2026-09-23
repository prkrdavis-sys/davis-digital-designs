"use client";

import { useRef, type ReactNode } from "react";
import Image from "next/image";
import { motion } from "motion/react";
import type { Project } from "@/lib/content";
import { getCategory } from "@/lib/categories";
import { EASE_CURVE } from "@/lib/motion";
import { RippleImage } from "@/components/fx/RippleImage";
import { Vine } from "@/components/fx/Vine";
import { Reveal } from "@/components/ui/Reveal";
import { SplitHeading } from "@/components/ui/SplitHeading";
import { Button } from "@/components/ui/Button";
import { TransitionLink } from "@/components/layout/TransitionLink";
import { ProjectCard } from "@/components/work/ProjectCard";

interface Props {
  project: Project;
  body: ReactNode;
  prev?: Project;
  next?: Project;
}

const STORY: Array<{ key: "problem" | "solution" | "result"; label: string; emoji: string }> = [
  { key: "problem", label: "The problem", emoji: "🌱" },
  { key: "solution", label: "What I built", emoji: "🌿" },
  { key: "result", label: "What happened", emoji: "🌳" },
];

export function ProjectArticle({ project, body, prev, next }: Props) {
  const article = useRef<HTMLElement>(null);
  const category = getCategory(project.category);

  return (
    <>
      <header className="px-6 pt-32 md:px-12 md:pt-40">
        <div className="mx-auto max-w-6xl">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="mb-6 flex flex-wrap items-center gap-3">
            {category && (
              <TransitionLink href={category.href} className="font-display glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold hover:bg-[var(--ink)] hover:text-[var(--bg)]">
                ← {category.emoji} {category.name}
              </TransitionLink>
            )}
            <span className="font-display text-sm font-bold text-[var(--ink-mute)]">
              {project.year}
              {project.client ? ` · ${project.client}` : ""}
            </span>
          </motion.div>
          <SplitHeading as="h1" immediate delay={0.3} className="block text-[clamp(2.6rem,7vw,6.5rem)] font-black leading-[0.92] tracking-[-0.04em]">
            {project.title}
          </SplitHeading>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.8, ease: EASE_CURVE.out }}
            className="mt-6 max-w-2xl text-xl leading-relaxed text-[var(--ink-soft)] md:text-2xl"
          >
            {project.tagline}
          </motion.p>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-8 flex flex-wrap items-center gap-3">
            {project.tags.map((t) => (
              <span key={t} className="rounded-full border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-1 text-sm font-bold">
                {t}
              </span>
            ))}
            {project.link && (
              <Button href={project.link} size="sm" variant="season" target="_blank" rel="noreferrer">
                {project.linkLabel ?? "Visit"} ↗
              </Button>
            )}
          </motion.div>
        </div>
      </header>

      <motion.section
        initial={{ opacity: 0, y: 40, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.5, duration: 1, ease: EASE_CURVE.out }}
        className="px-6 pt-12 md:px-12"
      >
        <div className="mx-auto max-w-6xl">
          <RippleImage src={project.cover} alt={project.title} priority className="aspect-[16/9] rounded-[var(--radius-card)] shadow-[var(--shadow-pop)]" />
          <p className="mt-3 text-center text-xs text-[var(--ink-mute)]">Move your cursor over the image. It&rsquo;s water.</p>
        </div>
      </motion.section>

      <article ref={article} className="relative px-6 py-20 md:px-12">
        <Vine target={article} />
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-6 md:grid-cols-3">
            {STORY.map((s, i) =>
              project[s.key] ? (
                <Reveal key={s.key} delay={i * 0.1}>
                  <motion.div whileHover={{ y: -6, rotate: i % 2 ? 1 : -1 }} className="card h-full p-7">
                    <span className="text-3xl">{s.emoji}</span>
                    <h2 className="font-display mt-4 text-xl font-bold">{s.label}</h2>
                    <p className="mt-2 leading-relaxed text-[var(--ink-soft)]">{project[s.key]}</p>
                  </motion.div>
                </Reveal>
              ) : null,
            )}
          </div>

          <div className="mx-auto mt-16 max-w-3xl">
            <Reveal>
              <div className="prose-ddd">{body}</div>
            </Reveal>
          </div>

          {project.gallery.length > 0 && (
            <div className="mt-16 grid gap-6 md:grid-cols-2">
              {project.gallery.map((src, i) => (
                <Reveal key={src} delay={i * 0.08}>
                  <div className="relative aspect-[4/3] overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow-soft)]">
                    <Image src={src} alt={`${project.title} ${i + 1}`} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover transition-transform duration-700 hover:scale-105" />
                  </div>
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </article>

      <section className="px-6 pb-12 md:px-12">
        <div className="mx-auto max-w-6xl">
          <Reveal className="mb-8 flex items-end justify-between gap-4">
            <SplitHeading className="text-[clamp(2rem,4vw,3.5rem)] font-bold leading-[0.95] tracking-tight" split="words">
              Keep exploring
            </SplitHeading>
            <Button href="/contact" variant="season" size="sm">
              Build this look for me
            </Button>
          </Reveal>
          <div className="grid gap-6 md:grid-cols-2">
            {prev && prev.slug !== project.slug && <ProjectCard project={prev} />}
            {next && next.slug !== project.slug && next.slug !== prev?.slug && <ProjectCard project={next} />}
          </div>
        </div>
      </section>
    </>
  );
}
