/**
 * One shared motion language.
 * Three eases, four durations. Every animation on the site picks from here
 * so the whole thing feels like one continuous surface.
 */

export const EASE = {
  /** Default for anything entering or settling. */
  out: "power3.out",
  /** Symmetric moves: page wipes, layout shifts. */
  inOut: "power2.inOut",
  /** Playful overshoot for buttons and cards. */
  bounce: "back.out(1.7)",
} as const;

/** Same eases expressed for Motion (Framer) / CSS. */
export const EASE_CURVE = {
  out: [0.22, 1, 0.36, 1] as [number, number, number, number],
  inOut: [0.65, 0, 0.35, 1] as [number, number, number, number],
  bounce: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
};

export const DUR = {
  fast: 0.25,
  base: 0.5,
  slow: 0.9,
  epic: 1.6,
} as const;

export const STAGGER = {
  tight: 0.03,
  base: 0.08,
  loose: 0.15,
} as const;

/** Motion (Framer) variants used across pages. */
export const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: DUR.slow, ease: EASE_CURVE.out, delay: i * STAGGER.base },
  }),
};

export const popIn = {
  hidden: { opacity: 0, scale: 0.85 },
  show: (i = 0) => ({
    opacity: 1,
    scale: 1,
    transition: { duration: DUR.base, ease: EASE_CURVE.bounce, delay: i * STAGGER.base },
  }),
};

export const springy = { type: "spring", stiffness: 380, damping: 26, mass: 0.7 } as const;
export const springSoft = { type: "spring", stiffness: 160, damping: 22, mass: 1 } as const;
