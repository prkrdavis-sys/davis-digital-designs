"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import type { Project } from "@/lib/content";
import { springy } from "@/lib/motion";
import { sfx } from "@/lib/sfx";
import { ProjectCard } from "@/components/work/ProjectCard";
import { cn } from "@/lib/utils";

interface Props {
  projects: Project[];
  tags: string[];
}

const SIZE_CLASS: Record<Project["size"], string> = {
  sm: "md:col-span-2",
  md: "md:col-span-3",
  lg: "md:col-span-4",
};

/** Filter chips with an animated pill + a grid that reflows with layout animations. */
export function ProjectGrid({ projects, tags }: Props) {
  const [active, setActive] = useState<string | null>(null);

  const visible = useMemo(() => (active ? projects.filter((p) => p.tags.includes(active)) : projects), [projects, active]);

  const pick = (tag: string | null) => {
    setActive(tag);
    sfx.pop();
  };

  return (
    <LayoutGroup>
      <div className="mb-10 flex flex-wrap gap-2">
        <Chip active={active === null} onClick={() => pick(null)}>
          All
        </Chip>
        {tags.map((t) => (
          <Chip key={t} active={active === t} onClick={() => pick(active === t ? null : t)}>
            {t}
          </Chip>
        ))}
      </div>

      <motion.div layout className="grid grid-cols-1 gap-6 md:grid-cols-6">
        <AnimatePresence mode="popLayout">
          {visible.map((p, i) => (
            <motion.div
              key={p.slug}
              layout
              initial={{ opacity: 0, scale: 0.85, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: -20 }}
              transition={{ ...springy, delay: i * 0.03 }}
              className={cn(SIZE_CLASS[p.size])}
            >
              <ProjectCard project={p} />
            </motion.div>
          ))}
        </AnimatePresence>
        {visible.length === 0 && (
          <motion.p layout className="col-span-full py-20 text-center text-[var(--ink-mute)]">
            Nothing tagged like that yet. Try another chip.
          </motion.p>
        )}
      </motion.div>
    </LayoutGroup>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      data-sfx="silent"
      className={cn(
        "font-display relative h-10 rounded-full px-4 text-sm font-bold tracking-tight transition-colors",
        active ? "text-[var(--bg)]" : "border border-[var(--line)] bg-[var(--bg-elev)] text-[var(--ink)] hover:border-[var(--ink)]",
      )}
    >
      {active && <motion.span layoutId="chip-pill" className="absolute inset-0 -z-10 rounded-full bg-[var(--ink)]" transition={springy} />}
      <span className="relative">{children}</span>
    </button>
  );
}
