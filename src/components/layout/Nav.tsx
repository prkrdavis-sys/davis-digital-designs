"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { CATEGORIES, SHOP } from "@/lib/categories";
import { nextSeason, SEASON_THEMES } from "@/lib/seasons";
import { useActiveSeason, useUi } from "@/lib/store";
import { sfx } from "@/lib/sfx";
import { EASE_CURVE, springy } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { TransitionLink } from "@/components/layout/TransitionLink";
import { Magnetic } from "@/components/fx/Magnetic";
import { Button } from "@/components/ui/Button";
import { burstAt } from "@/components/fx/ParticleBurst";

const LINKS = [...CATEGORIES.map((c) => ({ href: c.href, label: c.name })), { href: SHOP.href, label: SHOP.name }, { href: "/about", label: "About" }];

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    const raf = window.requestAnimationFrame(onScroll);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(id);
  }, [toast]);

  return (
    <>
      <motion.header
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: EASE_CURVE.out, delay: 0.2 }}
        className="fixed inset-x-0 top-0 z-[80] flex justify-center px-4 pt-4"
      >
        <nav
          className={cn(
            "flex w-full max-w-6xl items-center justify-between gap-3 rounded-full px-3 py-2 transition-all duration-500",
            scrolled ? "glass shadow-[var(--shadow-soft)]" : "bg-transparent",
          )}
        >
          <Logo onShuffle={(msg) => setToast(msg)} />

          <ul className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => {
              const active = pathname === l.href || pathname.startsWith(l.href + "/");
              return (
                <li key={l.href}>
                  <Magnetic strength={8}>
                    <TransitionLink
                      href={l.href}
                      className={cn(
                        "relative inline-flex h-10 items-center rounded-full px-4 font-display text-sm font-bold tracking-tight transition-colors",
                        active ? "text-[var(--bg)]" : "text-[var(--ink)] hover:text-[var(--ink)]",
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="nav-pill"
                          className="absolute inset-0 -z-10 rounded-full bg-[var(--ink)]"
                          transition={springy}
                        />
                      )}
                      <span className="relative">{l.label}</span>
                    </TransitionLink>
                  </Magnetic>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center gap-1.5">
            <MuteToggle />
            <ThemeToggle />
            <span className="hidden sm:inline-flex">
              <Button href="/contact" size="sm" variant="season" quiet>
                Hire me
              </Button>
            </span>
            <button
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="relative grid h-10 w-10 place-items-center rounded-full border border-[var(--line)] bg-[var(--bg-elev)] md:hidden"
            >
              <motion.span animate={open ? { rotate: 45, y: 0 } : { rotate: 0, y: -4 }} className="absolute h-0.5 w-4 rounded bg-[var(--ink)]" />
              <motion.span animate={open ? { rotate: -45, y: 0 } : { rotate: 0, y: 4 }} className="absolute h-0.5 w-4 rounded bg-[var(--ink)]" />
            </button>
          </div>
        </nav>
      </motion.header>

      <AnimatePresence>
        {open && (
          <motion.div
            key="menu"
            initial={{ clipPath: "circle(0% at 92% 6%)" }}
            animate={{ clipPath: "circle(150% at 92% 6%)" }}
            exit={{ clipPath: "circle(0% at 92% 6%)" }}
            transition={{ duration: 0.6, ease: EASE_CURVE.inOut }}
            className="season-gradient fixed inset-0 z-[70] flex flex-col justify-center px-8 md:hidden"
          >
            <ul className="space-y-2">
              {[...LINKS, { href: "/contact", label: "Contact" }].map((l, i) => (
                <motion.li
                  key={l.href}
                  initial={{ opacity: 0, x: -30 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + i * 0.06, ease: EASE_CURVE.out }}
                >
                  <TransitionLink href={l.href} onClick={() => setOpen(false)} className="font-display block text-5xl font-bold tracking-tight text-[#1b2a22]">
                    {l.label}
                  </TransitionLink>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast}
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            className="glass fixed bottom-6 left-1/2 z-[85] -translate-x-1/2 rounded-full px-5 py-2 font-display text-sm font-bold"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Logo. Click it five times fast and the seasons shuffle (easter egg). */
function Logo({ onShuffle }: { onShuffle: (msg: string) => void }) {
  const clicks = useRef<number[]>([]);
  const season = useActiveSeason();
  const setSeasonOverride = useUi((s) => s.setSeasonOverride);

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    const now = performance.now();
    clicks.current = [...clicks.current.filter((t) => now - t < 1600), now];
    if (clicks.current.length >= 5) {
      e.preventDefault();
      clicks.current = [];
      const next = nextSeason(season);
      setSeasonOverride(next);
      burstAt(e.clientX, e.clientY, 28);
      sfx.success();
      onShuffle(`${SEASON_THEMES[next].label} mode: ${SEASON_THEMES[next].tagline}`);
    }
  };

  return (
    <Magnetic strength={10}>
      <TransitionLink href="/" onClick={onClick} className="group flex items-center gap-2 rounded-full pl-1 pr-3" data-sfx="silent" aria-label="Davis Digital Designs home">
        <span className="relative grid h-9 w-9 place-items-center">
          <motion.span
            className="season-gradient absolute inset-0 rounded-[40%_60%_55%_45%/55%_45%_55%_45%]"
            animate={{ rotate: 360 }}
            transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
          />
          <span className="font-display relative text-sm font-black text-[#1b2a22]">D</span>
        </span>
        <span className="font-display hidden text-base font-bold tracking-tight sm:block">
          Davis <span className="text-[var(--ink-soft)]">Digital</span> Designs
        </span>
      </TransitionLink>
    </Magnetic>
  );
}

function ThemeToggle() {
  const theme = useUi((s) => s.theme);
  const toggleTheme = useUi((s) => s.toggleTheme);
  const isDark = theme === "dark";

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
    const x = e.clientX;
    const y = e.clientY;
    if (doc.startViewTransition && !useUi.getState().reducedMotion) {
      const vt = doc.startViewTransition(() => toggleTheme());
      void vt.ready.then(() => {
        const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
          { duration: 700, easing: "cubic-bezier(0.65, 0, 0.35, 1)", pseudoElement: "::view-transition-new(root)" },
        );
      });
    } else {
      toggleTheme();
    }
    sfx.pop();
  };

  return (
    <Magnetic strength={8}>
      <button
        aria-label={isDark ? "Switch to day mode" : "Switch to night mode"}
        onClick={onClick}
        data-sfx="silent"
        className="relative grid h-10 w-10 place-items-center overflow-hidden rounded-full border border-[var(--line)] bg-[var(--bg-elev)]"
      >
        <motion.span
          className="absolute h-5 w-5 rounded-full bg-[var(--sun)]"
          animate={isDark ? { y: 26, scale: 0.4, opacity: 0 } : { y: 0, scale: 1, opacity: 1 }}
          transition={springy}
        />
        <motion.span
          className="absolute h-5 w-5 rounded-full bg-[var(--lavender)] shadow-[inset_-5px_-3px_0_0_var(--bg-elev)]"
          animate={isDark ? { y: 0, scale: 1, opacity: 1, rotate: 0 } : { y: -26, scale: 0.4, opacity: 0, rotate: -90 }}
          transition={springy}
        />
      </button>
    </Magnetic>
  );
}

function MuteToggle() {
  const muted = useUi((s) => s.muted);
  const toggleMuted = useUi((s) => s.toggleMuted);
  const bars = [0.5, 1, 0.7, 0.9];

  return (
    <Magnetic strength={8}>
      <button
        aria-label={muted ? "Unmute sounds" : "Mute sounds"}
        aria-pressed={muted}
        onClick={() => {
          toggleMuted();
          // Play after toggling so unmuting gives immediate feedback.
          window.setTimeout(() => sfx.pop(), 0);
        }}
        data-sfx="silent"
        className="grid h-10 w-10 place-items-center rounded-full border border-[var(--line)] bg-[var(--bg-elev)]"
      >
        <span className="flex h-4 items-end gap-[3px]">
          {bars.map((h, i) => (
            <motion.span
              key={i}
              className="w-[3px] rounded-full bg-[var(--ink)]"
              animate={muted ? { height: 3, opacity: 0.4 } : { height: [4, 16 * h, 6, 14 * h, 4] }}
              transition={muted ? springy : { duration: 0.9 + i * 0.15, repeat: Infinity, ease: "easeInOut" }}
            />
          ))}
        </span>
      </button>
    </Magnetic>
  );
}
