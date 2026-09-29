import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getAdjacentProjects, getAllProjects, getProject } from "@/lib/content";
import { getCategory } from "@/lib/categories";
import { ProjectArticle } from "@/components/work/ProjectArticle";
import { SetWorld } from "@/components/layout/SetWorld";

export function generateStaticParams() {
  return getAllProjects().map((p) => ({ slug: p.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps<"/work/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) return {};
  return {
    title: project.title,
    description: project.tagline,
    openGraph: { images: [project.cover] },
  };
}

export default async function ProjectPage({ params }: PageProps<"/work/[slug]">) {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) notFound();

  const { prev, next } = getAdjacentProjects(slug);
  const category = getCategory(project.category);

  return (
    <>
      {category && <SetWorld world={category.world} parked cover={project.cover} />}
      <ProjectArticle project={project} prev={prev} next={next} body={<MDXRemote source={project.body} />} />
    </>
  );
}
