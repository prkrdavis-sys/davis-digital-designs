"use client";

import { useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import type { Product } from "@/lib/content";
import { springy } from "@/lib/motion";
import { sfx } from "@/lib/sfx";
import { ProductCard } from "@/components/shop/ProductCard";
import { cn } from "@/lib/utils";

type Tier = Product["tier"];

const TIERS: Array<{ id: Tier; label: string; emoji: string; blurb: string }> = [
  { id: "grab-and-go", label: "Grab & Go", emoji: "⚡", blurb: "Ready-made Canva templates. Pay, get the link, start editing in minutes." },
  { id: "made-to-order", label: "Made to Order", emoji: "✨", blurb: "Custom kits built around your brand. We start with a call and end with something only you have." },
];

export function ShopTabs({ products }: { products: Product[] }) {
  const [tier, setTier] = useState<Tier>("grab-and-go");
  const visible = products.filter((p) => p.tier === tier);
  const current = TIERS.find((t) => t.id === tier)!;

  return (
    <LayoutGroup>
      <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="glass inline-flex self-start rounded-full p-1.5">
          {TIERS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTier(t.id);
                sfx.pop();
              }}
              data-sfx="silent"
              className={cn(
                "font-display relative h-12 rounded-full px-6 text-base font-bold tracking-tight transition-colors",
                tier === t.id ? "text-[#1b2a22]" : "text-[var(--ink)]",
              )}
            >
              {tier === t.id && <motion.span layoutId="tier-pill" className="world-gradient absolute inset-0 -z-10 rounded-full" transition={springy} />}
              <span className="relative">
                {t.emoji} {t.label}
              </span>
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.p
            key={tier}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="max-w-md text-[var(--ink-soft)]"
          >
            {current.blurb}
          </motion.p>
        </AnimatePresence>
      </div>

      <motion.div layout className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence mode="popLayout">
          {visible.map((p, i) => (
            <motion.div
              key={p.slug}
              layout
              initial={{ opacity: 0, y: 30, rotate: i % 2 ? 2 : -2 }}
              animate={{ opacity: 1, y: 0, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ ...springy, delay: i * 0.05 }}
            >
              <ProductCard product={p} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </LayoutGroup>
  );
}
