"use client";

import { useEffect } from "react";
import { AnimatePresence } from "motion/react";
import { useUi } from "@/lib/store";
import { sfx } from "@/lib/sfx";
import { FireflyGame } from "@/components/easter/FireflyGame";

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

/**
 * Hidden things.
 * 1. Konami code (↑ ↑ ↓ ↓ ← → ← → B A) opens the firefly-catching mini game.
 * 2. Clicking the logo five times shuffles the season (lives in Nav).
 */
export function EasterEggs() {
  const gameOpen = useUi((s) => s.gameOpen);
  const setGameOpen = useUi((s) => s.setGameOpen);

  useEffect(() => {
    let progress = 0;
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === KONAMI[progress]) {
        progress += 1;
        if (progress === KONAMI.length) {
          progress = 0;
          sfx.success();
          setGameOpen(true);
        }
      } else {
        progress = key === KONAMI[0] ? 1 : 0;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setGameOpen]);

  return <AnimatePresence>{gameOpen && <FireflyGame key="game" onClose={() => setGameOpen(false)} />}</AnimatePresence>;
}
