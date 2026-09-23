"use client";

import { CATEGORIES, SHOP } from "@/lib/categories";
import { TransitionLink } from "@/components/layout/TransitionLink";
import { Button } from "@/components/ui/Button";

const WORDS = ["Sites", "Apps", "Play", "Create", "Templates", "Motion", "Brand", "Story"];

export function Footer() {
  return (
    <footer className="relative z-10 mt-32 overflow-hidden">
      <div className="pointer-events-none select-none overflow-hidden border-y border-[var(--line)] py-6">
        <div className="marquee flex w-max gap-10 whitespace-nowrap font-display text-4xl font-bold tracking-tight text-[var(--ink-mute)] md:text-6xl">
          {[...WORDS, ...WORDS].map((w, i) => (
            <span key={i} className="flex items-center gap-10">
              {w}
              <span className="season-gradient inline-block h-4 w-4 rounded-full" />
            </span>
          ))}
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="font-display text-3xl font-bold tracking-tight md:text-5xl">
            Got an idea that deserves <span className="season-text">a little pizazz?</span>
          </p>
          <div className="mt-8">
            <Button href="/contact" size="lg">
              Start a project
            </Button>
          </div>
        </div>

        <div>
          <h3 className="font-display mb-4 text-sm font-bold uppercase tracking-widest text-[var(--ink-mute)]">Explore</h3>
          <ul className="space-y-2 text-lg">
            {[...CATEGORIES, SHOP].map((c) => (
              <li key={c.href}>
                <TransitionLink href={c.href} className="group inline-flex items-center gap-2 hover:text-[var(--accent)]">
                  <span className="transition-transform group-hover:rotate-12">{c.emoji}</span>
                  <span className="relative after:absolute after:-bottom-0.5 after:left-0 after:h-0.5 after:w-0 after:bg-current after:transition-all group-hover:after:w-full">
                    {c.name}
                  </span>
                </TransitionLink>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="font-display mb-4 text-sm font-bold uppercase tracking-widest text-[var(--ink-mute)]">Studio</h3>
          <ul className="space-y-2 text-lg">
            <li>
              <TransitionLink href="/about" className="hover:text-[var(--accent)]">About</TransitionLink>
            </li>
            <li>
              <TransitionLink href="/contact" className="hover:text-[var(--accent)]">Contact</TransitionLink>
            </li>
            <li>
              <a href="mailto:hello@davisdigitaldesigns.com" className="hover:text-[var(--accent)]">
                hello@davisdigitaldesigns.com
              </a>
            </li>
          </ul>
          <p className="mt-10 text-sm text-[var(--ink-mute)]">
            Psst. Try the Konami code. Or click the logo five times.
          </p>
        </div>
      </div>

      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 pb-10 text-sm text-[var(--ink-mute)]">
        <span>© {new Date().getFullYear()} Davis Digital Designs. Made with far too many particles.</span>
        <span>Built with Next.js, React Three Fiber, and GSAP.</span>
      </div>
    </footer>
  );
}
