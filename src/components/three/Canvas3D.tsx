"use client";

import { Canvas } from "@react-three/fiber";
import { useActiveSeason, useUi } from "@/lib/store";
import { Scene } from "@/components/three/Scene";

/** The persistent WebGL canvas. Mounted once in the root layout. */
export default function Canvas3D() {
  const season = useActiveSeason();
  const isTouch = useUi((s) => s.isTouch);
  const quality = isTouch ? "low" : "high";

  return (
    <Canvas
      dpr={[1, quality === "high" ? 1.5 : 1]}
      camera={{ fov: 58, near: 0.1, far: 200, position: [0, 2.6, 0] }}
      gl={{ antialias: quality === "low", powerPreference: "high-performance", alpha: false, stencil: false }}
      style={{ position: "fixed", inset: 0, zIndex: 0 }}
      eventSource={typeof document !== "undefined" ? document.body : undefined}
      eventPrefix="client"
    >
      <Scene season={season} quality={quality} />
    </Canvas>
  );
}
