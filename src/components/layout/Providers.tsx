"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { initialLowResources, pointer, storedAmbient, useUi } from "@/lib/store";
import { worldForPath } from "@/lib/worlds";
import { sfx } from "@/lib/sfx";

gsap.registerPlugin(ScrollTrigger, SplitText);

/**
 * Hydrates theme/mute/quality from localStorage, tracks device capabilities,
 * mirrors the route's world onto <html data-world>, and keeps the global
 * pointer object fresh. Also wires the delegated hover/click sounds.
 */
export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const setTheme = useUi((s) => s.setTheme);
  const setWorld = useUi((s) => s.setWorld);
  const setCapabilities = useUi((s) => s.setCapabilities);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("ddd:theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(storedTheme === "dark" || storedTheme === "light" ? storedTheme : prefersDark ? "dark" : "light");

    if (window.localStorage.getItem("ddd:muted") === "true") {
      useUi.setState({ muted: true });
    }
    useUi.setState({ ambient: storedAmbient() });

    const rm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const touch = window.matchMedia("(hover: none), (pointer: coarse)");
    const update = () => setCapabilities({ reducedMotion: rm.matches, isTouch: touch.matches });
    update();
    const low = initialLowResources(touch.matches);
    useUi.setState({ lowResources: low.value, lowResourcesSource: low.source });
    rm.addEventListener("change", update);
    touch.addEventListener("change", update);
    return () => {
      rm.removeEventListener("change", update);
      touch.removeEventListener("change", update);
    };
  }, [setTheme, setCapabilities]);

  useEffect(() => {
    const world = worldForPath(pathname);
    if (world) setWorld(world, false, null);
  }, [pathname, setWorld]);

  useEffect(() => {
    let lastX = 0;
    let lastY = 0;
    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.nx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.ny = -((e.clientY / window.innerHeight) * 2 - 1);
      pointer.vx = e.clientX - lastX;
      pointer.vy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      pointer.active = true;
    };
    const onDown = () => (pointer.down = true);
    const onUp = () => (pointer.down = false);
    const onLeave = () => (pointer.active = false);

    // Delegated sounds: anything interactive blips on hover and chimes on click.
    const isInteractive = (el: EventTarget | null) =>
      el instanceof Element && el.closest("a, button, [role='button'], [data-sfx]");
    const onOver = (e: PointerEvent) => {
      if (isInteractive(e.target)) sfx.hover();
    };
    const onClick = (e: MouseEvent) => {
      const el = isInteractive(e.target);
      if (!el) return;
      if ((el as Element).getAttribute("data-sfx") === "silent") return;
      sfx.click();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointerleave", onLeave);
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("click", onClick);
    };
  }, []);

  return <>{children}</>;
}
