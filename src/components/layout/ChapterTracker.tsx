"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useUi } from "@/lib/store";
import { chapters } from "@/components/three/engine/state";

/** Where in the viewport a chapter "begins": its top crossing 45% down the screen. */
const ENTRY = 0.45;
/** Every chapter gets at least this much scroll (fraction of viewport), even short final ones. */
const MIN_SPAN = 0.3;

function visible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0 && !el.closest("[hidden]");
}

function measure() {
  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-chapter]")).filter(visible);
  const vh = window.innerHeight;
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
  const ids = els.map((el) => el.dataset.chapter ?? "");
  const n = ids.length;
  const anchors = new Array<number>(n + 1);
  anchors[0] = 0;
  for (let i = 1; i < n; i++) {
    const top = els[i].getBoundingClientRect().top + window.scrollY;
    anchors[i] = top - vh * ENTRY;
  }
  anchors[n] = maxScroll;
  // Every chapter gets at least minLen of scroll: push forward, then squeeze to fit if needed.
  const minLen = Math.min(vh * MIN_SPAN, maxScroll / Math.max(1, n));
  for (let i = 1; i < n; i++) anchors[i] = Math.max(anchors[i], anchors[i - 1] + minLen);
  const room = maxScroll - minLen;
  if (n > 1 && anchors[n - 1] > room) {
    const k = room / anchors[n - 1];
    for (let i = 1; i < n; i++) anchors[i] *= k;
  }
  for (let i = 1; i <= n; i++) anchors[i] = Math.max(anchors[i], anchors[i - 1] + 1);

  chapters.ids = ids;
  chapters.anchors = anchors;
  chapters.version++;
  useUi.getState().setChapterIds(ids);
}

/**
 * Finds the page's [data-chapter] sections and records where each starts, so
 * the 3D world can map scroll position to chapter time. Re-measures on route
 * change, resize, and any layout shift (images loading, filters changing).
 */
export function ChapterTracker() {
  const pathname = usePathname();

  useEffect(() => {
    let raf = 0;
    const schedule = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(measure);
    };
    schedule();
    const late = window.setTimeout(schedule, 400);
    const ro = new ResizeObserver(schedule);
    ro.observe(document.body);
    window.addEventListener("resize", schedule);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(late);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [pathname]);

  return null;
}
