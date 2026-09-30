"use client";

import { useEffect, useId, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useUi } from "@/lib/store";
import { sfx } from "@/lib/sfx";
import { EASE_CURVE, springy } from "@/lib/motion";
import { SCENE_INFO } from "@/worlds/info";
import { Magnetic } from "@/components/fx/Magnetic";

function Switch({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <label htmlFor={id} className="font-display block text-sm font-bold">
          {label}
        </label>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--ink-mute)]">{hint}</p>
      </div>
      <button
        id={id}
        role="switch"
        aria-checked={on}
        data-sfx="silent"
        onClick={() => {
          onChange(!on);
          sfx.pop();
        }}
        className="relative mt-0.5 h-7 w-12 shrink-0 rounded-full border border-[var(--line)] transition-colors duration-300"
        style={{ background: on ? "var(--ink)" : "color-mix(in oklab, var(--ink) 10%, transparent)" }}
      >
        <motion.span
          className="absolute top-0.5 h-[22px] w-[22px] rounded-full bg-[var(--bg-elev)] shadow"
          animate={{ left: on ? 24 : 2 }}
          transition={springy}
        />
      </button>
    </div>
  );
}

/** Gear button + popover: quality, sound, theme, background-only, and the cursor easter egg reset. */
export function SettingsMenu() {
  const open = useUi((s) => s.settingsOpen);
  const setOpen = useUi((s) => s.setSettingsOpen);
  const low = useUi((s) => s.lowResources);
  const setLow = useUi((s) => s.setLowResources);
  const ambient = useUi((s) => s.ambient);
  const setAmbient = useUi((s) => s.setAmbient);
  const muted = useUi((s) => s.muted);
  const toggleMuted = useUi((s) => s.toggleMuted);
  const theme = useUi((s) => s.theme);
  const toggleTheme = useUi((s) => s.toggleTheme);
  const contentHidden = useUi((s) => s.contentHidden);
  const setContentHidden = useUi((s) => s.setContentHidden);
  const cursorOverride = useUi((s) => s.cursorOverride);
  const setCursorOverride = useUi((s) => s.setCursorOverride);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open, setOpen]);

  return (
    <div className="relative">
      <Magnetic strength={8}>
        <button
          ref={button}
          aria-label="Settings"
          aria-expanded={open}
          aria-haspopup="dialog"
          data-sfx="silent"
          onClick={() => {
            setOpen(!open);
            sfx.pop();
          }}
          className="grid h-10 w-10 place-items-center rounded-full border border-[var(--line)] bg-[var(--bg-elev)]"
        >
          <motion.svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" animate={{ rotate: open ? 90 : 0 }} transition={springy}>
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </motion.svg>
        </button>
      </Magnetic>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panel}
            role="dialog"
            aria-label="Settings"
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.25, ease: EASE_CURVE.out }}
            className="glass absolute right-0 top-12 z-[90] w-[min(88vw,340px)] origin-top-right rounded-[24px] p-5 shadow-[var(--shadow-pop)]"
          >
            <p className="font-display text-xs font-bold uppercase tracking-widest text-[var(--ink-mute)]">Settings</p>
            <div className="mt-1 divide-y divide-[var(--line)]">
              <Switch
                on={low}
                onChange={(v) => setLow(v, "user")}
                label="Low Resources mode"
                hint="Lighter 2.5D versions of every world, rendered in Blender ahead of time. Still pretty, much easier on batteries and older laptops."
              />
              <Switch on={ambient} onChange={setAmbient} label="Ambient sound" hint="A soft soundscape for each world: wind on Everest, pinball chimes, greenhouse birds." />
              <Switch on={!muted} onChange={() => toggleMuted()} label="Interface sounds" hint="Little pops and clicks when you hover and press." />
              <Switch on={theme === "dark"} onChange={() => toggleTheme()} label="Night mode" hint="Every world has a night version." />
              <Switch
                on={contentHidden}
                onChange={setContentHidden}
                label="Background only"
                hint="Scroll the worlds on their own. The page and footer step aside; the navbar and cursor stay."
              />
            </div>
            {cursorOverride && (
              <button
                onClick={() => setCursorOverride(null)}
                className="font-display mt-3 w-full rounded-full border border-[var(--line)] px-4 py-2 text-sm font-bold hover:bg-[var(--ink)] hover:text-[var(--bg)]"
              >
                Give back the {SCENE_INFO[cursorOverride].cursor} cursor
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
