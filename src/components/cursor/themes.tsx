"use client";

import type { CSSProperties, ReactElement } from "react";
import type { SceneId } from "@/worlds/types";
import { Particles, type EmitterSpec } from "@/components/cursor/Particles";
import { Ribbon, type RibbonSpec } from "@/components/cursor/Ribbon";
import { ChromeBall, Loupe, MetaballTrail, ScorePops, SpriteGlyph } from "@/components/cursor/Glyphs";
import { HelixTrail } from "@/components/cursor/HelixTrail";

export interface CursorTheme {
  Parts: () => ReactElement;
  /** The label pill shown over data-cursor="View" style elements. */
  label: CSSProperties;
  /** Show the elevation readout (Everest). */
  readout?: boolean;
}

// Specs live at module scope so particle systems are built once per theme.
// Glows are additive only at night; daytime uses saturated colors with normal
// blending so every trail reads on light pages.
const S = {
  gardenSpark: { sprite: "sparkle", max: 60, life: [0.4, 0.8], size: [6, 12], colors: ["#ff7eb6", "#7ea4ff", "#ffc94d"], nightColors: ["#ffffff", "#ffd6ec", "#cfe0ff"], additive: "night", burst: { count: 14, speed: [120, 300] }, drag: 3, spin: [-4, 4] } as EmitterSpec,
  doorSpark: { sprite: "sparkle", max: 140, perPx: 0.22, rate: 6, life: [0.5, 1], size: [5, 12], speed: [20, 70], colors: ["#8f6bff", "#ff6fa8", "#ffb84d", "#5e8bff"], nightColors: ["#b9a4ff", "#ff9cc2", "#ffe08f", "#9dbcff"], additive: "night", spin: [-3, 3], drag: 1.5, twinkle: 0.6 } as EmitterSpec,
  doorRing: { sprite: "ring", max: 6, life: [0.6, 0.7], size: [150, 170], sizeCurve: "grow", colors: ["#8f6bff"], nightColors: ["#d7c9ff"], additive: "night", burst: { count: 1, speed: [0, 0] } } as EmitterSpec,
  museumDust: { sprite: "soft", max: 160, rate: 14, perPx: 0.12, life: [1.2, 2.6], size: [2, 5], speed: [5, 22], gravity: [0, -8], sway: 12, twinkle: 0.7, spread: 50, colors: ["#c9973f", "#e0b35a", "#b8862f"], nightColors: ["#ffe2a8", "#ffd27a", "#fff3d6"], additive: "night", burst: { count: 30, speed: [40, 140] } } as EmitterSpec,
  bubbles: { sprite: "bubble", max: 60, rate: 1.2, perPx: 0.045, life: [2.4, 4], size: [14, 40], sizeCurve: "flat", speed: [8, 30], inherit: 0.12, gravity: [0, -26], drag: 0.6, sway: 18, colors: ["#9ec5ff", "#ffb3d9", "#a8e8c6", "#ffd98a", "#c9b6ff"], nightColors: ["#ffffff", "#ffe3f3", "#e3f0ff", "#fff6d8", "#e8ffef"], opacity: 0.95, burst: { count: 10, speed: [60, 170], size: [8, 20], life: [0.9, 1.5] } } as EmitterSpec,
  bubblePop: { sprite: "soft", max: 40, life: [0.25, 0.45], size: [3, 6], colors: ["#7fb0ff", "#ff9ccf"], nightColors: ["#ffffff", "#dff0ff"], additive: "night", burst: { count: 18, speed: [150, 320] }, drag: 4 } as EmitterSpec,
  lensDust: { sprite: "soft", max: 40, rate: 4, life: [1, 2], size: [2, 4], speed: [4, 14], spread: 60, twinkle: 0.8, colors: ["#c9a05a"], nightColors: ["#fff6de"], additive: "night" } as EmitterSpec,
  pollen: { sprite: "soft", max: 180, rate: 10, perPx: 0.18, life: [1, 2.2], size: [2, 5], speed: [5, 22], sway: 10, twinkle: 0.5, spread: 8, colors: ["#e8b923", "#f2c94c", "#d9a21b"], nightColors: ["#fff3a0", "#ffe27a", "#fffbe0"], additive: "night" } as EmitterSpec,
  petals: { sprite: "petal", max: 60, perPx: 0.028, life: [2, 3.6], size: [11, 19], sizeCurve: "flat", speed: [10, 40], gravity: [12, 60], drag: 0.9, sway: 34, spin: [-2.2, 2.2], colors: ["#ff9ec4", "#ff7aac", "#ffc2d9"], burst: { count: 16, speed: [120, 280] } } as EmitterSpec,
  leaves: { sprite: "leaf", max: 50, perPx: 0.022, life: [2.2, 3.8], size: [12, 20], sizeCurve: "flat", speed: [10, 40], gravity: [-10, 55], drag: 0.9, sway: 30, spin: [-1.8, 1.8], colors: ["#6fbf6a", "#4f9e5a", "#9ad48a"], burst: { count: 10, speed: [100, 240] } } as EmitterSpec,
  bleach: { sprite: "ring", max: 4, life: [0.7, 0.8], size: [130, 150], sizeCurve: "grow", colors: ["#10a866"], nightColors: ["#9dffcf"], additive: "night", burst: { count: 1, speed: [0, 0] } } as EmitterSpec,
  bleachDots: { sprite: "bead", max: 40, life: [0.4, 0.8], size: [4, 8], colors: ["#19d97a", "#ff3f8e", "#4d6bff"], nightColors: ["#6dffab", "#ff6fae", "#7f97ff"], additive: "night", burst: { count: 16, speed: [80, 220] }, drag: 3 } as EmitterSpec,
  pinSparks: { sprite: "sparkle", max: 60, life: [0.3, 0.6], size: [6, 13], colors: ["#ffb800", "#ff2e88", "#00b8e6"], nightColors: ["#ffe066", "#ff5c9d", "#3edcff", "#ffffff"], additive: "night", gravity: [0, 520], drag: 1, burst: { count: 16, speed: [220, 460] }, spin: [-6, 6] } as EmitterSpec,
  pinRing: { sprite: "ring", max: 4, life: [0.35, 0.45], size: [110, 120], sizeCurve: "grow", colors: ["#ff2e88"], nightColors: ["#ff5c9d"], additive: "night", burst: { count: 1, speed: [0, 0] } } as EmitterSpec,
  snow: { sprite: "soft", max: 160, rate: 6, perPx: 0.12, life: [1.8, 3], size: [3, 7], speed: [5, 20], gravity: [0, 32], sway: 16, spread: 10, colors: ["#8fbcf2", "#b7d5f7"], nightColors: ["#ffffff", "#eef6ff"], opacity: 0.95, burst: { count: 46, speed: [80, 260], life: [1.2, 2.2] }, drag: 1.2 } as EmitterSpec,
  crystals: { sprite: "crystal", max: 40, perPx: 0.03, life: [0.8, 1.5], size: [10, 22], sizeCurve: "bloom", spin: [-0.6, 0.6], colors: ["#5f9ae0", "#7fb0ea"], nightColors: ["#cfe9ff", "#e8f4ff", "#bcd8ff"], additive: "night" } as EmitterSpec,
  sand: { sprite: "grain", max: 320, rate: 18, perPx: 0.6, life: [0.8, 1.8], size: [2, 4.5], speed: [10, 40], inherit: -0.05, gravity: [95, 70], drag: 0.4, spread: 4, colors: ["#e0a94a", "#c98a2f", "#f2c46b", "#b8741f"], burst: { count: 60, speed: [60, 250] } } as EmitterSpec,
  flags: { sprite: "flag", max: 40, life: [0.9, 1.6], size: [12, 18], sizeCurve: "flat", colors: ["#2f6fe0", "#f3f3f3", "#e03a3a", "#2fa35a", "#f2c14e"], gravity: [30, 90], drag: 1, spin: [-3, 3], burst: { count: 14, speed: [80, 220] } } as EmitterSpec,
  confetti: { sprite: "paper", max: 40, life: [0.9, 1.6], size: [6, 10], sizeCurve: "flat", colors: ["#f2c8a6", "#ffab87", "#b9a4ff", "#9fb6e6"], nightColors: ["#fff4df", "#ffc3a8", "#d3c4ff", "#ffffff"], gravity: [0, 240], drag: 1.2, spin: [-8, 8], burst: { count: 18, speed: [100, 260] } } as EmitterSpec,
} as const;

const R = {
  pinStreak: { points: 16, maxAge: 0.16, width: [20, 1], colors: ["#3edcff", "#ff5c9d"], nightColors: ["#ffffff", "#3edcff"], mode: "streak", additive: "night", spacing: 2 } as RibbonSpec,
  prayerFlags: { points: 52, maxAge: 1.1, width: [11, 13], colors: ["#2f6fe0", "#f3f3f3", "#e03a3a", "#2fa35a", "#f2c14e"], mode: "flags", segments: 12, flutter: 3, spacing: 4, opacity: 0.95 } as RibbonSpec,
  contrail: { points: 64, maxAge: 1.6, width: [3, 1.5], colors: ["#8aa0c8", "#8aa0c8"], nightColors: ["#ffffff", "#ffffff"], mode: "dash", segments: 22, spacing: 4, opacity: 0.85 } as RibbonSpec,
  portal: { points: 28, maxAge: 0.5, width: [8, 0], colors: ["#8f6bff", "#ff6fa8", "#5e8bff"], nightColors: ["#b9a4ff", "#ff9cc2", "#9dbcff"], mode: "gradient", additive: "night", opacity: 0.6 } as RibbonSpec,
};

const pill = (bg: string, fg: string, border: string, extra: CSSProperties = {}): CSSProperties => ({
  background: bg,
  color: fg,
  border,
  borderRadius: 999,
  ...extra,
});

export const CURSOR_THEMES: Record<SceneId, CursorTheme> = {
  garden: {
    Parts: () => (
      <>
        <MetaballTrail tintA="#ffffff" tintB="#ffd3ec" />
        <Particles spec={S.gardenSpark} />
      </>
    ),
    label: pill("linear-gradient(135deg,#f7f8fb,#cdd2dc 45%,#ffffff 55%,#b3b9c6)", "#1b2a22", "1px solid rgba(255,255,255,0.9)", { boxShadow: "0 10px 30px -10px rgba(40,50,80,0.45)" }),
  },
  doors: {
    Parts: () => (
      <>
        <Ribbon spec={R.portal} />
        <Particles spec={S.doorSpark} />
        <Particles spec={S.doorRing} />
        <SpriteGlyph kind="soft" size={34} color="#ffcf6b" nightColor="#ffe6a8" additive="night" opacity={0.6} />
        <SpriteGlyph kind="portal" size={46} color="#7b5cff" nightColor="#c9b6ff" outline="#1b1240" rotate="spin" spinSpeed={2.4} additive="night" />
      </>
    ),
    label: pill("rgba(40,24,80,0.8)", "#f1e9ff", "1px solid rgba(201,182,255,0.8)", { backdropFilter: "blur(8px)", boxShadow: "0 0 24px rgba(185,164,255,0.55)" }),
  },
  museum: {
    Parts: () => (
      <>
        <SpriteGlyph kind="spot" size={240} color="#ffd88a" nightColor="#ffe6b8" additive="night" opacity={0.22} hoverScale={1.25} />
        <Particles spec={S.museumDust} />
        <SpriteGlyph kind="bead" size={11} color="#e0ad4f" nightColor="#ffd27a" outline="#3a2d1c" additive="night" />
      </>
    ),
    label: { background: "#f7f1e6", color: "#3a2d1c", border: "1px solid #c9a86a", borderRadius: 4, fontFamily: "Georgia, 'Times New Roman', serif", letterSpacing: "0.14em" },
  },
  bubbles: {
    Parts: () => (
      <>
        <Particles spec={S.bubbles} />
        <Particles spec={S.bubblePop} />
        <SpriteGlyph kind="ring" size={28} color="#6f93cc" nightColor="#ffffff" outline="#23324a" opacity={0.95} />
      </>
    ),
    label: { background: "#ffffff", color: "#1b2a22", border: "1px solid rgba(27,42,34,0.12)", borderRadius: "20px 20px 20px 4px", boxShadow: "0 12px 30px -12px rgba(80,60,120,0.4)" },
  },
  diorama: {
    Parts: () => (
      <>
        <Particles spec={S.lensDust} />
        <Loupe radius={66} zoom={2.4} />
      </>
    ),
    label: { background: "#2a2118", color: "#f3d9a0", border: "1px solid #b58b45", borderRadius: 999, letterSpacing: "0.1em" },
  },
  greenhouse: {
    Parts: () => (
      <>
        <Particles spec={S.pollen} />
        <Particles spec={S.leaves} />
        <Particles spec={S.petals} />
        <SpriteGlyph kind="soft" size={22} color="#f5c518" nightColor="#fff2a8" additive="night" opacity={0.7} />
        <SpriteGlyph kind="bead" size={10} color="#ffe36b" nightColor="#ffffff" outline="#5a4410" additive="night" />
      </>
    ),
    label: pill("#eaf5e1", "#214a2a", "1px solid #9fcf93"),
  },
  dna: {
    Parts: () => (
      <>
        <HelixTrail />
        <Particles spec={S.bleach} />
        <Particles spec={S.bleachDots} />
        <SpriteGlyph kind="reticle" size={46} color="#10a866" nightColor="#9dffcf" outline="#06261c" rotate="spin" spinSpeed={0.35} additive="night" />
      </>
    ),
    label: { background: "rgba(6,18,20,0.85)", color: "#7dffc0", border: "1px solid rgba(125,255,192,0.5)", borderRadius: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: "0.12em" },
  },
  pinball: {
    Parts: () => (
      <>
        <Ribbon spec={R.pinStreak} />
        <Particles spec={S.pinSparks} />
        <Particles spec={S.pinRing} />
        <ChromeBall radius={11} />
        <ScorePops />
      </>
    ),
    label: { background: "#140a24", color: "#ffe066", border: "2px solid #ff5c9d", borderRadius: 8, boxShadow: "0 0 18px rgba(255,92,157,0.7), inset 0 0 12px rgba(62,220,255,0.35)", letterSpacing: "0.12em" },
  },
  snowglobe: {
    Parts: () => (
      <>
        <Particles spec={S.snow} />
        <Particles spec={S.crystals} />
        <SpriteGlyph kind="snowflake" size={28} color="#5f9ae0" nightColor="#eef7ff" outline="#1d3552" rotate="spin" spinSpeed={0.8} />
      </>
    ),
    label: pill("rgba(235,245,255,0.78)", "#20324a", "1px solid rgba(255,255,255,0.95)", { backdropFilter: "blur(10px)" }),
  },
  dunes: {
    Parts: () => (
      <>
        <Particles spec={S.sand} />
        <SpriteGlyph kind="soft" size={26} color="#e39a2f" nightColor="#ffc76a" additive="night" opacity={0.7} />
        <SpriteGlyph kind="bead" size={9} color="#fff1cf" nightColor="#fff4d6" outline="#5a3b1a" additive="night" />
      </>
    ),
    label: { background: "#f4dcb0", color: "#5a3b1a", border: "1px solid #d9a45b", borderRadius: 6 },
  },
  everest: {
    Parts: () => (
      <>
        <Ribbon spec={R.prayerFlags} />
        <Particles spec={S.flags} />
        <SpriteGlyph kind="reticle" size={40} color="#0f1b2d" nightColor="#ffffff" />
        <SpriteGlyph kind="bead" size={9} color="#d9a520" nightColor="#f4c552" additive="night" />
      </>
    ),
    label: { background: "#0f1b2d", color: "#f4c552", border: "1px solid rgba(244,197,82,0.6)", borderRadius: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
    readout: true,
  },
  planes: {
    Parts: () => (
      <>
        <Ribbon spec={R.contrail} />
        <Particles spec={S.confetti} />
        <SpriteGlyph kind="plane" size={34} color="#ffffff" outline="#3b2f2a" rotate="velocity" squash={0.15} />
      </>
    ),
    label: { background: "#fff8ea", color: "#3b2f2a", border: "1px dashed #c9b79c", borderRadius: 4 },
  },
};
