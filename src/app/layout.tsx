import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Manrope } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/layout/Providers";
import { SmoothScroll } from "@/components/layout/SmoothScroll";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";
import { PageCurtain } from "@/components/layout/PageCurtain";
import { CustomCursor } from "@/components/fx/CustomCursor";
import { Background } from "@/components/three/Background";
import { EasterEggs } from "@/components/easter/EasterEggs";

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

/** Runs before paint so there is no theme flash. */
const themeScript = `
(function(){try{var t=localStorage.getItem('ddd:theme');if(t!=='dark'&&t!=='light'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t;}catch(e){}})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} h-full antialiased`} data-season="spring" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <Providers>
          <SmoothScroll />
          <Background />
          <Nav />
          <main className="relative z-10 flex flex-1 flex-col">{children}</main>
          <Footer />
          <PageCurtain />
          <CustomCursor />
          <EasterEggs />
        </Providers>
      </body>
    </html>
  );
}
