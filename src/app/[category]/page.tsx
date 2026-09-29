import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CATEGORIES, getCategory } from "@/lib/categories";
import { WORLDS } from "@/lib/worlds";
import { getAllTags, getProjectsByCategory } from "@/lib/content";
import { PageHero } from "@/components/work/PageHero";
import { ProjectGrid } from "@/components/work/ProjectGrid";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ category: c.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps<"/[category]">): Promise<Metadata> {
  const { category } = await params;
  const cat = getCategory(category);
  if (!cat) return {};
  return { title: cat.name, description: cat.blurb };
}

export default async function CategoryPage({ params }: PageProps<"/[category]">) {
  const { category } = await params;
  const cat = getCategory(category);
  if (!cat) notFound();

  const projects = getProjectsByCategory(cat.slug);
  const tags = getAllTags(projects);
  const world = WORLDS[cat.world];

  return (
    <>
      <PageHero eyebrow={`${cat.emoji} ${world.label} · ${world.tagline}`} title={cat.name} blurb={cat.blurb}>
        <Button href="/contact" variant="world">
          Start one like this
        </Button>
      </PageHero>
      <section data-chapter="work" className="px-6 pb-24 md:px-12">
        <div className="mx-auto max-w-6xl">
          <ProjectGrid projects={projects} tags={tags} />
        </div>
      </section>
      {world.interlude && (
        <section data-chapter="interlude" className="flex min-h-[85vh] items-center px-6 md:px-12">
          <Reveal className="mx-auto w-full max-w-6xl">
            <p className="font-display max-w-2xl text-[clamp(2rem,4.6vw,4.2rem)] font-bold leading-[1.02] tracking-tight [text-shadow:0_2px_30px_color-mix(in_oklab,var(--bg)_70%,transparent)]">
              {world.interlude}
            </p>
          </Reveal>
        </section>
      )}
    </>
  );
}
