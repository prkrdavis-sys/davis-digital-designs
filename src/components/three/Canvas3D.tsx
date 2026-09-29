"use client";

import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { useQuality } from "@/lib/store";
import { WorldDirector } from "@/components/three/engine/WorldDirector";
import { setAssetRenderer } from "@/components/three/engine/assets";

/** The persistent WebGL canvas. Mounted once in the root layout; worlds swap inside it. */
export default function Canvas3D() {
  const quality = useQuality();
  // HD mode starts sharp and steps the pixel ratio down if frames drop.
  const [hiDpr, setHiDpr] = useState(1.5);

  return (
    <Canvas
      flat
      dpr={quality === "hi" ? [1, hiDpr] : [1, 1]}
      gl={{ antialias: false, powerPreference: "high-performance", alpha: false, stencil: false, depth: true }}
      camera={{ fov: 40, near: 0.1, far: 1000, position: [0, 0, 5] }}
      style={{ position: "fixed", inset: 0, zIndex: 0 }}
      eventSource={typeof document !== "undefined" ? document.body : undefined}
      eventPrefix="client"
      onCreated={({ gl }) => {
        setAssetRenderer(gl);
        gl.setClearColor(0x000000, 1);
        // The director fades the canvas in once its first scene has compiled.
        gl.domElement.style.opacity = "0";
        gl.domElement.dataset.engine = "worlds";
      }}
    >
      <PerformanceMonitor
        flipflops={4}
        onDecline={() => setHiDpr((d) => Math.max(1, d - 0.25))}
        onIncline={() => setHiDpr((d) => Math.min(1.5, d + 0.25))}
      />
      <WorldDirector />
    </Canvas>
  );
}
