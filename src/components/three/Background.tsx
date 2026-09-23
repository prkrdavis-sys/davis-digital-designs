"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useUi } from "@/lib/store";

const Canvas3D = dynamic(() => import("@/components/three/Canvas3D"), { ssr: false });

function supportsWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * Chooses between the live 3D world and a calm CSS gradient fallback
 * (no WebGL, or the visitor prefers reduced motion).
 */
export function Background() {
  const reducedMotion = useUi((s) => s.reducedMotion);
  const [webgl, setWebgl] = useState<boolean | null>(null);

  useEffect(() => {
    setWebgl(supportsWebGL());
  }, []);

  const live = webgl === true && !reducedMotion;

  return (
    <>
      {/* Gradient sits underneath at all times: it is the loading skeleton and the fallback. */}
      <div
        aria-hidden
        className="season-gradient fixed inset-0 -z-10 transition-opacity duration-1000"
        style={{ opacity: live ? 0.35 : 1 }}
      />
      <div
        aria-hidden
        className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.55),transparent_60%)] dark:bg-none"
        style={{ opacity: live ? 0 : 1 }}
      />
      {live && <Canvas3D />}
      {/* Soft wash so text stays readable over the scene. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[1] bg-[linear-gradient(to_bottom,transparent_0%,color-mix(in_oklab,var(--bg)_55%,transparent)_100%)]"
      />
    </>
  );
}
