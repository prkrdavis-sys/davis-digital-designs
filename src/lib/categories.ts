import type { Season } from "@/lib/seasons";

export type CategorySlug = "sites" | "apps" | "play" | "create";

export interface Category {
  slug: CategorySlug;
  name: string;
  /** Short, punchy verb-ish line under the name. */
  hook: string;
  /** Longer copy for the category page hero. */
  blurb: string;
  season: Season;
  emoji: string;
  href: `/${CategorySlug}`;
}

export const CATEGORIES: Category[] = [
  {
    slug: "sites",
    name: "Sites",
    hook: "Websites that feel alive",
    blurb:
      "Marketing sites, landing pages, and brand homes built to load fast, rank well, and make people stop scrolling.",
    season: "spring",
    emoji: "🌸",
    href: "/sites",
  },
  {
    slug: "apps",
    name: "Apps",
    hook: "Web apps people actually use",
    blurb:
      "Dashboards, tools, and products with real logic behind them. Designed for daily use, built to grow.",
    season: "summer",
    emoji: "☀️",
    href: "/apps",
  },
  {
    slug: "play",
    name: "Play",
    hook: "Games and interactive toys",
    blurb:
      "Browser games, prototypes, and playful experiments. Because the best way to learn a tool is to build a toy with it.",
    season: "autumn",
    emoji: "🍂",
    href: "/play",
  },
  {
    slug: "create",
    name: "Create",
    hook: "Video, social, and story",
    blurb:
      "Content creation: edits, thumbnails, motion graphics, and social series that keep an audience coming back.",
    season: "winter",
    emoji: "❄️",
    href: "/create",
  },
];

export const SHOP = {
  slug: "shop",
  name: "Studio Shop",
  hook: "Templates, ready or made to order",
  blurb:
    "Canva templates and design kits. Grab one and go, or commission a version built around your brand.",
  season: "golden" as Season,
  emoji: "🌅",
  href: "/shop" as const,
};

export function getCategory(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

/**
 * Map a pathname to the season its page should wear.
 * Returns null for project pages, which set their own season from the project's category.
 */
export function seasonForPath(pathname: string): Season | null {
  if (pathname.startsWith("/work/")) return null;
  if (pathname.startsWith("/shop")) return "golden";
  const cat = CATEGORIES.find((c) => pathname.startsWith(c.href));
  if (cat) return cat.season;
  if (pathname.startsWith("/about")) return "summer";
  if (pathname.startsWith("/contact")) return "golden";
  return "spring";
}
