"use client";

import { gsap } from "gsap";

const COLORS = ["var(--world-a)", "var(--world-b)", "var(--world-c)", "var(--petal)", "var(--sun)", "var(--sky)"];

/**
 * Spawns a burst of confetti-ish particles at (x, y) in viewport coordinates.
 * Pure DOM + GSAP so it works anywhere without a canvas.
 */
export function burstAt(x: number, y: number, count = 16) {
  if (typeof document === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const layer = document.createElement("div");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:95;overflow:hidden";
  document.body.appendChild(layer);

  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    const size = 6 + Math.random() * 10;
    const round = Math.random() > 0.5;
    p.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${round ? size : size * 0.55}px;border-radius:${round ? "50%" : "3px"};background:${COLORS[i % COLORS.length]};will-change:transform,opacity`;
    layer.appendChild(p);
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
    const dist = 60 + Math.random() * 110;
    gsap.fromTo(
      p,
      { x: 0, y: 0, scale: 0.4, rotate: 0, opacity: 1 },
      {
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist + 40,
        scale: 1,
        rotate: Math.random() * 540 - 270,
        opacity: 0,
        duration: 0.8 + Math.random() * 0.5,
        ease: "power3.out",
      },
    );
  }

  window.setTimeout(() => layer.remove(), 1500);
}
