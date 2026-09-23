"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Project } from "@/lib/content";
import { useUi } from "@/lib/store";
import { ProjectCard } from "@/components/work/ProjectCard";
import { SplitHeading } from "@/components/ui/SplitHeading";
import { Button } from "@/components/ui/Button";

gsap.registerPlugin(ScrollTrigger);

interface Props {
  projects: Project[];
}

/**
 * Pinned horizontal reel: the section sticks while vertical scroll drives the
 * cards sideways. On touch devices it becomes a plain swipeable row.
 */
export function FeaturedReel({ projects }: Props) {
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const isTouch = useUi((s) => s.isTouch);
  const reducedMotion = useUi((s) => s.reducedMotion);
  const pinned = !isTouch && !reducedMotion;

  useEffect(() => {
    if (!pinned) return;
    const sec = section.current;
    const tr = track.current;
    if (!sec || !tr) return;

    const ctx = gsap.context(() => {
      const distance = () => tr.scrollWidth - window.innerWidth + 96;
      gsap.to(tr, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: {
          trigger: sec,
          start: "top top",
          end: () => `+=${distance()}`,
          pin: true,
          // Parents are flex containers, which turns pinSpacing off by default.
          pinSpacing: true,
          scrub: 0.6,
          invalidateOnRefresh: true,
          anticipatePin: 1,
        },
      });
      // Cards tilt slightly as they fly by.
      gsap.utils.toArray<HTMLElement>(tr.children).forEach((card, i) => {
        gsap.fromTo(
          card,
          { rotate: i % 2 ? 3 : -3, y: 40 },
          { rotate: 0, y: 0, ease: "none", scrollTrigger: { trigger: sec, start: "top top", end: () => `+=${distance()}`, scrub: 1 } },
        );
      });
    }, sec);

    return () => ctx.revert();
  }, [pinned, projects.length]);

  return (
    <section ref={section} className="relative overflow-hidden py-16 md:py-24">
      <div className="mx-auto mb-10 flex max-w-6xl flex-col gap-4 px-6 md:flex-row md:items-end md:justify-between md:px-12">
        <SplitHeading className="text-[clamp(2.2rem,5vw,4.5rem)] font-bold leading-[0.95] tracking-tight" split="words">
          Featured work
        </SplitHeading>
        <p className="max-w-sm text-[var(--ink-soft)]">Keep scrolling. The reel slides sideways while the sun moves on.</p>
      </div>

      <div
        ref={track}
        className={
          pinned
            ? "flex w-max gap-6 pl-6 pr-24 md:pl-12"
            : "flex snap-x snap-mandatory gap-5 overflow-x-auto px-6 pb-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        }
      >
        {projects.map((p, i) => (
          <ProjectCard key={p.slug} project={p} priority={i < 2} className="w-[82vw] shrink-0 snap-center md:w-[520px]" />
        ))}
        <div className="flex w-[70vw] shrink-0 snap-center flex-col items-start justify-center gap-6 rounded-[var(--radius-card)] p-8 md:w-[420px]">
          <p className="font-display text-3xl font-bold leading-tight tracking-tight md:text-4xl">
            That&rsquo;s the highlight reel. There&rsquo;s more behind every door.
          </p>
          <Button href="/sites" size="lg" variant="season">
            Browse everything
          </Button>
        </div>
      </div>
    </section>
  );
}
