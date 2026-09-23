"use client";

import { useEffect, useRef, type Ref } from "react";
import { gsap } from "gsap";
import { SplitText } from "gsap/SplitText";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";

gsap.registerPlugin(SplitText, ScrollTrigger);

interface Props {
  children: string;
  as?: "h1" | "h2" | "h3" | "h4" | "p" | "span" | "div";
  className?: string;
  /** Animate immediately instead of waiting to scroll into view. */
  immediate?: boolean;
  delay?: number;
  split?: "chars" | "words";
}

/**
 * Splits text and staggers it in with a bouncy rise + slight rotation.
 * Words get a data attribute so parents can lean them with the cursor.
 */
export function SplitHeading({ children, as = "h2", className, immediate, delay = 0, split = "chars" }: Props) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const splitter = SplitText.create(el, {
      type: "words,chars",
      wordsClass: "split-word",
      charsClass: "split-char",
      mask: split === "chars" ? "chars" : "words",
    });
    const targets = split === "chars" ? splitter.chars : splitter.words;
    // background-clip:text does not reach into split children, so re-apply the
    // gradient class on each piece when the heading uses season-text.
    if (el.classList.contains("season-text")) {
      targets.forEach((t) => t.classList.add("season-text"));
    }

    const tween = gsap.from(targets, {
      yPercent: 110,
      rotate: () => gsap.utils.random(-12, 12),
      opacity: 0,
      duration: 0.9,
      ease: EASE.bounce,
      stagger: { each: split === "chars" ? 0.022 : 0.08, from: "start" },
      delay,
      paused: !immediate,
      scrollTrigger: immediate
        ? undefined
        : { trigger: el, start: "top 85%", once: true },
    });

    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
      splitter.revert();
    };
  }, [children, immediate, delay, split]);

  // Cast keeps JSX happy with a dynamic tag; the real element is whatever `as` says.
  const Tag = as as "div";
  return (
    <Tag ref={ref as Ref<HTMLDivElement>} className={cn("font-display inline-block", className)}>
      {children}
    </Tag>
  );
}
