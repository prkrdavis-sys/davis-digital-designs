import { getAllProducts, getAllProjects, getFeaturedProjects } from "@/lib/content";
import { Hero } from "@/components/home/Hero";
import { CategoryPortals } from "@/components/home/CategoryPortals";
import { FeaturedReel } from "@/components/home/FeaturedReel";
import { Testimonials } from "@/components/home/Testimonials";
import { CTA } from "@/components/home/CTA";

export default function Home() {
  const projects = getAllProjects();
  const featured = getFeaturedProjects(6);
  const counts: Record<string, number> = { shop: getAllProducts().length };
  for (const p of projects) counts[p.category] = (counts[p.category] ?? 0) + 1;

  return (
    <>
      <Hero />
      <CategoryPortals counts={counts} />
      <FeaturedReel projects={featured} />
      <Testimonials />
      <CTA />
    </>
  );
}
