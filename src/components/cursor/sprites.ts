import * as THREE from "three";

/** Sprite shapes drawn once into canvases (white on transparent, tinted in the shader). */
export type SpriteKind =
  | "soft"
  | "petal"
  | "leaf"
  | "snowflake"
  | "crystal"
  | "sparkle"
  | "grain"
  | "bubble"
  | "ring"
  | "bead"
  | "flag"
  | "paper"
  | "reticle"
  | "portal"
  | "spot"
  | "plane";

const cache = new Map<SpriteKind, THREE.CanvasTexture>();

function draw(kind: SpriteKind, ctx: CanvasRenderingContext2D, s: number) {
  const c = s / 2;
  ctx.clearRect(0, 0, s, s);
  ctx.save();
  ctx.translate(c, c);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  switch (kind) {
    case "soft": {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, c);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.25, "rgba(255,255,255,0.7)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(-c, -c, s, s);
      break;
    }
    case "spot": {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, c);
      g.addColorStop(0, "rgba(255,255,255,0.9)");
      g.addColorStop(0.55, "rgba(255,255,255,0.35)");
      g.addColorStop(0.8, "rgba(255,255,255,0.08)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(-c, -c, s, s);
      break;
    }
    case "petal": {
      const g = ctx.createLinearGradient(0, -c, 0, c);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(1, "rgba(255,255,255,0.75)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -c * 0.9);
      ctx.bezierCurveTo(c * 0.75, -c * 0.7, c * 0.7, c * 0.5, 0, c * 0.9);
      ctx.bezierCurveTo(-c * 0.7, c * 0.5, -c * 0.75, -c * 0.7, 0, -c * 0.9);
      ctx.fill();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.moveTo(-c * 0.12, -c * 0.95);
      ctx.lineTo(0, -c * 0.62);
      ctx.lineTo(c * 0.12, -c * 0.95);
      ctx.fill();
      break;
    }
    case "leaf": {
      ctx.beginPath();
      ctx.moveTo(0, -c * 0.9);
      ctx.quadraticCurveTo(c * 0.85, -c * 0.1, 0, c * 0.9);
      ctx.quadraticCurveTo(-c * 0.85, -c * 0.1, 0, -c * 0.9);
      ctx.fill();
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = s * 0.03;
      ctx.beginPath();
      ctx.moveTo(0, -c * 0.8);
      ctx.lineTo(0, c * 0.85);
      for (let i = -3; i <= 3; i++) {
        const y = i * c * 0.2;
        ctx.moveTo(0, y);
        ctx.lineTo(c * 0.35, y - c * 0.18);
        ctx.moveTo(0, y);
        ctx.lineTo(-c * 0.35, y - c * 0.18);
      }
      ctx.stroke();
      break;
    }
    case "snowflake":
    case "crystal": {
      ctx.lineCap = "round";
      ctx.lineWidth = s * (kind === "snowflake" ? 0.055 : 0.035);
      ctx.shadowColor = "rgba(255,255,255,0.9)";
      ctx.shadowBlur = s * 0.05;
      for (let i = 0; i < 6; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI) / 3);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -c * 0.85);
        for (const t of kind === "snowflake" ? [0.35, 0.6] : [0.3, 0.5, 0.7]) {
          const len = c * (kind === "snowflake" ? 0.28 : 0.2) * (1 - t * 0.4);
          ctx.moveTo(0, -c * t);
          ctx.lineTo(len, -c * t - len * 0.8);
          ctx.moveTo(0, -c * t);
          ctx.lineTo(-len, -c * t - len * 0.8);
        }
        ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case "sparkle": {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, c * 0.5);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        ctx.lineTo(Math.cos(a) * c * 0.95, Math.sin(a) * c * 0.95);
        ctx.lineTo(Math.cos(a + Math.PI / 4) * c * 0.14, Math.sin(a + Math.PI / 4) * c * 0.14);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-c * 0.5, -c * 0.5, s * 0.5, s * 0.5);
      break;
    }
    case "grain": {
      const g = ctx.createRadialGradient(-c * 0.15, -c * 0.15, 0, 0, 0, c * 0.6);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.7, "rgba(255,255,255,0.8)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, c * 0.6, c * 0.45, 0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "bubble": {
      // Thin iridescent film: bright rim, faint body, a window highlight.
      const g = ctx.createRadialGradient(0, 0, c * 0.55, 0, 0, c * 0.95);
      g.addColorStop(0, "rgba(255,255,255,0.05)");
      g.addColorStop(0.8, "rgba(255,255,255,0.55)");
      g.addColorStop(0.93, "rgba(255,255,255,0.95)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, c * 0.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.ellipse(-c * 0.35, -c * 0.4, c * 0.16, c * 0.09, -0.7, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "ring": {
      ctx.lineWidth = s * 0.06;
      ctx.shadowColor = "rgba(255,255,255,1)";
      ctx.shadowBlur = s * 0.08;
      ctx.beginPath();
      ctx.arc(0, 0, c * 0.78, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "portal": {
      for (let i = 0; i < 3; i++) {
        ctx.lineWidth = s * (0.05 - i * 0.012);
        ctx.globalAlpha = 1 - i * 0.28;
        ctx.beginPath();
        ctx.arc(0, 0, c * (0.8 - i * 0.16), i * 1.3, i * 1.3 + Math.PI * 1.55);
        ctx.stroke();
      }
      break;
    }
    case "bead": {
      const g = ctx.createRadialGradient(-c * 0.25, -c * 0.3, c * 0.05, 0, 0, c * 0.8);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.5, "rgba(255,255,255,0.75)");
      g.addColorStop(0.85, "rgba(255,255,255,0.35)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, c * 0.8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "flag": {
      ctx.beginPath();
      ctx.moveTo(-c * 0.7, -c * 0.55);
      ctx.quadraticCurveTo(0, -c * 0.75, c * 0.7, -c * 0.5);
      ctx.lineTo(c * 0.65, c * 0.5);
      ctx.quadraticCurveTo(0, c * 0.3, -c * 0.7, c * 0.55);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "paper": {
      ctx.fillRect(-c * 0.55, -c * 0.4, c * 1.1, c * 0.8);
      break;
    }
    case "plane": {
      // Folded paper plane seen from above, nose up. Two tones sell the fold.
      ctx.fillStyle = "rgba(255,255,255,1)";
      ctx.beginPath();
      ctx.moveTo(0, -c * 0.92);
      ctx.lineTo(c * 0.62, c * 0.72);
      ctx.lineTo(0, c * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(214,214,222,1)";
      ctx.beginPath();
      ctx.moveTo(0, -c * 0.92);
      ctx.lineTo(-c * 0.62, c * 0.72);
      ctx.lineTo(0, c * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(150,150,165,1)";
      ctx.lineWidth = s * 0.018;
      ctx.beginPath();
      ctx.moveTo(0, -c * 0.92);
      ctx.lineTo(0, c * 0.62);
      ctx.stroke();
      break;
    }
    case "reticle": {
      ctx.lineWidth = s * 0.03;
      ctx.beginPath();
      ctx.arc(0, 0, c * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = s * 0.022;
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI) / 2);
        ctx.beginPath();
        ctx.moveTo(0, -c * 0.95);
        ctx.lineTo(0, -c * 0.72);
        ctx.moveTo(0, -c * 0.5);
        ctx.lineTo(0, -c * 0.18);
        ctx.stroke();
        ctx.restore();
      }
      for (let i = 0; i < 24; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI) / 12);
        ctx.fillRect(-s * 0.004, -c * 0.62, s * 0.008, i % 6 === 0 ? c * 0.1 : c * 0.05);
        ctx.restore();
      }
      break;
    }
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
  ctx.restore();
}

export function sprite(kind: SpriteKind, size = 128): THREE.CanvasTexture {
  const hit = cache.get(kind);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  draw(kind, ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  cache.set(kind, tex);
  return tex;
}
