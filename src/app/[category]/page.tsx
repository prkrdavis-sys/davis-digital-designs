import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CATEGORIES, getCategory } from "@/lib/categories";
import { SEASON_THEMES } from "@/lib/seasons";
import { getAllTags, getProjectsByCategory } from "@/lib/content";
import { PageHero } from "@/components/work/PageHero";
import { ProjectGrid } from "@/components/work/ProjectGrid";
import { SeasonAmbience } from "@/components/work/SeasonAmbience";
import { Button } from "@/components/ui/Button";

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
  const season = SEASON_THEMES[cat.season];

  return (
    <>
      <SeasonAmbience season={cat.season} />
      <PageHero eyebrow={`${cat.emoji} ${season.label} · ${season.tagline}`} title={cat.name} blurb={cat.blurb}>
        <Button href="/contact" variant="season">
          Start one like this
        </Button>
      </PageHero>
      <section className="px-6 pb-24 md:px-12">
        <div className="mx-auto max-w-6xl">
          <ProjectGrid projects={projects} tags={tags} />
        </div>
      </section>
    </>
  );
}
