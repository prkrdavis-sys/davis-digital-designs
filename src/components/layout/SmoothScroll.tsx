"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { scrollState, useUi } from "@/lib/store";

let lenisInstance: Lenis | null = null;

export function getLenis(): Lenis | null {
  return lenisInstance;
}

/** Lenis smooth scroll synced to GSAP's ticker so ScrollTrigger and 3D never jitter. */
export function SmoothScroll() {
  const pathname = usePathname();
  const reducedMotion = useUi((s) => s.reducedMotion);

  useEffect(() => {
    if (reducedMotion) return;

    const lenis = new Lenis({
      lerp: 0.09,
      wheelMultiplier: 0.9,
      smoothWheel: true,
    });
    lenisInstance = lenis;

    const onScroll = () => {
      scrollState.y = lenis.scroll;
      scrollState.progress = lenis.limit > 0 ? lenis.scroll / lenis.limit : 0;
      scrollState.velocity = lenis.velocity;
      ScrollTrigger.update();
    };
    lenis.on("scroll", onScroll);

    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
      lenisInstance = null;
    };
  }, [reducedMotion]);

  useEffect(() => {
    // Native fallback: keep scrollState updated even without Lenis.
    if (!reducedMotion) return;
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      scrollState.y = window.scrollY;
      scrollState.progress = max > 0 ? window.scrollY / max : 0;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [reducedMotion]);

  useEffect(() => {
    lenisInstance?.scrollTo(0, { immediate: true });
    window.scrollTo(0, 0);
    scrollState.y = 0;
    scrollState.progress = 0;
    // Layout changed: let ScrollTrigger re-measure after the new page paints.
    const id = window.setTimeout(() => ScrollTrigger.refresh(), 120);
    return () => window.clearTimeout(id);
  }, [pathname]);

  return null;
}
