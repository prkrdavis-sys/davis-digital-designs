import * as THREE from "three";
import type { Product } from "@/worlds/scenes/dunes/data";

/**
 * A shop product as a portrait template card (720 x 1280), drawn live from
 * the product's cover. Mirrors the layout art/worlds/dunes/panels.mjs
 * rasterizes for the Cycles stills.
 */
const W = 720;
const H = 1280;
const FONT = "Helvetica, Arial, sans-serif";

function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/)) {
    if ((cur + " " + w).trim().length > max) {
      lines.push(cur.trim());
      cur = w;
    } else cur += " " + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.slice(0, 3);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function price(p: Product) {
  return `${p.tier === "made-to-order" ? "from " : ""}$${Math.round(p.price / 100)}`;
}

export function drawPanel(p: Product, cover: CanvasImageSource | undefined): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, p.accent);
  bg.addColorStop(1, "#1a0f08");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.8, H * 0.1, 0, W * 0.8, H * 0.1, H * 0.8);
  glow.addColorStop(0, "rgba(255,255,255,0.35)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  for (const [i, a] of [0.9, 0.6, 0.35].entries()) {
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.beginPath();
    ctx.arc(54 + i * 30, 52, 9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = `700 26px ${FONT}`;
  ctx.textAlign = "right";
  ctx.letterSpacing = "4px";
  ctx.fillText(p.tier === "made-to-order" ? "MADE TO ORDER" : "GRAB & GO", 672, 62);
  ctx.letterSpacing = "0px";
  ctx.textAlign = "left";

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  roundRect(ctx, 44, 94, 632, 359, 32);
  ctx.fill();
  ctx.save();
  roundRect(ctx, 48, 98, 624, 351, 28);
  ctx.clip();
  if (cover) {
    const img = cover as HTMLImageElement;
    const iw = img.naturalWidth || img.width || 1600;
    const ih = img.naturalHeight || img.height || 900;
    const s = Math.max(624 / iw, 351 / ih);
    ctx.drawImage(cover, 48 + (624 - iw * s) / 2, 98 + (351 - ih * s) / 2, iw * s, ih * s);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(48, 98, 624, 351);
  }
  ctx.restore();

  ctx.fillStyle = "#fff";
  ctx.font = `800 68px ${FONT}`;
  wrap(p.title, 16).forEach((l, k) => ctx.fillText(l, 48, 560 + k * 76));
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = `400 30px ${FONT}`;
  wrap(p.tagline, 34).forEach((l, k) => ctx.fillText(l, 48, 760 + k * 42));

  ctx.font = `600 24px ${FONT}`;
  ctx.textAlign = "center";
  p.tags.slice(0, 3).forEach((t, k) => {
    const x = 48 + k * 170;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    roundRect(ctx, x, 1018, 156, 52, 26);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(t.slice(0, 10), x + 78, 1053);
  });
  ctx.textAlign = "left";

  ctx.fillStyle = "#fff";
  roundRect(ctx, 48, 1120, 624, 104, 52);
  ctx.fill();
  ctx.fillStyle = "#1a0f08";
  ctx.font = `800 40px ${FONT}`;
  ctx.fillText(price(p), 100, 1186);
  ctx.fillStyle = p.accent;
  ctx.font = `700 34px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("Get it  \u2192", 620, 1186);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}
