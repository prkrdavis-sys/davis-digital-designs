import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import type { CategorySlug } from "@/lib/categories";

/* ------------------------------------------------------------------
   Schemas. If a frontmatter field is wrong, the build fails with a
   readable message that names the file and the field.
   ------------------------------------------------------------------ */

const categorySchema = z.enum(["sites", "apps", "play", "create"]);

export const projectSchema = z.object({
  title: z.string().min(1, "title is required"),
  tagline: z.string().min(1, "tagline is required"),
  category: categorySchema,
  year: z.number().int().min(2000).max(2100),
  client: z.string().optional(),
  tags: z.array(z.string()).default([]),
  cover: z.string().startsWith("/", "cover must be a public path like /work/slug/cover.svg"),
  gallery: z.array(z.string()).default([]),
  /** External link: live site, itch.io page, YouTube video, etc. */
  link: z.string().url().optional(),
  linkLabel: z.string().optional(),
  /** Short video/GIF for hover previews and Play showcases. */
  video: z.string().optional(),
  featured: z.boolean().default(false),
  /** Visual weight in grids: tall cards get more room. */
  size: z.enum(["sm", "md", "lg"]).default("md"),
  /** Accent color for the card gradient. */
  accent: z.string().default("#3fa66b"),
  problem: z.string().optional(),
  solution: z.string().optional(),
  result: z.string().optional(),
  draft: z.boolean().default(false),
});

export type ProjectMeta = z.infer<typeof projectSchema>;

export interface Project extends ProjectMeta {
  slug: string;
  body: string;
}

export const productSchema = z.object({
  title: z.string().min(1),
  tagline: z.string().min(1),
  tier: z.enum(["grab-and-go", "made-to-order"]),
  /** In cents. For made-to-order this is the starting price. */
  price: z.number().int().nonnegative(),
  cover: z.string().startsWith("/"),
  tags: z.array(z.string()).default([]),
  includes: z.array(z.string()).default([]),
  /** Lemon Squeezy checkout URL. Leave out until the store is live. */
  checkoutUrl: z.string().url().optional(),
  accent: z.string().default("#ffb84d"),
  featured: z.boolean().default(false),
  draft: z.boolean().default(false),
});

export type ProductMeta = z.infer<typeof productSchema>;

export interface Product extends ProductMeta {
  slug: string;
  body: string;
}

/* ------------------------------------------------------------------
   Loaders
   ------------------------------------------------------------------ */

const CONTENT_ROOT = path.join(process.cwd(), "content");

function readCollection<T>(
  dir: string,
  schema: z.ZodType<T>,
): Array<T & { slug: string; body: string }> {
  const full = path.join(CONTENT_ROOT, dir);
  if (!fs.existsSync(full)) return [];
  const files = fs.readdirSync(full).filter((f) => f.endsWith(".mdx") && !f.startsWith("_"));

  return files
    .map((file) => {
      const raw = fs.readFileSync(path.join(full, file), "utf8");
      const { data, content } = matter(raw);
      const parsed = schema.safeParse(data);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("\n");
        throw new Error(`Invalid frontmatter in content/${dir}/${file}:\n${issues}`);
      }
      return { ...parsed.data, slug: file.replace(/\.mdx$/, ""), body: content.trim() };
    })
    .filter((item) => !(item as { draft?: boolean }).draft);
}

let projectCache: Project[] | null = null;
let productCache: Product[] | null = null;

export function getAllProjects(): Project[] {
  if (!projectCache || process.env.NODE_ENV === "development") {
    projectCache = readCollection("work", projectSchema).sort((a, b) => b.year - a.year);
  }
  return projectCache;
}

export function getProjectsByCategory(category: CategorySlug): Project[] {
  return getAllProjects().filter((p) => p.category === category);
}

export function getFeaturedProjects(limit = 6): Project[] {
  const all = getAllProjects();
  const featured = all.filter((p) => p.featured);
  return (featured.length >= 3 ? featured : all).slice(0, limit);
}

export function getProject(slug: string): Project | undefined {
  return getAllProjects().find((p) => p.slug === slug);
}

export function getAdjacentProjects(slug: string): { prev?: Project; next?: Project } {
  const all = getAllProjects();
  const i = all.findIndex((p) => p.slug === slug);
  if (i === -1) return {};
  return {
    prev: all[(i - 1 + all.length) % all.length],
    next: all[(i + 1) % all.length],
  };
}

export function getAllTags(projects: Project[]): string[] {
  const set = new Set<string>();
  projects.forEach((p) => p.tags.forEach((t) => set.add(t)));
  return Array.from(set).sort();
}

export function getAllProducts(): Product[] {
  if (!productCache || process.env.NODE_ENV === "development") {
    productCache = readCollection("shop", productSchema).sort((a, b) => Number(b.featured) - Number(a.featured));
  }
  return productCache;
}
