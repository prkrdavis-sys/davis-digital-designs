#!/usr/bin/env node
/**
 * Browser screenshots of the Everest world on /about (headless Chromium, SwiftShader).
 *
 *   node art/worlds/everest/shots.mjs [--theme day|night] [--low] [--t 0.3,1.5,...] [--names a,b,...]
 *                                     [--out dir] [--hide-ui] [--size 1440x900] [--jpeg dir]
 *
 * Needs a dev server (`npx next dev -p 3456`) and Playwright installed outside the repo
 * (it is not a project dependency):
 *   npm i --prefix /tmp/pw playwright@1 && npx -y playwright@1 install chromium
 * Override the location with PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);

const theme = opt("theme", "day");
const low = flag("low");
const ts = opt("t", "0.1,0.5,1.5,2.5,3.5,4.5,5.5").split(",").map(Number);
const names = opt("names", "")
  .split(",")
  .filter(Boolean);
const out = opt("out", "/tmp/everest-shots");
const jpegDir = opt("jpeg", "");
const [vw, vh] = opt("size", "1440x900").split("x").map(Number);
const url = opt("url", "http://localhost:3456/about");
const settle = Number(opt("settle", "2500"));

const { chromium } = await import(process.env.PLAYWRIGHT ?? "/tmp/pw/node_modules/playwright/index.mjs");
mkdirSync(out, { recursive: true });
if (jpegDir) mkdirSync(jpegDir, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console.log(`[console.${m.type()}]`, m.text().slice(0, 400));
});
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 400)));
await page.addInitScript(
  ([th, lo]) => {
    localStorage.setItem("ddd:theme", th);
    localStorage.setItem("ddd:low-power", lo ? "true" : "false");
    sessionStorage.setItem("ddd:perf-dismissed", "1");
  },
  [theme === "night" ? "dark" : "light", low],
);
const t0 = Date.now();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
if (flag("hide-ui")) {
  await page.addStyleTag({ content: "main, header, footer, nav, [role=status] { opacity: 0 !important; }" });
}
await page.waitForFunction(() => window.__ddd?.engine?.readyScenes?.has("everest"), null, { timeout: 300000, polling: 500 });
console.log(`[shots] everest ready after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
// The director fades the canvas in over ~80 frames, which takes a while at software-rendered frame rates.
const opaque = () => page.waitForFunction(() => parseFloat(document.querySelector("canvas[data-engine]")?.style.opacity ?? "0") > 0.995, null, { timeout: 300000, polling: 300 });

for (let k = 0; k < ts.length; k++) {
  const t = ts[k];
  await page.evaluate((tt) => window.__ddd.scrollToT(tt), t);
  await page.waitForFunction((tt) => Math.abs(window.__ddd.engine.rawT - tt) < 0.02, t, { timeout: 120000, polling: 250 });
  // Skip the scroll damping (slow at software-rendered frame rates).
  await page.evaluate(() => {
    const e = window.__ddd.engine;
    e.t = e.rawT;
  });
  await page.waitForTimeout(settle);
  await opaque();
  const info = await page.evaluate(() => {
    const e = window.__ddd.engine;
    const s = window.__ddd.slots.get("everest");
    const c = s?.camera;
    const canvas = document.querySelector("canvas[data-engine]");
    return { t: +e.t.toFixed(3), fps: +e.fps.toFixed(1), cam: c ? [c.position.x, c.position.y, c.position.z].map((v) => +v.toFixed(1)) : null, fov: c ? +c.fov.toFixed(1) : null, opacity: canvas?.style.opacity };
  });
  const name = names[k] ?? `t${String(Math.round(t * 100)).padStart(3, "0")}-${low ? "lo" : theme}`;
  const png = join(out, `${name}.png`);
  await page.screenshot({ path: png });
  if (jpegDir) await sharp(png).resize({ width: Math.min(1600, vw) }).jpeg({ quality: 80, mozjpeg: true }).toFile(join(jpegDir, `${name}.jpg`));
  console.log(`[shots] ${name}`, JSON.stringify(info));
}
await browser.close();
