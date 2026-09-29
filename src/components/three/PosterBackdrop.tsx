"use client";

import { useEffect, useRef, useState } from "react";
import { scrollState, useUi, useVariant } from "@/lib/store";
import { WORLDS } from "@/lib/worlds";
import { chapterTimeAt, engine } from "@/components/three/engine/state";
import { buildSegments, emptyFrame, resolveFrame } from "@/components/three/engine/timeline";
import { indexAt, loadPosters, variantOf, type PosterEntry } from "@/worlds/lo/manifests";
import type { SceneId } from "@/worlds/types";

interface Shown {
  src: string;
  key: string;
  loaded: boolean;
}

/**
 * Cycles stills for the current chapter, crossfading as you scroll. Sits under
 * the live canvas as the instant loading state, and is the whole background
 * when WebGL is unavailable or the visitor prefers reduced motion. Hides
 * itself once the live scene covers it.
 */
export function PosterBackdrop({ live }: { live: boolean }) {
  const worldId = useUi((s) => s.world);
  const chapterIds = useUi((s) => s.chapterIds);
  const variant = useVariant();
  const [shown, setShown] = useState<Shown[]>([]);
  const [covered, setCovered] = useState(false);
  const posters = useRef(new Map<SceneId, PosterEntry[] | null>());
  const current = useRef("");

  useEffect(() => {
    const world = WORLDS[worldId];
    const segs = buildSegments(world, chapterIds);
    const frame = emptyFrame(world.scene);
    let raf = 0;
    let alive = true;

    const pick = () => {
      const t = live ? engine.t : chapterTimeAt(scrollState.y);
      const f = resolveFrame(segs, t, world.scene, frame);
      const useB = f.b !== null && f.mix > 0.5;
      const scene = useB && f.b ? f.b : f.a;
      const s = useB ? f.sB : f.sA;
      const list = posters.current.get(scene);
      if (list === undefined) {
        posters.current.set(scene, null);
        void loadPosters(scene).then((p) => {
          if (!alive) return;
          posters.current.set(scene, p);
          pick();
        });
        return;
      }
      if (!list) return;
      const mine = list.filter((p) => variantOf(p.tag) === variant);
      if (!mine.length) return;
      const entry = mine[indexAt(mine, s)];
      const key = `${scene}/${entry.tag}`;
      if (key === current.current) return;
      current.current = key;
      setShown((prev) => [...prev.slice(-1), { src: `/worlds/${scene}/posters/${entry.poster}`, key, loaded: false }]);
    };

    const onScroll = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(pick);
    };
    pick();
    window.addEventListener("scroll", onScroll, { passive: true });
    const tick = window.setInterval(() => {
      pick();
      const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-engine]");
      const primary = engine.primaryScene;
      setCovered(live && Boolean(canvas && canvas.style.opacity === "1" && primary && engine.readyScenes.has(primary)));
    }, 700);
    return () => {
      alive = false;
      window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.clearInterval(tick);
    };
  }, [worldId, chapterIds, variant, live]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-[5] overflow-hidden" style={{ visibility: covered ? "hidden" : "visible" }}>
      {shown.map((l) => (
        // eslint-disable-next-line @next/next/no-img-element -- full-bleed decorative stills, crossfaded manually
        <img
          key={l.key}
          src={l.src}
          alt=""
          decoding="async"
          onLoad={() => setShown((prev) => prev.map((p) => (p.key === l.key ? { ...p, loaded: true } : p)))}
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
          style={{ opacity: l.loaded ? 1 : 0 }}
        />
      ))}
    </div>
  );
}
