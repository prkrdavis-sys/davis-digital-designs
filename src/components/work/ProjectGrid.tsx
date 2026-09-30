"use client";

import { motion } from "motion/react";
import type { Project } from "@/lib/content";
import { springy } from "@/lib/motion";
import { ProjectCard } from "@/components/work/ProjectCard";
import { cn } from "@/lib/utils";

interface Props {
  projects: Project[];
}

const SIZE_CLASS: Record<Project["size"], string> = {
  sm: "md:col-span-2",
  md: "md:col-span-3",
  lg: "md:col-span-4",
};

/** Project cards in a layout that gives larger pieces more room. */
export function ProjectGrid({ projects }: Props) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-6">
      {projects.map((p, i) => (
        <motion.div
          key={p.slug}
          initial={{ opacity: 0, scale: 0.85, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ ...springy, delay: i * 0.03 }}
          className={cn(SIZE_CLASS[p.size])}
        >
          <ProjectCard project={p} />
        </motion.div>
      ))}
      {projects.length === 0 && (
        <p className="col-span-full py-20 text-center text-[var(--ink-mute)]">Nothing in this collection yet.</p>
      )}
    </div>
  );
}
