"use client";

import Image from "next/image";
import { motion } from "motion/react";
import type { Project } from "@/lib/content";
import { getCategory } from "@/lib/categories";
import { TransitionLink } from "@/components/layout/TransitionLink";
import { cn } from "@/lib/utils";

interface Props {
  project: Project;
  className?: string;
  priority?: boolean;
}

/** Cover-led project card with a hover zoom, floating tags, and a cursor label. */
export function ProjectCard({ project, className, priority }: Props) {
  const category = getCategory(project.category);
  return (
    <motion.div layout className={cn("group relative", className)} whileHover={{ y: -6 }} transition={{ type: "spring", stiffness: 300, damping: 24 }}>
      <TransitionLink
        href={`/work/${project.slug}`}
        data-cursor="View"
        className="block overflow-hidden rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--bg-elev)] shadow-[var(--shadow-soft)] transition-shadow duration-500 group-hover:shadow-[var(--shadow-pop)]"
      >
        <div className="relative aspect-[16/10] overflow-hidden">
          <Image
            src={project.cover}
            alt={project.title}
            fill
            priority={priority}
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            className="object-cover transition-transform duration-700 ease-[var(--ease-out)] group-hover:scale-[1.06] group-hover:rotate-[0.6deg]"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            style={{ background: `linear-gradient(to top, ${project.accent}aa, transparent 60%)` }}
          />
          <div className="absolute left-4 top-4 flex flex-wrap gap-2">
            {project.tags.slice(0, 3).map((t, i) => (
              <span
                key={t}
                className="glass rounded-full px-3 py-1 text-xs font-bold tracking-tight opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100"
                style={{ transitionDelay: `${i * 60}ms`, transform: "translateY(-8px)" }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-start justify-between gap-4 p-5">
          <div>
            <p className="font-display mb-1 text-xs font-bold uppercase tracking-widest text-[var(--ink-mute)]">
              {category?.emoji} {category?.name} · {project.year}
            </p>
            <h3 className="font-display text-xl font-bold tracking-tight md:text-2xl">{project.title}</h3>
            <p className="mt-1 line-clamp-2 text-sm text-[var(--ink-soft)]">{project.tagline}</p>
          </div>
          <span className="font-display mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--line)] transition-all duration-500 ease-[var(--ease-bounce)] group-hover:rotate-[-45deg] group-hover:bg-[var(--ink)] group-hover:text-[var(--bg)]">
            →
          </span>
        </div>
      </TransitionLink>
    </motion.div>
  );
}
