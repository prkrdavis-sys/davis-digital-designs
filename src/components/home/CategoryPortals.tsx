"use client";

import { useRef, type MouseEvent } from "react";
import { gsap } from "gsap";
import { motion } from "motion/react";
import { CATEGORIES, SHOP, type Category } from "@/lib/categories";
import { WORLDS } from "@/lib/worlds";
import { useUi } from "@/lib/store";
import { EASE_CURVE } from "@/lib/motion";
import { TransitionLink } from "@/components/layout/TransitionLink";
import { SplitHeading } from "@/components/ui/SplitHeading";
import { Reveal } from "@/components/ui/Reveal";
import { cn } from "@/lib/utils";
import { homeState } from "@/components/three/engine/state";

type Portal = Pick<Category, "name" | "hook" | "world" | "emoji"> & { href: string; count?: number };

interface Props {
  counts: Record<string, number>;
}

/** Five oversized portal cards. Tilt in 3D, liquid-fill on hover, peek at the world behind the door. */
export function CategoryPortals({ counts }: Props) {
  const portals: Portal[] = [
    ...CATEGORIES.map((c) => ({ ...c, count: counts[c.slug] ?? 0 })),
    { ...SHOP, count: counts.shop ?? 0 },
  ];

  return (
    <section data-chapter="doors" className="relative px-6 py-24 md:px-12">
      <div className="mx-auto max-w-6xl">
        <Reveal className="mb-12 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <SplitHeading className="text-[clamp(2.2rem,5vw,4.5rem)] font-bold leading-[0.95] tracking-tight" split="words">
            Pick a door.
          </SplitHeading>
          <p className="max-w-sm text-[var(--ink-soft)]">
            Each one opens onto its own world. Sites grow in a greenhouse, apps live under the microscope, games bounce around a pinball machine, and stories settle inside a snow globe.
          </p>
        </Reveal>

        <div className="grid gap-5 md:grid-cols-6">
          {portals.map((p, i) => (
            <PortalCard key={p.href} portal={p} index={i} className={i < 2 ? "md:col-span-3" : "md:col-span-2"} />
          ))}
        </div>
      </div>
    </section>
  );
}

function PortalCard({ portal, index, className }: { portal: Portal; index: number; className?: string }) {
  const card = useRef<HTMLAnchorElement>(null);
  const blob = useRef<HTMLSpanElement>(null);
  const isTouch = useUi((s) => s.isTouch);
  const palette = WORLDS[portal.world].palette.day;

  const onMove = (e: MouseEvent<HTMLAnchorElement>) => {
    const el = card.current;
    if (!el || isTouch) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    gsap.to(el, { rotateY: (px - 0.5) * 16, rotateX: (0.5 - py) * 14, duration: 0.5, ease: "power3.out" });
    if (blob.current) gsap.to(blob.current, { left: `${px * 100}%`, top: `${py * 100}%`, duration: 0.5, ease: "power3.out" });
  };

  const onLeave = () => {
    if (card.current) gsap.to(card.current, { rotateY: 0, rotateX: 0, duration: 0.9, ease: "elastic.out(1, 0.5)" });
    if (homeState.hoveredDoor === portal.world) homeState.hoveredDoor = null;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 40, rotate: index % 2 ? 2 : -2 }}
      whileInView={{ opacity: 1, y: 0, rotate: 0 }}
      viewport={{ once: true, margin: "-10%" }}
      transition={{ duration: 0.8, ease: EASE_CURVE.out, delay: index * 0.08 }}
      className={cn("[perspective:1000px]", className)}
    >
      <TransitionLink
        ref={card}
        href={portal.href}
        transition="dive"
        onMouseMove={onMove}
        onMouseEnter={() => (homeState.hoveredDoor = portal.world)}
        onMouseLeave={onLeave}
        onClick={() => (homeState.enteredDoor = portal.world)}
        data-cursor="Enter"
        className="group relative block h-full min-h-[260px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--bg-elev)] p-7 shadow-[var(--shadow-soft)] transition-shadow duration-500 will-change-transform [transform-style:preserve-3d] hover:shadow-[var(--shadow-pop)]"
        data-door={portal.world}
        style={{ ["--world-a" as string]: palette[0], ["--world-b" as string]: palette[1], ["--world-c" as string]: palette[2] }}
      >
        {/* Liquid fill blob follows the cursor and swells on hover. */}
        <span
          ref={blob}
          aria-hidden
          className="world-gradient pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 blur-2xl transition-[opacity,transform] duration-700 ease-[var(--ease-out)] group-hover:scale-[9] group-hover:opacity-90"
        />
        {/* World peek: little drifting bits in the world's colors. */}
        <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {Array.from({ length: 7 }, (_, i) => (
            <motion.span
              key={i}
              className="absolute block rounded-[60%_40%_55%_45%/50%_60%_40%_50%] opacity-0 group-hover:opacity-80"
              style={{ left: `${10 + i * 12}%`, width: 10 + (i % 3) * 6, height: 8 + (i % 3) * 4, background: palette[i % palette.length] }}
              animate={{ y: ["-20%", "420%"], rotate: [0, 260], x: [0, (i % 2 ? 1 : -1) * 20, 0] }}
              transition={{ duration: 5 + i * 0.7, repeat: Infinity, ease: "linear", delay: i * 0.4 }}
            />
          ))}
        </span>

        <div className="relative flex h-full flex-col justify-between [transform:translateZ(30px)]">
          <div className="flex items-start justify-between">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[color-mix(in_oklab,var(--ink)_6%,transparent)] text-2xl transition-transform duration-500 group-hover:-rotate-12 group-hover:scale-110">
              {portal.emoji}
            </span>
            <span className="font-display rounded-full border border-[var(--line)] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[var(--ink-mute)]">
              {portal.count} {portal.count === 1 ? "piece" : "pieces"}
            </span>
          </div>
          <div>
            <h3 className="font-display text-4xl font-bold tracking-tight md:text-5xl">{portal.name}</h3>
            <p className="mt-2 text-[var(--ink-soft)]">{portal.hook}</p>
          </div>
          <span className="font-display absolute bottom-0 right-0 grid h-12 w-12 place-items-center rounded-full bg-[var(--ink)] text-[var(--bg)] transition-transform duration-500 ease-[var(--ease-bounce)] group-hover:rotate-[-45deg] group-hover:scale-110">
            →
          </span>
        </div>
      </TransitionLink>
    </motion.div>
  );
}
