"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { EASE_CURVE } from "@/lib/motion";
import { sfx } from "@/lib/sfx";
import { Button } from "@/components/ui/Button";

const DURATION = 20;
const COUNT = 14;

interface Fly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  phase: number;
  caught: number; // 0 = free, >0 = seconds since caught (for pop animation)
}

/**
 * Catch the fireflies: click or tap glowing dots before the timer runs out.
 * Pure 2D canvas so it costs nothing until it's opened.
 */
export function FireflyGame({ onClose }: { onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [time, setTime] = useState(DURATION);
  const [done, setDone] = useState(false);
  const best = useRef<number>(0);

  useEffect(() => {
    best.current = Number(window.localStorage.getItem("ddd:firefly-best") ?? 0);
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d")!;
    let w = (el.width = window.innerWidth * devicePixelRatio);
    let h = (el.height = window.innerHeight * devicePixelRatio);
    const flies: Fly[] = Array.from({ length: COUNT }, () => spawn(w, h));
    let raf = 0;
    let last = performance.now();
    let elapsed = 0;
    let localScore = 0;
    let finished = false;

    function spawn(w: number, h: number): Fly {
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 120 * devicePixelRatio,
        vy: (Math.random() - 0.5) * 120 * devicePixelRatio,
        r: (10 + Math.random() * 8) * devicePixelRatio,
        phase: Math.random() * Math.PI * 2,
        caught: 0,
      };
    }

    const onResize = () => {
      w = el.width = window.innerWidth * devicePixelRatio;
      h = el.height = window.innerHeight * devicePixelRatio;
    };
    window.addEventListener("resize", onResize);

    const onPointer = (e: PointerEvent) => {
      if (finished) return;
      const x = e.clientX * devicePixelRatio;
      const y = e.clientY * devicePixelRatio;
      for (const f of flies) {
        if (f.caught) continue;
        if (Math.hypot(f.x - x, f.y - y) < f.r * 2.4) {
          f.caught = 0.001;
          localScore += 1;
          setScore(localScore);
          sfx.sparkle();
          break;
        }
      }
    };
    el.addEventListener("pointerdown", onPointer);

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      elapsed += dt;
      const remaining = Math.max(0, DURATION - elapsed);
      setTime(Math.ceil(remaining));
      if (remaining <= 0 && !finished) {
        finished = true;
        setDone(true);
        if (localScore > best.current) {
          best.current = localScore;
          window.localStorage.setItem("ddd:firefly-best", String(localScore));
        }
        sfx.success();
      }

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (const f of flies) {
        if (f.caught) {
          f.caught += dt;
          const t = f.caught / 0.4;
          if (t >= 1) {
            Object.assign(f, spawn(w, h), { caught: 0 });
            continue;
          }
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r * (1 + t * 3), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255, 240, 160, ${1 - t})`;
          ctx.lineWidth = 3 * devicePixelRatio;
          ctx.stroke();
          continue;
        }
        f.phase += dt * 3;
        f.vx += (Math.random() - 0.5) * 400 * dt * devicePixelRatio;
        f.vy += (Math.random() - 0.5) * 400 * dt * devicePixelRatio;
        const speed = Math.hypot(f.vx, f.vy);
        const max = 220 * devicePixelRatio;
        if (speed > max) {
          f.vx = (f.vx / speed) * max;
          f.vy = (f.vy / speed) * max;
        }
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        if (f.x < 0 || f.x > w) f.vx *= -1;
        if (f.y < 0 || f.y > h) f.vy *= -1;
        f.x = Math.max(0, Math.min(w, f.x));
        f.y = Math.max(0, Math.min(h, f.y));

        const glow = 0.6 + 0.4 * Math.sin(f.phase);
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 3);
        g.addColorStop(0, `rgba(255, 245, 180, ${glow})`);
        g.addColorStop(0.3, `rgba(255, 220, 110, ${glow * 0.6})`);
        g.addColorStop(1, "rgba(255, 200, 80, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255, 255, 230, ${glow})`;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
      el.removeEventListener("pointerdown", onPointer);
    };
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: EASE_CURVE.inOut }}
      className="fixed inset-0 z-[120] bg-[#0b1020]/92 text-[#f3f0e8] backdrop-blur-sm"
      data-cursor="Catch"
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full touch-none" />

      <div className="pointer-events-none absolute inset-x-0 top-6 flex items-start justify-between px-6">
        <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} className="pointer-events-auto rounded-3xl border border-white/10 bg-white/5 px-5 py-4">
          <p className="font-display text-xs font-bold uppercase tracking-widest text-white/60">Secret level</p>
          <h2 className="font-display text-2xl font-bold">Catch the fireflies</h2>
          <p className="text-sm text-white/70">Click the glowing ones. Esc to leave.</p>
        </motion.div>
        <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }} className="flex gap-3">
          <Stat label="Caught" value={score} />
          <Stat label="Time" value={time} warn={time <= 5} />
        </motion.div>
      </div>

      {done && (
        <motion.div
          initial={{ opacity: 0, scale: 0.85, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE_CURVE.bounce }}
          className="absolute left-1/2 top-1/2 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-card)] border border-white/10 bg-white/10 p-8 text-center backdrop-blur-xl"
        >
          <p className="text-5xl">✨</p>
          <h3 className="font-display mt-4 text-3xl font-bold">
            {score} {score === 1 ? "firefly" : "fireflies"}
          </h3>
          <p className="mt-2 text-white/70">Best so far: {Math.max(best.current, score)}. Send me your score with your project brief and I&rsquo;ll knock 5% off.</p>
          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={onClose} variant="world" quiet>
              Back to the site
            </Button>
          </div>
        </motion.div>
      )}

      <button onClick={onClose} aria-label="Close game" className="absolute right-6 bottom-6 grid h-12 w-12 place-items-center rounded-full border border-white/20 bg-white/10 text-xl hover:bg-white/20">
        ×
      </button>
    </motion.div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`pointer-events-auto rounded-3xl border border-white/10 px-5 py-3 text-center ${warn ? "bg-[var(--petal)]/30" : "bg-white/5"}`}>
      <p className="font-display text-xs font-bold uppercase tracking-widest text-white/60">{label}</p>
      <motion.p key={value} initial={{ scale: 1.4 }} animate={{ scale: 1 }} className="font-display text-3xl font-black tabular-nums">
        {value}
      </motion.p>
    </div>
  );
}
