"use client";

import Image from "next/image";
import { motion } from "motion/react";
import type { Product } from "@/lib/content";
import { formatPrice } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

export function ProductCard({ product }: { product: Product }) {
  const custom = product.tier === "made-to-order";
  const hasCheckout = Boolean(product.checkoutUrl);

  // Until Lemon Squeezy is live, buying routes to the contact form with the product prefilled.
  const contactHref = `/contact?subject=${encodeURIComponent(`${custom ? "Commission" : "Notify me"}: ${product.title}`)}`;

  return (
    <motion.article
      whileHover={{ y: -8 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className="group card flex h-full flex-col overflow-hidden"
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        <Image src={product.cover} alt={product.title} fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover transition-transform duration-700 ease-[var(--ease-out)] group-hover:scale-105" />
        <span className="font-display glass absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider">
          {custom ? "✨ Made to order" : "⚡ Grab & go"}
        </span>
        {product.featured && (
          <motion.span
            className="font-display absolute right-4 top-4 rounded-full px-3 py-1 text-xs font-bold text-[#1b2a22]"
            style={{ background: product.accent }}
            animate={{ rotate: [-3, 3, -3] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            Popular
          </motion.span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-6">
        <div className="flex items-start justify-between gap-4">
          <h3 className="font-display text-2xl font-bold tracking-tight">{product.title}</h3>
          <span className="font-display shrink-0 text-xl font-bold">
            {custom && <span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-mute)]">from </span>}
            {formatPrice(product.price)}
          </span>
        </div>
        <p className="mt-2 text-[var(--ink-soft)]">{product.tagline}</p>

        <ul className="mt-5 space-y-1.5 text-sm">
          {product.includes.slice(0, 4).map((inc, i) => (
            <li key={inc} className="flex items-start gap-2 transition-transform duration-500 ease-[var(--ease-bounce)] group-hover:translate-x-1.5" style={{ transitionDelay: `${i * 40}ms` }}>
              <span className="mt-0.5 text-[var(--leaf)]">✓</span>
              {inc}
            </li>
          ))}
        </ul>

        <div className="mt-auto flex flex-wrap items-center gap-3 pt-6">
          {hasCheckout ? (
            <Button href={product.checkoutUrl!} size="sm" variant="world" target="_blank" rel="noreferrer">
              Buy now
            </Button>
          ) : (
            <Button href={contactHref} size="sm" variant={custom ? "world" : "primary"}>
              {custom ? "Commission this" : "Notify me"}
            </Button>
          )}
          <div className="flex flex-wrap gap-1.5">
            {product.tags.slice(0, 2).map((t) => (
              <span key={t} className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs font-bold text-[var(--ink-mute)]">
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </motion.article>
  );
}
