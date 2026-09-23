"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { forwardRef, type ComponentProps, type MouseEvent } from "react";
import { useUi } from "@/lib/store";
import { sfx } from "@/lib/sfx";

export const TRANSITION_IN_MS = 520;

/** Where the last transition started, so the curtain grows from the click. */
export const transitionOrigin = { x: 0.5, y: 0.5 };

type Props = Omit<ComponentProps<typeof Link>, "href"> & { href: string };

/**
 * A Link that plays the season-wipe curtain before navigating.
 * Falls back to a normal link for modified clicks, external URLs, and reduced motion.
 */
export const TransitionLink = forwardRef<HTMLAnchorElement, Props>(function TransitionLink(
  { href, onClick, children, ...rest },
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
    setTransitioning(true);
    sfx.whoosh();
    window.setTimeout(() => router.push(href as never), TRANSITION_IN_MS);
  };

  return (
    <Link ref={ref} href={href as never} onClick={handleClick} {...rest}>
      {children}
    </Link>
  );
});
