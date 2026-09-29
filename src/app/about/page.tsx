import type { Metadata } from "next";
import { PageHero } from "@/components/work/PageHero";
import { Testimonials } from "@/components/home/Testimonials";
import { AboutStory } from "@/components/about/AboutStory";
import { Button } from "@/components/ui/Button";
import { WORLDS } from "@/lib/worlds";

export const metadata: Metadata = {
  title: "About",
  description: "Who is behind Davis Digital Designs and how the work gets made.",
};

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow={`🏔️ ${WORLDS.about.label} · ${WORLDS.about.tagline}`}
        title="Hi, I'm Davis."
        blurb="One person, several hats: designer, developer, editor, and template tinkerer. I like work that is professional on the inside and joyful on the outside."
      >
        <Button href="/contact" variant="world">
          Work with me
        </Button>
      </PageHero>
      <AboutStory />
      <Testimonials />
    </>
  );
}
