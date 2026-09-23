import type { Metadata } from "next";
import { SHOP } from "@/lib/categories";
import { getAllProducts } from "@/lib/content";
import { PageHero } from "@/components/work/PageHero";
import { ShopTabs } from "@/components/shop/ShopTabs";
import { SeasonAmbience } from "@/components/work/SeasonAmbience";
import { Reveal } from "@/components/ui/Reveal";

export const metadata: Metadata = {
  title: SHOP.name,
  description: SHOP.blurb,
};

const FAQ = [
  { q: "How do I get a Grab & Go template?", a: "After checkout you receive a PDF with your Canva template link. Click it, hit 'Use template', and it copies into your Canva account. Works with Canva Free." },
  { q: "What does Made to Order include?", a: "A short discovery call, a Canva brand kit with your colors and fonts, a set of templates designed for your brand, and revision rounds. Timelines are usually one to two weeks." },
  { q: "Can I get a refund?", a: "Digital templates are non-refundable once the link is delivered, but if something is broken I will fix it or make it right." },
];

export default function ShopPage() {
  const products = getAllProducts();
  return (
    <>
      <SeasonAmbience season="golden" />
      <PageHero eyebrow={`${SHOP.emoji} Golden hour · Warm glow, ready to ship`} title={SHOP.name} blurb={SHOP.blurb} />
      <section className="px-6 pb-24 md:px-12">
        <div className="mx-auto max-w-6xl">
          <ShopTabs products={products} />
        </div>
      </section>
      <section className="px-6 pb-24 md:px-12">
        <div className="mx-auto max-w-3xl">
          <Reveal>
            <h2 className="font-display mb-8 text-3xl font-bold tracking-tight md:text-5xl">Good to know</h2>
          </Reveal>
          <div className="space-y-4">
            {FAQ.map((f, i) => (
              <Reveal key={f.q} delay={i * 0.08}>
                <details className="card group p-6 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="font-display flex cursor-pointer items-center justify-between gap-4 text-lg font-bold">
                    {f.q}
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--line)] transition-transform duration-500 ease-[var(--ease-bounce)] group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-4 leading-relaxed text-[var(--ink-soft)]">{f.a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
