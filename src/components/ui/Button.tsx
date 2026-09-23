"use client";

import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { gsap } from "gsap";
import { Magnetic } from "@/components/fx/Magnetic";
import { burstAt } from "@/components/fx/ParticleBurst";
import { TransitionLink } from "@/components/layout/TransitionLink";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "season";
type Size = "sm" | "md" | "lg";

interface BaseProps {
  variant?: Variant;
  size?: Size;
  /** Turn off the confetti burst on click. */
  quiet?: boolean;
  magnetic?: boolean;
  className?: string;
  children: ReactNode;
}

type ButtonProps = BaseProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type LinkProps = BaseProps & { href: string; target?: string; rel?: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void };

const base =
  "group relative isolate inline-flex items-center justify-center gap-2 overflow-hidden rounded-full font-display font-bold tracking-tight select-none transition-[transform,box-shadow] duration-300 ease-[var(--ease-bounce)] active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--season-a)]/50";

const variants: Record<Variant, string> = {
  primary: "bg-[var(--ink)] text-[var(--bg)] shadow-[var(--shadow-soft)] hover:shadow-[var(--shadow-pop)] hover:-translate-y-0.5",
  secondary: "bg-[var(--bg-elev)] text-[var(--ink)] border border-[var(--line)] hover:border-[var(--ink)]",
  ghost: "bg-transparent text-[var(--ink)] hover:bg-[color-mix(in_oklab,var(--ink)_8%,transparent)]",
  season: "season-gradient text-[#1b2a22] shadow-[var(--shadow-soft)] hover:shadow-[var(--shadow-pop)] hover:-translate-y-0.5",
};

const sizes: Record<Size, string> = {
  sm: "h-10 px-5 text-sm",
  md: "h-12 px-7 text-base",
  lg: "h-16 px-10 text-lg",
};

function squash(el: HTMLElement) {
  gsap.fromTo(
    el,
    { scaleX: 1, scaleY: 1 },
    { keyframes: [{ scaleX: 1.25, scaleY: 0.75, duration: 0.09 }, { scaleX: 0.92, scaleY: 1.08, duration: 0.12 }, { scaleX: 1, scaleY: 1, duration: 0.35, ease: "elastic.out(1, 0.4)" }] },
  );
}

/** Liquid fill that wells up from where the pointer entered. */
function Fill() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 translate-y-full rounded-full bg-[var(--season-a)] opacity-0 transition-[transform,opacity] duration-500 ease-[var(--ease-out)] group-hover:translate-y-0 group-hover:opacity-100"
      style={{ mixBlendMode: "multiply" }}
    />
  );
}

/** Flying text swap: label lifts out, a copy rises in. */
function Label({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-grid overflow-hidden">
      <span className="col-start-1 row-start-1 transition-transform duration-500 ease-[var(--ease-bounce)] group-hover:-translate-y-[120%]">
        {children}
      </span>
      <span
        aria-hidden
        className="col-start-1 row-start-1 translate-y-[120%] transition-transform duration-500 ease-[var(--ease-bounce)] group-hover:translate-y-0"
      >
        {children}
      </span>
    </span>
  );
}

export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps | LinkProps>(function Button(
  props,
  ref,
) {
  const { variant = "primary", size = "md", quiet, magnetic = true, className, children, ...rest } = props;
  const classes = cn(base, variants[variant], sizes[size], className);

  const handle = (e: MouseEvent<HTMLElement>) => {
    squash(e.currentTarget);
    if (!quiet) burstAt(e.clientX, e.clientY, variant === "ghost" ? 8 : 16);
  };

  const inner = (
    <>
      <Fill />
      <Label>{children}</Label>
    </>
  );

  let node: ReactNode;
  if ("href" in rest && rest.href) {
    const { href, onClick, ...linkRest } = rest as LinkProps;
    node = (
      <TransitionLink
        ref={ref as never}
        href={href}
        className={classes}
        onClick={(e) => {
          handle(e);
          onClick?.(e);
        }}
        {...linkRest}
      >
        {inner}
      </TransitionLink>
    );
  } else {
    const { onClick, ...btnRest } = rest as ButtonProps;
    node = (
      <button
        ref={ref as never}
        className={classes}
        onClick={(e) => {
          handle(e);
          onClick?.(e);
        }}
        {...btnRest}
      >
        {inner}
      </button>
    );
  }

  return magnetic ? <Magnetic>{node}</Magnetic> : node;
});
