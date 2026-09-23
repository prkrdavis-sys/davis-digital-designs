"use client";

import { motion } from "motion/react";
import type { Season } from "@/lib/seasons";

/**
 * Small DOM-level flourish per season, layered on top of the shared 3D world:
 * spring = drifting blossoms, summer = heat shimmer + sun flare, autumn = arcade
 * scanlines, winter = frost at the edges, golden = warm light leak.
 */
export function SeasonAmbience({ season }: { season: Season }) {
  switch (season) {
    case "spring":
      return (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[2] overflow-hidden">
          {Array.from({ length: 6 }, (_, i) => (
            <motion.span
              key={i}
              className="absolute text-3xl opacity-60"
              style={{ left: `${8 + i * 16}%` }}
              initial={{ y: "-10vh", rotate: 0 }}
              animate={{ y: "110vh", rotate: 360, x: [0, 30, -20, 0] }}
              transition={{ duration: 18 + i * 3, repeat: Infinity, ease: "linear", delay: i * 2 }}
            >
              🌸
            </motion.span>
          ))}
        </div>
      );
    case "summer":
      return (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[2] overflow-hidden">
          <svg className="absolute h-0 w-0">
            <filter id="heat">
              <feTurbulence type="fractalNoise" baseFrequency="0.008 0.03" numOctaves="2" seed="3">
                <animate attributeName="baseFrequency" dur="14s" values="0.008 0.03;0.012 0.02;0.008 0.03" repeatCount="indefinite" />
              </feTurbulence>
              <feDisplacementMap in="SourceGraphic" scale="6" />
            </filter>
          </svg>
          <motion.div
            className="absolute -right-32 -top-32 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(255,214,102,0.7),transparent_65%)]"
            animate={{ scale: [1, 1.12, 1], opacity: [0.7, 0.95, 0.7] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          />
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[rgba(255,236,170,0.18)] to-transparent" style={{ filter: "url(#heat)" }} />
        </div>
      );
    case "autumn":
      return (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[2] overflow-hidden">
          <div className="absolute inset-0 opacity-[0.07] [background:repeating-linear-gradient(0deg,transparent_0_3px,rgba(0,0,0,0.6)_3px_4px)]" />
          <motion.div
            className="absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-white/10 to-transparent"
            animate={{ top: ["-10%", "110%"] }}
            transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
          />
        </div>
      );
    case "winter":
      return (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[2]">
          <div className="absolute inset-0 shadow-[inset_0_0_140px_60px_rgba(255,255,255,0.35)]" />
          <div className="absolute inset-0 shadow-[inset_0_0_40px_10px_rgba(200,230,255,0.35)]" />
        </div>
      );
    case "golden":
      return (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[2] overflow-hidden">
          <motion.div
            className="absolute -left-40 top-1/4 h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(255,180,90,0.45),transparent_65%)]"
            animate={{ x: [0, 40, 0], y: [0, -30, 0] }}
            transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      );
    default: {
      const _exhaustive: never = season;
      return _exhaustive;
    }
  }
}
