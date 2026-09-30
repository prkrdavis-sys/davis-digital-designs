/**
 * Designed Low Resources plates for worlds whose Cycles layers have not been
 * rendered yet. Each plate is three depth bands (far sky, subject, foreground)
 * plus a composited poster, so LayerStack can parallax them while scrolling.
 * Re-running a world's `blend <scene> --steps layers` and
 * `node art/images.mjs layers <scene>` replaces these.
 *
 * DNA and museum already have Cycles layers and are left alone.
 *
 * Usage: node art/fallback-lo.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const W = 1920;
const H = 1200;
const ROOT = path.resolve("public/worlds");

let gid = 0;
const uid = (prefix) => `${prefix}${gid++}`;

function svg(body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" overflow="hidden">
  <defs>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="4"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.45"/></feComponentTransfer>
    </filter>
    <radialGradient id="vig" cx="64%" cy="42%" r="78%">
      <stop offset="0.52" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.34"/>
    </radialGradient>
  </defs>
  ${body}
</svg>`;
}

function sky(stops) {
  const cols = stops.map((c, i) => `<stop offset="${(i / (stops.length - 1)).toFixed(3)}" stop-color="${c}"/>`).join("");
  return `<linearGradient id="sky" x1="0" y1="0" x2="0.15" y2="1">${cols}</linearGradient><rect width="${W}" height="${H}" fill="url(#sky)"/>`;
}

function rad(id, stops, cx = "50%", cy = "50%", r = "50%") {
  const cols = stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("");
  return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${cols}</radialGradient>`;
}

function glow(cx, cy, r, color, opacity = 0.9) {
  const id = uid("gl");
  return `<defs>${rad(id, [[0, color, opacity], [1, color, 0]])}</defs><ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 0.72}" fill="url(#${id})"/>`;
}

function grain(opacity) {
  return `<rect width="${W}" height="${H}" filter="url(#grain)" opacity="${opacity}"/>`;
}

function vignette() {
  return `<rect width="${W}" height="${H}" fill="url(#vig)"/>`;
}

function around(x, y, scale, inner) {
  return `<g transform="translate(${x} ${y}) scale(${scale}) translate(${-x} ${-y})">${inner}</g>`;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stars(seed, n, yMax, opacity) {
  const rand = rng(seed);
  let out = "";
  for (let i = 0; i < n; i++) {
    const x = rand() * W;
    const y = rand() * yMax;
    const r = rand() > 0.92 ? 1.7 : 0.8;
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="#fff" opacity="${(opacity * (0.45 + rand() * 0.55)).toFixed(2)}"/>`;
  }
  return out;
}

function sphere(cx, cy, r, light, mid, dark) {
  const id = uid("sp");
  return `<defs>${rad(id, [[0, light], [0.45, mid], [1, dark]], "36%", "32%", "68%")}</defs><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id})"/>`;
}

function gloss(cx, cy, r) {
  return `<ellipse cx="${cx - r * 0.28}" cy="${cy - r * 0.32}" rx="${r * 0.28}" ry="${r * 0.16}" fill="#fff" opacity="0.72"/>` +
    `<ellipse cx="${cx + r * 0.22}" cy="${cy + r * 0.28}" rx="${r * 0.16}" ry="${r * 0.08}" fill="#fff" opacity="0.18"/>`;
}

function starShape(cx, cy, r, fill) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rads = i % 2 ? r * 0.46 : r;
    pts.push(`${(cx + Math.cos(a) * rads).toFixed(1)},${(cy + Math.sin(a) * rads).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${fill}" stroke="${fill}" stroke-width="${(r * 0.16).toFixed(1)}" stroke-linejoin="round"/>` + gloss(cx, cy - r * 0.05, r * 0.7);
}

function torus(cx, cy, r, fill, stroke) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${fill}" stroke-width="${(r * 0.38).toFixed(1)}"/>` +
    `<path d="M${cx - r * 0.2} ${cy - r * 0.72} A${r} ${r} 0 0 1 ${cx + r * 0.72} ${cy - r * 0.15}" fill="none" stroke="${stroke}" stroke-width="${(r * 0.08).toFixed(1)}" stroke-linecap="round" opacity="0.8"/>`;
}

function pill(x, y, w, h, fill) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"/>` +
    `<ellipse cx="${x + w * 0.28}" cy="${y + h * 0.38}" rx="${w * 0.16}" ry="${h * 0.18}" fill="#fff" opacity="0.45"/>`;
}

function bubble(cx, cy, r, fill, tail = 1) {
  const ty = cy + r * 0.82;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" fill-opacity="0.9"/>` +
    (tail ? `<path d="M${cx - r * 0.15} ${cy + r * 0.72} Q${cx - r * 0.45} ${ty + r * 0.35} ${cx - r * 0.05} ${ty} Q${cx + r * 0.05} ${cy + r * 0.9} ${cx + r * 0.12} ${cy + r * 0.7} Z" fill="${fill}" fill-opacity="0.9"/>` : "") +
    `<ellipse cx="${cx - r * 0.28}" cy="${cy - r * 0.32}" rx="${r * 0.22}" ry="${r * 0.12}" fill="#fff" opacity="0.75"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-opacity="0.45" stroke-width="2"/>`;
}

function arch(x, y, w, h, stroke, sw, fill) {
  const r = w / 2;
  return `<path d="M${x} ${y + h} V${y + r} A${r} ${r * 1.05} 0 0 1 ${x + w} ${y + r} V${y + h}" fill="${fill || "none"}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
}

function paperPlane(x, y, s, rot, paper, shade) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
    <polygon points="78,-6 0,0 22,-2" fill="${paper}"/>
    <polygon points="78,5 0,0 18,3" fill="${shade}"/>
    <polygon points="0,0 -6,14 16,2" fill="${shade}"/>
    <path d="M8,-1 L70,-4" stroke="#fff" stroke-opacity="0.45" stroke-width="1.2" fill="none"/>
  </g>`;
}

function monolith(x, y, h, night) {
  const w = 46;
  const body = night ? "#1a1830" : "#241c18";
  const edge = night ? "#d8d0ea" : "#f3eadc";
  const panel = night ? "#ffdca8" : "#ffb85f";
  return `<polygon points="${x},${y} ${x + w * 0.18},${y - h} ${x + w},${y}" fill="${body}"/>
    <polygon points="${x + w * 0.18},${y - h} ${x + w * 0.32},${y - h + 8} ${x + w},${y} ${x + w * 0.82},${y}" fill="${edge}" opacity="0.35"/>
    <rect x="${x + 12}" y="${y - h * 0.62}" width="18" height="${Math.max(28, h * 0.18)}" rx="2" fill="${panel}" opacity="${night ? 0.95 : 0.8}"/>`;
}

function dune(y, amp, color, shift) {
  return `<path d="M0 ${y + 40} C ${280 + shift} ${y - amp} ${520} ${y + amp * 0.4} ${860 + shift * 0.3} ${y - amp * 0.2} C ${1180} ${y - amp * 0.85} ${1420} ${y + amp * 0.3} ${W} ${y - 20} V${H} H0 Z" fill="${color}"/>`;
}

function skyline(pts, fill) {
  const d = [`M0 ${H}`, `L0 ${pts[0][1] + 36}`];
  for (const [x, y] of pts) d.push(`L${x} ${y}`);
  d.push(`L${W} ${pts[pts.length - 1][1] + 28}`, `L${W} ${H}`, "Z");
  return `<path d="${d.join(" ")}" fill="${fill}"/>`;
}

function cumulus(cx, cy, scale, fill, opacity = 1) {
  const lumps = [
    [0, 0, 1],
    [-0.85, 0.18, 0.7],
    [0.9, 0.22, 0.74],
    [-0.28, -0.5, 0.58],
    [0.42, -0.38, 0.52],
  ];
  return lumps
    .map(([x, y, r]) => `<circle cx="${cx + x * 90 * scale}" cy="${cy + y * 70 * scale}" r="${r * 78 * scale}" fill="${fill}" opacity="${opacity}"/>`)
    .join("");
}

/** @type {Record<string, { s: number[], draw: (v: "day"|"night", s: number) => { back: string, mid: string, near: string } }>} */
const SCENES = {
  garden: {
    s: [0, 0.5, 1],
    draw: (v, s) => {
      const night = v === "night";
      const push = 0.92 + s * 0.28;
      const back =
        sky(night ? ["#07061a", "#1a1440", "#3a2868", "#120818"] : ["#8fa8ff", "#c9b6ff", "#ffd0e4", "#ffd7c2"]) +
        glow(1460, night ? 220 : 260, 420, night ? "#6a5cff" : "#fff4e4", night ? 0.35 : 0.85) +
        `<ellipse cx="1100" cy="980" rx="920" ry="210" fill="${night ? "#12102a" : "#d5def8"}" opacity="0.95"/>` +
        `<ellipse cx="1180" cy="1005" rx="640" ry="90" fill="${night ? "#1c1840" : "#f7f4ff"}" opacity="${night ? 0.5 : 0.55}"/>` +
        (night ? stars(3, 70, 520, 0.85) : "") +
        grain(night ? 0.18 : 0.1) +
        vignette();
      const sculptures =
        `<rect x="1040" y="760" width="620" height="28" rx="14" fill="${night ? "#2a2448" : "#f4efe8"}"/>` +
        `<rect x="1120" y="788" width="460" height="18" rx="9" fill="${night ? "#1a1636" : "#e7e0d8"}"/>` +
        sphere(1510, 640, 78, "#ffffff", night ? "#c9d4ee" : "#d5dbe8", night ? "#6a7394" : "#9aa3b8") +
        starShape(1240, 520, 120, night ? "#ffcf4d" : "#ffd56a") +
        torus(1410, 500, 70, night ? "#b996ff" : "#c4a4ff", "#fff") +
        pill(1560, 560, 150, 46, night ? "#6fe0b0" : "#8fe0bd") +
        pill(1588, 618, 118, 40, night ? "#ff8fc0" : "#ff9cc2") +
        pill(1610, 668, 86, 34, night ? "#ffd76f" : "#ffe08f") +
        `<path d="M1680 820 V640 Q1820 560 1960 640 V820" fill="none" stroke="${night ? "#7f9dff" : "#8fb0ff"}" stroke-width="34" stroke-linejoin="round"/>` +
        `<text x="1325" y="730" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="150" font-weight="700" fill="${night ? "#fff6fb" : "#ffffff"}" opacity="0.94">D</text>`;
      const mid = around(1380, 620, push, `<g transform="translate(${s * 36} ${-s * 50})">${sculptures}</g>`);
      const near =
        `<ellipse cx="1760" cy="1080" rx="420" ry="90" fill="${night ? "#0c0a18" : "#f6f1ea"}" opacity="0.55"/>` +
        sphere(1860, 860, 110 + s * 30, "#ffffff", night ? "#ffd0ea" : "#ffe4f1", night ? "#ff7eb6" : "#ffb3d4") +
        `<rect x="1500" y="${980 + s * 40}" width="280" height="70" rx="16" fill="${night ? "#241c40" : "#fff"}" opacity="0.35"/>`;
      return { back, mid, near };
    },
  },
  doors: {
    s: [0, 0.5, 1],
    draw: (v, s) => {
      const night = v === "night";
      const wall = night ? "#141628" : "#f3e4ea";
      const floor = night ? "#0e101c" : "#e7d5cf";
      const back =
        sky(night ? ["#070814", "#16182e", "#2a2450"] : ["#fff6fb", "#f6d5e4", "#efe4f8"]) +
        `<polygon points="640,${H} 1280,${H} 1040,180 820,180" fill="${wall}"/>` +
        `<polygon points="700,${H} 1500,${H} 1180,420 980,420" fill="${floor}" opacity="0.9"/>` +
        glow(1080, 280, 260, night ? "#cbb6ff" : "#fff6ea", night ? 0.45 : 0.8) +
        grain(0.12) +
        vignette();
      const doors = [
        ["#8fd08a", "#1f6b38"],
        ["#7f97ff", "#5cc3d2"],
        ["#ff5c9d", "#3edcff"],
        ["#eaf4ff", "#ffffff"],
        ["#ffb85f", "#c46a32"],
      ];
      const portal = (i, layer) => {
        const [fill, stroke] = doors[i];
        const nearness = i / 4;
        const w = 78 + nearness * 250 + s * 24;
        const h = 150 + nearness * 360 + s * 20;
        const x = 980 + nearness * 460 + s * 50;
        const y = 430 - nearness * 40 - s * 16;
        const open = Math.abs(s - nearness) < 0.34 ? 0.92 : 0.42;
        const sw = 4 + nearness * 10;
        return (
          arch(x, y, w, h, stroke, sw, "none") +
          `<path d="M${x + sw} ${y + h} V${y + w / 2} A${w / 2 - sw} ${(w / 2 - sw) * 1.02} 0 0 1 ${x + w - sw} ${y + w / 2} V${y + h} Z" fill="${fill}" opacity="${layer === "near" ? 0.2 : open}"/>`
        );
      };
      const mid = doors.map((_, i) => (i < 4 ? portal(i, "mid") : "")).join("");
      const near = portal(4, "near");
      return { back, mid, near };
    },
  },
  bubbles: {
    s: [0, 0.5, 1],
    draw: (v, s) => {
      const night = v === "night";
      const back =
        sky(night ? ["#120e28", "#3a2168", "#1a1440"] : ["#fff1f6", "#ffe4a8", "#b9d0ff"]) +
        glow(1500, 280, 380, night ? "#ff8fc0" : "#fff", 0.4) +
        `<ellipse cx="400" cy="${820 - s * 20}" rx="460" ry="120" fill="${night ? "#2a2158" : "#fff"}" opacity="0.35"/>` +
        `<ellipse cx="1200" cy="${700 - s * 30}" rx="520" ry="140" fill="${night ? "#241848" : "#fff"}" opacity="0.4"/>` +
        (night ? stars(9, 50, 480, 0.7) : "") +
        grain(0.1) +
        vignette();
      const colors = night ? ["#ffa6d0", "#a3b6ff", "#cdb0ff", "#ffe08f", "#ffffff"] : ["#ff9cc2", "#ffffff", "#9dbcff", "#ffe08f", "#ffd0ea"];
      let mid = "";
      const layout = [
        [1180, 640, 92],
        [1420, 420, 120],
        [1680, 560, 70],
        [1280, 300, 64],
        [1560, 760, 86],
        [1100, 480, 48],
        [1760, 340, 54],
      ];
      layout.forEach(([x, y, r], i) => {
        mid += bubble(x + s * 30, y - s * 160, r * (0.9 + s * 0.15), colors[i % colors.length], i % 3 !== 2);
      });
      const near = bubble(1720, 980 - s * 80, 210, night ? "#ffb3dc" : "#ffffff", 0) + bubble(1880, 640, 90, night ? "#a3b6ff" : "#ffe08f", 1);
      return { back, mid, near };
    },
  },
  diorama: {
    s: [0, 1, 2],
    draw: (v, s) => {
      const night = v === "night";
      const zoom = 1.35 - s * 0.28;
      const back =
        sky(night ? ["#0c0a1c", "#2a1848", "#120e28"] : ["#ffb080", "#ff6e4a", "#6a78c4"]) +
        glow(1500, night ? 180 : 240, 300, night ? "#ffd392" : "#fff1c9", night ? 0.25 : 0.7) +
        (night ? stars(11, 60, 500, 0.8) : `<circle cx="1540" cy="210" r="36" fill="#fff6df"/>`) +
        grain(0.14) +
        vignette();
      const island =
        `<ellipse cx="1280" cy="780" rx="${520}" ry="150" fill="${night ? "#1a2840" : "#6a9a52"}"/>` +
        `<ellipse cx="1240" cy="750" rx="340" ry="80" fill="${night ? "#243628" : "#b7d98a"}"/>` +
        `<ellipse cx="1360" cy="800" rx="120" ry="36" fill="${night ? "#0c1830" : "#6f92c4"}" opacity="0.8"/>` +
        `<rect x="1160" y="690" width="36" height="48" fill="${night ? "#d7e6ff" : "#f4f7ea"}"/>` +
        `<path d="M1178 690 L1148 650 L1208 650 Z" fill="${night ? "#9ae8a4" : "#2f6b3a"}"/>` +
        `<path d="M1480 720 C1490 640 1520 600 1505 560" fill="none" stroke="${night ? "#6dffab" : "#5cc3d2"}" stroke-width="8"/>` +
        `<circle cx="1505" cy="548" r="16" fill="none" stroke="${night ? "#ff6fae" : "#e58bbd"}" stroke-width="6"/>` +
        `<rect x="1320" y="700" width="70" height="40" rx="6" fill="${night ? "#1a0e28" : "#fff6fb"}" stroke="${night ? "#ff4fa0" : "#ff5c9d"}" stroke-width="3"/>` +
        `<circle cx="1600" cy="730" r="28" fill="${night ? "#16324a" : "#f4fbff"}" stroke="#fff" stroke-width="3"/>` +
        `<polygon points="1688,760 1710,680 1732,760" fill="${night ? "#d8d2ea" : "#f6efe4"}"/>` +
        `<polygon points="1088,760 1110,700 1132,760" fill="${night ? "#cfd9ea" : "#f7f4ef"}"/>`;
      const mid = around(1280, 740, zoom, island);
      const near =
        `<ellipse cx="1500" cy="${1040 + (2 - s) * 20}" rx="${640 - s * 80}" ry="${120 - s * 16}" fill="${night ? "#0a0c16" : "#2a241c"}" opacity="0.28"/>` +
        `<ellipse cx="1880" cy="640" rx="${160 + (2 - s) * 40}" ry="70" fill="${night ? "#1a1630" : "#f7e2c8"}" opacity="0.4"/>`;
      return { back, mid, near };
    },
  },
  greenhouse: {
    s: [0, 1.3, 2.6, 3.8],
    draw: (v, s) => {
      const night = v === "night";
      const t = s / 3.8;
      const iron = night ? "#d5e2f2" : "#f7f3ea";
      const leaf = night ? "#3d8f55" : "#1f6b38";
      const back =
        sky(night ? ["#0c1428", "#1c3058", "#243048"] : ["#f4f7ea", "#f6c47c", "#8fd08a"]) +
        glow(1500, 260 - t * 80, 460, night ? "#a9bfff" : "#fff1d4", night ? 0.35 : 0.75) +
        `<polygon points="760,${H} 1680,${H} 1320,${720 - t * 80} 980,${720 - t * 80}" fill="${night ? "#1a2418" : "#d5e2bc"}"/>` +
        grain(0.12) +
        vignette();
      let ribs = "";
      const count = 6;
      for (let i = 0; i < count; i++) {
        const k = i / (count - 1);
        const w = 80 + k * (420 + t * 80);
        const h = 220 + k * (520 - t * 120);
        const x = 1500 - w / 2 + (k - 0.5) * 40;
        const y = 180 + (1 - k) * 80 - t * 60;
        ribs += arch(x, y, w, h, iron, Math.max(3, 8 * k), "none");
      }
      ribs += `<path d="M1080 ${640 - t * 40} H1680 M1120 ${480 - t * 80} H1640" stroke="${iron}" stroke-width="5" opacity="0.7"/>`;
      const plants =
        `<ellipse cx="1220" cy="${860 - t * 40}" rx="90" ry="28" fill="${night ? "#234028" : "#2f6b3a"}"/>` +
        `<path d="M1220 ${840 - t * 40} C1180 700 1160 620 1240 520" fill="none" stroke="${leaf}" stroke-width="10" stroke-linecap="round"/>` +
        `<ellipse cx="1200" cy="620" rx="46" ry="18" fill="${leaf}" transform="rotate(-30 1200 620)" opacity="0.9"/>` +
        `<ellipse cx="1260" cy="660" rx="40" ry="16" fill="${night ? "#9ae8a4" : "#3f8f52"}" transform="rotate(24 1260 660)"/>` +
        `<ellipse cx="1560" cy="${900 - t * 20}" rx="70" ry="22" fill="${night ? "#2a241c" : "#c47a4a"}"/>` +
        `<circle cx="1560" cy="${820 - t * 30}" r="48" fill="${night ? "#1e6b3a" : "#2f7a40"}"/>` +
        `<circle cx="1520" cy="${790 - t * 30}" r="28" fill="${night ? "#3d8f55" : "#4ea35a"}"/>`;
      const mid = t > 0.72 ? ribs : plants + ribs;
      const near =
        `<path d="M1680 0 V${H} M1760 0 V${H} M1600 ${200 + t * 40} H${W}" stroke="${iron}" stroke-width="${10 - t * 3}" opacity="0.85"/>` +
        `<ellipse cx="1820" cy="${980 - t * 60}" rx="70" ry="24" fill="${leaf}" opacity="0.8"/>`;
      return { back, mid, near };
    },
  },
  pinball: {
    s: [0, 1.4, 2.8, 4],
    draw: (v, s) => {
      const night = v === "night";
      const t = s / 4;
      const wood = night ? "#1a0e28" : "#f6e7ef";
      const ink = night ? "#ff4fa0" : "#ff5c9d";
      const back =
        sky(night ? ["#07040e", "#1a0c24", "#0a0614"] : ["#ffe8f2", "#ffd0e4", "#d7f6ff"]) +
        `<polygon points="${520 + t * 80},${H} ${1700 - t * 40},${H} ${1280 + t * 20},${260 - t * 40} ${980 - t * 10},${260 - t * 40}" fill="${wood}"/>` +
        `<polygon points="${1280 + t * 20},${260 - t * 40} ${980 - t * 10},${260 - t * 40} ${900},${80} ${1360},${80}" fill="${night ? "#120818" : "#fff"}" stroke="${ink}" stroke-width="8"/>` +
        `<text x="1130" y="190" text-anchor="middle" font-family="Georgia, serif" font-size="42" letter-spacing="6" fill="${ink}">PLAY</text>` +
        grain(night ? 0.2 : 0.12) +
        vignette();
      const ballY = 860 - t * 520;
      const ballX = 1180 + Math.sin(t * 6) * 80;
      let lanes = "";
      for (let i = 0; i < 5; i++) {
        const x0 = 700 + i * 180;
        lanes += `<line x1="${x0}" y1="${H - 40}" x2="${1040 + i * 40}" y2="340" stroke="${night ? "#2fe6ff" : "#3edcff"}" stroke-width="3" opacity="0.55"/>`;
      }
      const bumper = (x, y) =>
        `<circle cx="${x}" cy="${y}" r="42" fill="${night ? "#2fe6ff" : "#3edcff"}"/>` +
        `<circle cx="${x}" cy="${y}" r="18" fill="${night ? "#ffe066" : "#fff"}"/>` +
        `<circle cx="${x}" cy="${y}" r="42" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="3"/>`;
      const mid =
        lanes +
        bumper(1120, 520 - t * 40) +
        bumper(1320, 460 - t * 30) +
        bumper(1220, 660 - t * 50) +
        `<circle cx="${ballX}" cy="${ballY}" r="18" fill="${night ? "#ffe066" : "#f4f1ea"}" stroke="#c9a227" stroke-width="3"/>` +
        (t > 0.7 ? `<circle cx="${ballX - 70}" cy="${ballY + 40}" r="16" fill="#fff"/><circle cx="${ballX + 60}" cy="${ballY + 24}" r="16" fill="${night ? "#ffd84a" : "#fff"}"/>` : "");
      const flip = 1 - t;
      const near =
        `<g opacity="${0.35 + flip * 0.65}">` +
        `<polygon points="980,${1040} 1180,${980} 1200,${1020} 1020,${1100}" fill="${night ? "#ff4fa0" : "#ffffff"}" stroke="${ink}" stroke-width="4"/>` +
        `<polygon points="1560,${1040} 1360,${980} 1340,${1020} 1520,${1100}" fill="${night ? "#ff4fa0" : "#ffffff"}" stroke="${ink}" stroke-width="4"/>` +
        `</g>` +
        `<rect x="900" y="1120" width="740" height="80" rx="18" fill="${night ? "#120818" : "#fff6fb"}" opacity="0.85"/>`;
      return { back, mid, near };
    },
  },
  snowglobe: {
    s: [0, 1.2, 2.4, 3.6],
    draw: (v, s) => {
      const night = v === "night";
      const inside = s > 0.4 && s < 3.2;
      const back = inside
        ? sky(night ? ["#0e1830", "#1a3058", "#0e1830"] : ["#e7f2ff", "#d7ecff", "#f7fbff"]) +
          (night ? `<path d="M200 180 Q960 40 1700 200 Q1200 120 200 180" fill="#86e8cc" opacity="0.25"/>` + stars(21, 40, 360, 0.6) : glow(1500, 180, 280, "#fff", 0.7)) +
          grain(0.1) +
          vignette()
        : sky(night ? ["#141820", "#2a3348", "#1a2030"] : ["#f6efe6", "#f3d7c4", "#d7e4f2"]) +
          glow(520, 300, 240, night ? "#ffd392" : "#fff6e8", 0.45) +
          glow(1500, 240, 200, night ? "#86e8cc" : "#ffffff", 0.25) +
          grain(0.12) +
          vignette();
      let mid = "";
      if (!inside) {
        const shake = s > 3 ? 18 : 0;
        mid =
          `<ellipse cx="1320" cy="900" rx="340" ry="48" fill="${night ? "#1a140e" : "#4a2e1c"}" opacity="0.35"/>` +
          `<rect x="1148" y="760" width="344" height="92" rx="12" fill="${night ? "#3a2c22" : "#8a5a34"}"/>` +
          `<rect x="1224" y="742" width="190" height="22" rx="4" fill="${night ? "#c9a36a" : "#e6c48a"}"/>` +
          `<circle cx="1320" cy="${548 - shake}" r="214" fill="${night ? "#16324a" : "#f4fbff"}" fill-opacity="0.82" stroke="${night ? "#d5e8ff" : "#ffffff"}" stroke-width="12"/>` +
          `<path d="M1180 690 Q1320 640 1460 690 Q1400 720 1320 710 Q1240 722 1180 690" fill="#fff" opacity="0.95"/>` +
          `<polygon points="1260,690 1320,560 1380,690" fill="#fff"/>` +
          `<polygon points="1210,700 1248,620 1286,700" fill="${night ? "#1d4a32" : "#2f6b3a"}"/>` +
          `<polygon points="1360,705 1404,615 1448,705" fill="${night ? "#163c2a" : "#245c34"}"/>` +
          (night ? `<rect x="1308" y="600" width="22" height="14" rx="2" fill="#ffd392"/>` : "");
        if (s > 3) {
          const rand = rng(4);
          for (let i = 0; i < 28; i++) mid += `<circle cx="${1180 + rand() * 280}" cy="${320 + rand() * 360}" r="${1 + rand() * 2.2}" fill="#fff" opacity="0.85"/>`;
        }
      } else {
        const wide = s > 1.8 ? 1 : 0;
        mid =
          `<ellipse cx="1460" cy="${1080 - wide * 20}" rx="860" ry="${300 + wide * 20}" fill="#fff" opacity="0.96"/>` +
          `<polygon points="${1180},${760} ${1240},${560 - wide * 30} ${1300},${760}" fill="${night ? "#1d4a32" : "#2f6b3a"}"/>` +
          `<polygon points="${1380},${780} ${1460},${520 - wide * 40} ${1540},${780}" fill="${night ? "#163c2a" : "#245c34"}"/>` +
          `<rect x="${1280 + wide * 40}" y="${640 - wide * 20}" width="${160 + wide * 40}" height="90" fill="${night ? "#6b4228" : "#8a5a34"}"/>` +
          `<polygon points="${1260 + wide * 40},${640 - wide * 20} ${1360 + wide * 60},${560 - wide * 30} ${1460 + wide * 80},${640 - wide * 20}" fill="${night ? "#4a3020" : "#6b4228"}"/>` +
          `<rect x="${1330 + wide * 40}" y="${668 - wide * 16}" width="28" height="22" fill="${night ? "#ffd392" : "#fff6df"}"/>` +
          `<rect x="${1388 + wide * 50}" y="${668 - wide * 16}" width="28" height="22" fill="${night ? "#ffd392" : "#fff6df"}"/>` +
          `<ellipse cx="1600" cy="820" rx="70" ry="16" fill="${night ? "#8eb8d4" : "#c5dff5"}"/>`;
      }
      const near = inside
        ? `<polygon points="1680,${H} 1760,520 1880,${H}" fill="${night ? "#0e2418" : "#1d4a32"}"/>` +
          `<polygon points="1800,${H} 1900,640 2000,${H}" fill="${night ? "#163c2a" : "#245c34"}"/>`
        : `<rect x="980" y="1020" width="240" height="150" rx="10" fill="${night ? "#2a241c" : "#f4efe6"}"/>` +
          `<rect x="1004" y="1044" width="190" height="8" rx="2" fill="${night ? "#c9a36a" : "#d9cbb8"}"/>` +
          `<rect x="1004" y="1064" width="150" height="8" rx="2" fill="${night ? "#8a5a34" : "#e7d7c4"}"/>` +
          `<ellipse cx="1860" cy="1040" rx="78" ry="70" fill="${night ? "#3a2c22" : "#f7f1ea"}" stroke="${night ? "#ffd392" : "#e6c48a"}" stroke-width="8"/>` +
          `<ellipse cx="1860" cy="1004" rx="34" ry="16" fill="${night ? "#6b4228" : "#fff"}"/>`;
      return { back, mid, near };
    },
  },
  dunes: {
    s: [0, 1, 2, 3],
    draw: (v, s) => {
      const night = v === "night";
      const back =
        sky(night ? ["#070814", "#1a1848", "#3a2860", "#1a1610"] : ["#ff8a66", "#ffb85f", "#ffe4b5", "#f6d7b0"]) +
        (night ? stars(31, 80, 560, 0.85) + glow(1480, 180, 80, "#f4f1ff", 0.9) : `<circle cx="${1320 - s * 40}" cy="${210 + s * 16}" r="64" fill="#fff6df"/>` + glow(1320 - s * 40, 210 + s * 16, 280, "#fff1c9", 0.85)) +
        `<rect x="0" y="620" width="${W}" height="80" fill="${night ? "#8e98ff" : "#fff"}" opacity="${night ? 0.05 : 0.18}"/>` +
        grain(0.16) +
        vignette();
      const shift = s * 140;
      const mid =
        dune(760, 80, night ? "#3a3428" : "#e8b56a", -shift * 0.2) +
        dune(860, 120, night ? "#2a2418" : "#e39a45", -shift * 0.45) +
        dune(980, 90, night ? "#1a1610" : "#c46a32", -shift * 0.7) +
        monolith(1280 - shift, 860, 280, night) +
        monolith(1560 - shift * 0.6, 900, 210, night) +
        (s > 1.5 ? monolith(1080 - shift * 0.3, 940, 160, night) : "");
      const near = dune(1120, 70, night ? "#12100c" : "#a8562c", -shift) + `<ellipse cx="${1700 - shift}" cy="1080" rx="180" ry="28" fill="#000" opacity="0.12"/>`;
      return { back, mid, near };
    },
  },
  everest: {
    s: [0, 1, 2, 3, 4, 5],
    draw: (v, s) => {
      const night = v === "night";
      const t = s / 5;
      const back =
        sky(night ? ["#05070f", "#10182c", "#1c2c4c"] : ["#8dbcff", "#e7eef6", "#f6e2b0"]) +
        (night ? stars(41, 90, 520, 0.9) + glow(1500, 160, 70, "#f4f7ff", 0.8) : glow(1560, 200, 240, "#fff6df", 0.55)) +
        skyline(
          [
            [80, 760],
            [220, 700],
            [380, 740],
            [540, 660],
            [720, 710],
            [900, 640],
            [1100, 690],
            [1320, 650],
            [1560, 720],
            [1760, 680],
          ],
          night ? "#243044" : "#c5d3e2",
        ) +
        grain(0.14) +
        vignette();
      const climb = 70 + t * 80;
      const massif = skyline(
        [
          [40, 980],
          [180, 900],
          [320, 940],
          [460, 840],
          [600, 900],
          [740, 780],
          [860, 700 - climb * 0.25],
          [980, 560 - climb * 0.45],
          [1080, 760],
          [1240, 860],
          [1420, 800],
          [1620, 900],
          [1820, 860],
        ].map(([x, y]) => [x - s * 18, y]),
        night ? "#d5deea" : "#f7f8fb",
      );
      const pts = [
        [620, 960],
        [760, 880],
        [860, 800],
        [930, 700],
        [990, 580 - climb * 0.2],
        [1020, 500 - climb * 0.15],
      ];
      const n = Math.max(2, Math.round(2 + t * (pts.length - 2)));
      const d = pts.slice(0, n).map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
      const route =
        `<path d="${d}" fill="none" stroke="${night ? "#ffd66e" : "#e2b13a"}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<circle cx="${pts[n - 1][0]}" cy="${pts[n - 1][1]}" r="9" fill="${night ? "#ffe08a" : "#fff3c4"}"/>` +
        (night && t > 0.45 ? pts.slice(2, n).map(([x, y]) => `<circle cx="${x}" cy="${y - 8}" r="3.5" fill="#fff6d0"/>`).join("") : "");
      const mid = massif + route;
      const near = skyline(
        [
          [0, 1120],
          [220, 1060],
          [480, 1100],
          [760, 1030],
          [1040, 1088],
          [1360, 1048],
          [1680, 1104],
        ],
        night ? "#0c1018" : "#7f93a8",
      );
      return { back, mid, near };
    },
  },
  planes: {
    s: [0, 1.2, 2.4, 3],
    draw: (v, s) => {
      const night = v === "night";
      const t = s / 3;
      const back =
        sky(night ? ["#14182e", "#2a2458", "#c4b08a"] : ["#ffd7b0", "#ffa684", "#d7c4ff", "#fff1d8"]) +
        (night ? stars(51, 60, 500, 0.75) + glow(1480, 200, 90, "#f4f1ff", 0.7) : `<circle cx="${1500 - t * 80}" cy="${240 + t * 40}" r="58" fill="#fff6df"/>` + glow(1500 - t * 80, 240, 340, "#fff3df", 0.8)) +
        grain(0.1) +
        vignette();
      const sea = night ? "#3a4470" : "#fff";
      const mid =
        cumulus(380, 900 - t * 30, 1.7, sea, night ? 0.45 : 0.72) +
        cumulus(980, 820 - t * 50, 1.9, night ? "#4a5688" : "#fff8f2", 0.88) +
        cumulus(1520, 760 - t * 70, 1.55, sea, 0.92) +
        paperPlane(1280 + t * 90, 440 - t * 30, 2.1, -18 + t * 6, night ? "#fff4e2" : "#fffaf4", night ? "#e7d3b4" : "#f0ddd0");
      const near =
        cumulus(1760, 980, 1.15, night ? "#2a3358" : "#ffffff", 0.95) +
        paperPlane(1620, 640 - t * 80, 3.1, -20, night ? "#fff4e2" : "#fff", night ? "#e8c99a" : "#f3e0d2") +
        paperPlane(1840, 380, 1.5, -14 - t * 8, night ? "#ffe7c2" : "#fffaf4", "#f0d8c4") +
        (night ? `<circle cx="1710" cy="${690 - t * 80}" r="7" fill="#ffd07e"/>` : "");
      return { back, mid, near };
    },
  },
};

async function raster(body) {
  gid = 0;
  return sharp(Buffer.from(svg(body))).resize(W, H, { fit: "fill" }).webp({ quality: 82, alphaQuality: 80 }).toBuffer();
}

async function main() {
  for (const [scene, spec] of Object.entries(SCENES)) {
    const dirL = path.join(ROOT, scene, "layers");
    const dirP = path.join(ROOT, scene, "posters");
    await mkdir(dirL, { recursive: true });
    await mkdir(dirP, { recursive: true });
    /** @type {{tag:string,s:number,poster:string,width:number,height:number}[]} */
    const index = [];
    for (const variant of ["day", "night"]) {
      for (const s of spec.s) {
        const tag = `${variant}-s${String(Math.round(s * 100)).padStart(3, "0")}`;
        const { back, mid, near } = spec.draw(variant, s);
        const backBuf = await raster(back);
        const midBuf = await raster(mid);
        const nearBuf = await raster(near);
        await writeFile(path.join(dirL, `${tag}-back.webp`), backBuf);
        await writeFile(path.join(dirL, `${tag}-mid.webp`), midBuf);
        await writeFile(path.join(dirL, `${tag}-near.webp`), nearBuf);
        const flat = await sharp(backBuf)
          .composite([
            { input: midBuf, blend: "over" },
            { input: nearBuf, blend: "over" },
          ])
          .png()
          .toBuffer();
        const poster = await sharp(flat).webp({ quality: 80 }).toBuffer();
        await writeFile(path.join(dirP, `${tag}.webp`), poster);
        const manifest = {
          tag,
          s,
          fov: 42,
          aspect: W / H,
          layers: [
            { band: "back", file: `${tag}-back.webp`, depth: 26 },
            { band: "mid", file: `${tag}-mid.webp`, depth: 11 },
            { band: "near", file: `${tag}-near.webp`, depth: 4.6 },
          ],
        };
        await writeFile(path.join(dirL, `${tag}.json`), JSON.stringify(manifest));
        index.push({ tag, s, poster: `${tag}.webp`, width: W, height: H });
        if (s === spec.s[0]) {
          const pano = await sharp(flat).resize(2048, 1024).webp({ quality: 78 }).toBuffer();
          await writeFile(path.join(ROOT, scene, `pano-${variant}.webp`), pano);
        }
      }
    }
    index.sort((a, b) => a.s - b.s || a.tag.localeCompare(b.tag));
    await writeFile(path.join(dirP, "index.json"), JSON.stringify(index));
    console.log(scene, index.length, "posters");
  }
}

await main();
