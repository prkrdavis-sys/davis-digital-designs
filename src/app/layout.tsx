import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Manrope } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/layout/Providers";
import { SmoothScroll } from "@/components/layout/SmoothScroll";
import { ChapterTracker } from "@/components/layout/ChapterTracker";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";
import { PageCurtain } from "@/components/layout/PageCurtain";
import { CursorLayer } from "@/components/cursor/CursorLayer";
import { Background } from "@/components/three/Background";
import { EasterEggs } from "@/components/easter/EasterEggs";
import { PerfPrompt } from "@/components/layout/PerfPrompt";
import { AmbienceController } from "@/components/layout/AmbienceController";
import { WORLDS, WORLD_IDS } from "@/lib/worlds";
import { getAllProjects } from "@/lib/content";

const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

const body = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Davis Digital Designs",
    template: "%s · Davis Digital Designs",
  },
  description:
    "Websites, web apps, games, content, and Canva templates by Davis Digital Designs. Professional work with a lot of pizazz.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://davis-digital-designs-ten.vercel.app"),
  openGraph: {
    title: "Davis Digital Designs",
    description: "Professional work with a lot of pizazz.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf7ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1020" },
  ],
};

/** Per-world accent variables, generated from the one palette source in src/lib/worlds.ts. */
const worldCss = WORLD_IDS.map((id) => {
  const [a, b, c] = WORLDS[id].palette.day;
  const [na, nb, nc] = WORLDS[id].palette.night;
  return `[data-world="${id}"]{--world-a:${a};--world-b:${b};--world-c:${c}}[data-theme="dark"][data-world="${id}"]{--world-a:${na};--world-b:${nb};--world-c:${nc}}`;
}).join("");

/** Runs before paint: theme, plus the route's world so accents never flash. */
function bootScript(projectWorlds: Record<string, string>): string {
  return `
(function(){try{var d=document.documentElement;var t=localStorage.getItem('ddd:theme');if(t!=='dark'&&t!=='light'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}d.dataset.theme=t;
if(localStorage.getItem('ddd:content-hidden')==='true')d.dataset.content='off';
var p=location.pathname,w='home',ids=${JSON.stringify(WORLD_IDS)},pw=${JSON.stringify(projectWorlds)};
if(p.indexOf('/work/')===0){w=pw[p.split('/')[2]]||'home'}else{var f=p.split('/')[1];if(ids.indexOf(f)>=0)w=f}
d.dataset.world=w;}catch(e){}})();
`;
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  const projectWorlds = Object.fromEntries(getAllProjects().map((p) => [p.slug, p.category]));
  return (
    <html lang="en" className={`${display.variable} ${body.variable} h-full antialiased`} data-world="home" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: worldCss }} />
        <script dangerouslySetInnerHTML={{ __html: bootScript(projectWorlds) }} />
      </head>
      <body className="flex min-h-full flex-col">
        <Providers>
          <SmoothScroll />
          <ChapterTracker />
          <Background />
          <Nav />
          <main className="relative z-10 flex flex-1 flex-col">{children}</main>
          <Footer />
          <PageCurtain />
          <CursorLayer />
          <EasterEggs />
          <PerfPrompt />
          <AmbienceController />
        </Providers>
      </body>
    </html>
  );
}
