"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useUi } from "@/lib/store";
import { engine } from "@/components/three/engine/state";
import { EASE_CURVE } from "@/lib/motion";

const DISMISS_KEY = "ddd:perf-dismissed";
const LOW_FPS = 34;
/** Consecutive one-second samples under LOW_FPS before we ask. */
const SAMPLES = 6;

/**
 * Watches the frame rate of the live worlds. If a visible, focused tab keeps
 * dropping frames, offer Low Resources mode once per session.
 */
export function PerfPrompt() {
  const low = useUi((s) => s.lowResources);
  const reducedMotion = useUi((s) => s.reducedMotion);
  const contentHidden = useUi((s) => s.contentHidden);
  const setLow = useUi((s) => s.setLowResources);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (low || reducedMotion || window.sessionStorage.getItem(DISMISS_KEY)) return;
    let bad = 0;
    let warm = 0;
    const id = window.setInterval(() => {
      const watching = document.visibilityState === "visible" && document.hasFocus();
      const primary = engine.primaryScene;
      if (!watching || !primary || !engine.readyScenes.has(primary)) {
        bad = 0;
        warm = 0;
        return;
      }
      // Ignore the first seconds after a scene appears: shader compiles and uploads.
      if (warm++ < 4) return;
      bad = engine.fps < LOW_FPS ? bad + 1 : 0;
      if (bad >= SAMPLES) {
        setShow(true);
        window.clearInterval(id);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [low, reducedMotion]);

  const dismiss = () => {
    window.sessionStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  };

  return (
    <AnimatePresence>
      {show && !low && !contentHidden && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.4, ease: EASE_CURVE.out }}
          className="glass fixed bottom-6 left-1/2 z-[85] flex w-[min(92vw,520px)] -translate-x-1/2 flex-col gap-3 rounded-[24px] p-5 shadow-[var(--shadow-pop)] sm:flex-row sm:items-center"
        >
          <p className="text-sm leading-relaxed">
            <span className="font-display font-bold">Looking a little choppy?</span> Low Resources mode swaps in pre-rendered versions of each world. Same views, far lighter.
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => {
                setLow(true, "user");
                dismiss();
              }}
              className="font-display rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-bold text-[var(--bg)]"
            >
              Switch
            </button>
            <button onClick={dismiss} className="font-display rounded-full border border-[var(--line)] px-4 py-2 text-sm font-bold">
              Keep HD
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
