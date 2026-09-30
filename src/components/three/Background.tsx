"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useUi } from "@/lib/store";
import { PosterBackdrop } from "@/components/three/PosterBackdrop";

const Canvas3D = dynamic(() => import("@/components/three/Canvas3D"), { ssr: false });

function supportsWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2"));
  } catch {
    return false;
  }
}

/**
 * The world behind every page, bottom to top: a gradient in the world's colors
 * (instant skeleton), Cycles poster stills for the current chapter (loading
 * state and the reduced-motion / no-WebGL experience), then the live canvas,
 * which fades in once its scene has compiled.
 */
export function Background() {
  const reducedMotion = useUi((s) => s.reducedMotion);
  const [webgl, setWebgl] = useState<boolean | null>(null);

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setWebgl(supportsWebGL()));
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const live = webgl === true && !reducedMotion;

  return (
    <>
      <div aria-hidden className="world-gradient fixed inset-0 -z-10 opacity-60 dark:opacity-25" />
      {webgl !== null && <PosterBackdrop live={live} />}
      {live && <Canvas3D />}
      {/* Legibility: worlds frame their subject right of centre, so a soft scrim sits behind the left text column; narrow screens get an even veil instead. */}
      <div
        aria-hidden
        className="content-scrim pointer-events-none fixed inset-0 z-[1] bg-[color-mix(in_oklab,var(--bg)_24%,transparent)] md:bg-[linear-gradient(90deg,color-mix(in_oklab,var(--bg)_40%,transparent)_0%,color-mix(in_oklab,var(--bg)_16%,transparent)_36%,transparent_58%)]"
      />
      <div
        aria-hidden
        className="content-scrim pointer-events-none fixed inset-0 z-[1] bg-[linear-gradient(to_bottom,transparent_60%,color-mix(in_oklab,var(--bg)_35%,transparent)_100%)]"
      />
    </>
  );
}
