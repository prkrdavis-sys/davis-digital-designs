#!/usr/bin/env node
/**
 * Shop products -> monolith panel data.
 *
 *   node art/worlds/dunes/panels.mjs
 *
 * Reads content/shop/*.mdx frontmatter and writes
 *   public/worlds/dunes/hi/panels.json       product list the runtime composes panels from (covers load live)
 *   art/out/dunes/panels/panel-<i>.png       the same layout rasterized for the Cycles stills
 * The layout mirrors src/worlds/scenes/dunes/panels.ts.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "../../..");
const OUT = join(process.env.ART_OUT ?? join(ROOT, "art", "out"), "dunes", "panels");
const PUB = join(ROOT, "public", "worlds", "dunes", "hi");
mkdirSync(OUT, { recursive: true });
mkdirSync(PUB, { recursive: true });

function frontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*("[^"]*"|\[.*\]|[^#]*?)\s*(#.*)?$/);
    if (!kv) continue;
    let v = kv[2];
    if (v.startsWith("[")) v = JSON.parse(v);
    else if (v.startsWith('"')) v = JSON.parse(v);
    else if (v === "true" || v === "false") v = v === "true";
    else if (/^\d+$/.test(v)) v = Number(v);
    out[kv[1]] = v;
  }
  return out;
}

const dir = join(ROOT, "content", "shop");
const products = readdirSync(dir)
  .filter((f) => f.endsWith(".mdx") && !f.startsWith("_"))
  .sort()
  .map((f) => ({ slug: f.replace(/\.mdx$/, ""), ...frontmatter(readFileSync(join(dir, f), "utf8")) }))
  .filter((p) => !p.draft)
  .map((p) => ({ slug: p.slug, title: p.title, tagline: p.tagline, price: p.price, tier: p.tier, accent: p.accent ?? "#ffb84d", cover: p.cover, tags: (p.tags ?? []).slice(0, 3) }));

writeFileSync(join(PUB, "panels.json"), JSON.stringify(products));

// Layout (px) on a 720 x 1280 portrait card.
const W = 720;
const H = 1280;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const price = (p) => `${p.tier === "made-to-order" ? "from " : ""}$${Math.round(p.price / 100)}`;

function wrap(text, max) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) {
      lines.push(cur.trim());
      cur = w;
    } else cur += " " + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.slice(0, 3);
}

for (const [i, p] of products.entries()) {
  const cover = await sharp(join(ROOT, "public", p.cover)).resize(624, 351, { fit: "cover" }).png().toBuffer();
  const rounded = await sharp(cover)
    .composite([{ input: Buffer.from(`<svg width="624" height="351"><rect width="624" height="351" rx="28" fill="#fff"/></svg>`), blend: "dest-in" }])
    .png()
    .toBuffer();
  const tag = p.tags.map((t, k) => `<g transform="translate(${48 + k * 170},1018)"><rect width="156" height="52" rx="26" fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="3"/><text x="78" y="35" font-size="24" text-anchor="middle" fill="#fff" fill-opacity="0.85" font-family="Helvetica, Arial" font-weight="600">${esc(t).slice(0, 10)}</text></g>`).join("");
  const title = wrap(p.title, 16).map((l, k) => `<text x="48" y="${560 + k * 76}" font-size="68" font-weight="800" fill="#fff" font-family="Helvetica, Arial">${esc(l)}</text>`).join("");
  const tagline = wrap(p.tagline, 34).map((l, k) => `<text x="48" y="${760 + k * 42}" font-size="30" fill="#fff" fill-opacity="0.78" font-family="Helvetica, Arial">${esc(l)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${p.accent}"/><stop offset="1" stop-color="#1a0f08"/></linearGradient>
      <radialGradient id="glow" cx="0.8" cy="0.1" r="0.8"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <rect width="${W}" height="${H}" fill="url(#glow)"/>
    <g fill="#fff"><circle cx="54" cy="52" r="9" fill-opacity="0.9"/><circle cx="84" cy="52" r="9" fill-opacity="0.6"/><circle cx="114" cy="52" r="9" fill-opacity="0.35"/></g>
    <text x="672" y="62" font-size="26" text-anchor="end" fill="#fff" fill-opacity="0.8" font-family="Helvetica, Arial" font-weight="700" letter-spacing="4">${p.tier === "made-to-order" ? "MADE TO ORDER" : "GRAB &amp; GO"}</text>
    <rect x="44" y="94" width="632" height="359" rx="32" fill="#000" fill-opacity="0.25"/>
    ${title}${tagline}
    ${tag}
    <rect x="48" y="1120" width="624" height="104" rx="52" fill="#fff"/>
    <text x="100" y="1186" font-size="40" font-weight="800" fill="#1a0f08" font-family="Helvetica, Arial">${esc(price(p))}</text>
    <text x="620" y="1186" font-size="34" font-weight="700" text-anchor="end" fill="${p.accent}" font-family="Helvetica, Arial">Get it  →</text>
  </svg>`;
  await sharp(Buffer.from(svg))
    .composite([{ input: rounded, top: 98, left: 48 }])
    .png()
    .toFile(join(OUT, `panel-${i}.png`));
  console.log(`[panels] ${i} ${p.slug}`);
}
