"use client";

import { useEffect, useRef, type RefObject } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useUi } from "@/lib/store";

gsap.registerPlugin(ScrollTrigger);

const PATH =
  "M 40 0 C 10 80, 70 140, 40 220 S 10 360, 40 440 S 70 580, 40 660 S 10 800, 40 880 S 70 1020, 40 1100 S 10 1240, 40 1320 S 70 1460, 40 1540";

const LEAVES = [120, 300, 480, 660, 840, 1020, 1200, 1380];

interface Props {
  /** The scrolling article the vine should grow alongside. */
  target: RefObject<HTMLElement | null>;
}

/**
 * A vine that draws itself down the left edge as you read; leaves unfurl as
 * the stroke passes them. Uses stroke-dashoffset scrubbed by ScrollTrigger.
 */
export function Vine({ target }: Props) {
  const path = useRef<SVGPathElement>(null);
  const leaves = useRef<SVGGElement>(null);
  const reducedMotion = useUi((s) => s.reducedMotion);

  useEffect(() => {
    const p = path.current;
    const el = target.current;
    if (!p || !el || reducedMotion) return;
    const length = p.getTotalLength();
    gsap.set(p, { strokeDasharray: length, strokeDashoffset: length });
    const leafEls = leaves.current ? Array.from(leaves.current.children) : [];
    gsap.set(leafEls, { scale: 0, transformOrigin: "0% 50%" });

    const ctx = gsap.context(() => {
      gsap.to(p, {
        strokeDashoffset: 0,
        ease: "none",
        scrollTrigger: { trigger: el, start: "top 60%", end: "bottom 80%", scrub: 0.4 },
      });
      leafEls.forEach((leaf, i) => {
        gsap.to(leaf, {
          scale: 1,
          ease: "back.out(2)",
          duration: 0.5,
          scrollTrigger: { trigger: el, start: `${(i / LEAVES.length) * 100}% 60%`, toggleActions: "play none none reverse" },
        });
      });
    });
    return () => ctx.revert();
  }, [target, reducedMotion]);

  if (reducedMotion) return null;

  return (
    <svg
      aria-hidden
      viewBox="0 0 80 1540"
      className="pointer-events-none absolute left-2 top-0 hidden h-full w-16 lg:block"
      preserveAspectRatio="none"
    >
      <path ref={path} d={PATH} fill="none" stroke="var(--leaf)" strokeWidth="3" strokeLinecap="round" />
      <g ref={leaves} fill="var(--world-a)">
        {LEAVES.map((y, i) => (
          <path
            key={y}
            transform={`translate(40 ${y}) ${i % 2 ? "scale(-1 1)" : ""}`}
            d="M 0 0 C 10 -14, 30 -14, 34 0 C 30 12, 10 12, 0 0 Z"
          />
        ))}
      </g>
    </svg>
  );
}
