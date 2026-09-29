"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { forwardRef, type ComponentProps, type MouseEvent } from "react";
import { useUi } from "@/lib/store";
import { sfx } from "@/lib/sfx";
import type { TransitionKind } from "@/worlds/types";
import { routeIntent } from "@/components/three/engine/state";
import { WORLDS, worldForPath } from "@/lib/worlds";
import { preloadScene } from "@/worlds/registry";

export const TRANSITION_IN_MS = 460;

/** Where the last transition started, so the veil blooms from the click. */
export const transitionOrigin = { x: 0.5, y: 0.5 };

type Props = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
  /** How the next world arrives in the 3D compositor (defaults to the world's own entrance). */
  transition?: TransitionKind;
};

/**
 * A Link that dissolves the page content before navigating, so the 3D world
 * transition behind it stays visible. Falls back to a normal link for modified
 * clicks, external URLs, and reduced motion.
 */
export const TransitionLink = forwardRef<HTMLAnchorElement, Props>(function TransitionLink(
  { href, onClick, transition, children, ...rest },
  ref,
) {
  const router = useRouter();
  const pathname = usePathname();
  const setTransitioning = useUi((s) => s.setTransitioning);
  const reducedMotion = useUi((s) => s.reducedMotion);

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    const external = /^https?:\/\//.test(href) || href.startsWith("mailto:");
    if (external || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (href.split("#")[0] === pathname) return;
    if (reducedMotion) return;

    e.preventDefault();
    transitionOrigin.x = e.clientX / window.innerWidth;
    transitionOrigin.y = e.clientY / window.innerHeight;
    routeIntent.kind = transition ?? null;
    setTransitioning(true);
    sfx.whoosh();
    window.setTimeout(() => router.push(href as never), TRANSITION_IN_MS);
  };

  const warm = () => {
    const w = worldForPath(href.split("#")[0]);
    if (w) preloadScene(WORLDS[w].scene);
  };

  return (
    <Link ref={ref} href={href as never} onClick={handleClick} onPointerEnter={warm} onFocus={warm} {...rest}>
      {children}
    </Link>
  );
});
