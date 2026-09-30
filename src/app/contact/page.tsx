import type { Metadata } from "next";
import { PageHero } from "@/components/work/PageHero";
import { ContactForm } from "@/components/contact/ContactForm";
import { Reveal } from "@/components/ui/Reveal";
import { getInterestGroups } from "@/lib/content";

export const metadata: Metadata = {
  title: "Contact",
  description: "Start a project with Davis Digital Designs.",
};

const EXPECT = [
  { emoji: "⚡", title: "Fast reply", text: "Usually within two working days, often the same day." },
  { emoji: "🗺️", title: "A plan, not a pitch", text: "You get a short outline of scope, timeline, and price before anything else." },
  { emoji: "🌱", title: "Small starts welcome", text: "One template, one landing page, one weekend game. Big things grow from those." },
];

export default async function ContactPage({ searchParams }: PageProps<"/contact">) {
  const sp = await searchParams;
  const subject = typeof sp.subject === "string" ? sp.subject : "";

  return (
    <>
      <PageHero eyebrow="✈️ Say hello" title="Let's talk." blurb="Tell me what you're making. I'll tell you how I'd build it, what it would cost, and when you'd have it." />
      <section data-chapter="form" className="px-6 pb-24 md:px-12">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1fr_360px]">
          <ContactForm defaultSubject={subject} interests={getInterestGroups()} />
          <aside className="space-y-4">
            {EXPECT.map((e, i) => (
              <Reveal key={e.title} delay={i * 0.1}>
                <div className="glass rounded-[var(--radius-card)] p-6">
                  <span className="text-3xl">{e.emoji}</span>
                  <h3 className="font-display mt-3 text-xl font-bold">{e.title}</h3>
                  <p className="mt-1 text-[var(--ink-soft)]">{e.text}</p>
                </div>
              </Reveal>
            ))}
          </aside>
        </div>
      </section>
    </>
  );
}
