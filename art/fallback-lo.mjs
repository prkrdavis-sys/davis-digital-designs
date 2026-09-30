/**
 * Designed Low Resources plates for worlds whose Cycles layers have not been
 * rendered yet. Each plate is a depth pair (far scenery, near subject) plus a
 * composited poster, so LayerStack and the reduced-motion backdrop have
 * something to show. Re-running a world's `blend <scene> --steps layers` and
 * `node art/images.mjs layers <scene>` replaces these.
 *
 * Usage: node art/fallback-lo.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const W = 1600;
const H = 1000;
const ROOT = path.resolve("public/worlds");

const svg = (body) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <filter id="grain" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.18"/></feComponentTransfer>
    </filter>
  </defs>
  ${body}
</svg>`;

function sky(stops) {
  const cols = stops.map((c, i) => `<stop offset="${(i / (stops.length - 1)).toFixed(3)}" stop-color="${c}"/>`).join("");
  return `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${cols}</linearGradient><rect width="${W}" height="${H}" fill="url(#sky)"/>`;
}

function grain(opacity) {
  return `<rect width="${W}" height="${H}" filter="url(#grain)" opacity="${opacity}"/>`;
}

/** @type {Record<string, { s: number[], draw: (v: "day"|"night", s: number) => { back: string, mid: string } }>} */
const SCENES = {
  garden: {
    s: [0, 0.5, 1],
    draw: (v, s) => {
      const night = v === "night";
      const back = sky(night ? ["#141028", "#2a2158", "#3a2868"] : ["#fff4f8", "#f3e4ff", "#d5e4ff"]) +
        `<ellipse cx="${980 - s * 80}" cy="760" rx="820" ry="210" fill="${night ? "#1a1638" : "#f7fbff"}" opacity="0.85"/>` +
        grain(night ? 0.25 : 0.12);
      const mid =
        `<g transform="translate(${220 + s * 40} 0)">` +
        blob(1080, 430, 150, night ? "#ff7ec4" : "#ff9cc2") +
        blob(860, 560, 90, night ? "#8ea6ff" : "#b7c8ff") +
        blob(1240, 620, 70, night ? "#ffe08f" : "#ffe7a8") +
        `<text x="1040" y="470" text-anchor="middle" font-family="Georgia, serif" font-size="120" fill="${night ? "#fff6fb" : "#ffffff"}" opacity="0.9">D</text>` +
        `</g>`;
      return { back, mid };
    },
  },
  doors: {
    s: [0, 0.5, 1],
    draw: (v) => {
      const night = v === "night";
      const wall = night ? "#12142c" : "#f6e7ef";
      const back = sky(night ? ["#070818", "#14183a", "#1c2048"] : ["#fff6fb", "#f8dce8", "#efe4f6"]) +
        `<polygon points="520,1000 1080,1000 860,80 740,80" fill="${wall}"/>` +
        grain(0.15);
      let arches = "";
      for (let i = 0; i < 5; i++) {
        const x = 980 + i * 70;
        const y = 520 + i * 40;
        const h = 280 - i * 36;
        arches += `<path d="M${x - h * 0.35} ${y + h} V${y} A${h * 0.35} ${h * 0.42} 0 0 1 ${x + h * 0.35} ${y} V${y + h}" fill="none" stroke="${night ? "#cbb6ff" : "#ffffff"}" stroke-width="${8 - i}" opacity="${0.85 - i * 0.12}"/>`;
      }
      return { back, mid: arches };
    },
  },
  bubbles: {
    s: [0, 0.5, 1],
    draw: (v, s) => {
      const night = v === "night";
      const back = sky(night ? ["#1a1440", "#3a2168", "#120e28"] : ["#fff1f6", "#ffe08f", "#9dbcff"]) + grain(0.12);
      const colors = night ? ["#ffa6d0", "#a3b6ff", "#cdb0ff", "#ffe08f"] : ["#ff9cc2", "#ffffff", "#9dbcff", "#ffe08f"];
      let mid = "";
      for (let i = 0; i < 7; i++) {
        const x = 780 + ((i * 137 + s * 80) % 700);
        const y = 180 + ((i * 97) % 620) - s * 40;
        mid += bubble(x, y, 40 + (i % 3) * 28, colors[i % colors.length]);
      }
      return { back, mid };
    },
  },
  diorama: {
    s: [0, 1, 2],
    draw: (v, s) => {
      const night = v === "night";
      const back = sky(night ? ["#0c0a1c", "#241848", "#120e28"] : ["#ffb080", "#ff6e4a", "#4a5aaa"]) + grain(0.16);
      const y = 620 - s * 30;
      const mid =
        `<ellipse cx="980" cy="${y + 80}" rx="${420 + s * 40}" ry="${120 + s * 16}" fill="${night ? "#1a2840" : "#6a9a52"}"/>` +
        `<ellipse cx="980" cy="${y + 40}" rx="${300 + s * 20}" ry="70" fill="${night ? "#243628" : "#8fbf6a"}"/>` +
        `<ellipse cx="1040" cy="${y + 20}" rx="90" ry="36" fill="${night ? "#0a1224" : "#4a6fa0"}" opacity="0.85"/>`;
      return { back, mid };
    },
  },
  greenhouse: {
    s: [0, 1.3, 2.6, 3.8],
    draw: (v) => {
      const night = v === "night";
      const back = sky(night ? ["#0c1428", "#1c3058", "#243048"] : ["#f4f7ea", "#f6c47c", "#8fd08a"]) +
        `<rect x="0" y="640" width="${W}" height="360" fill="${night ? "#1a2418" : "#c4d6a8"}"/>` +
        grain(0.14);
      const mid =
        `<g transform="translate(860 180)" fill="none" stroke="${night ? "#d7e6ff" : "#f7f3ea"}" stroke-width="7">` +
        `<path d="M40 620 V220 Q280 20 520 220 V620"/>` +
        `<path d="M40 620 H520"/>` +
        `<path d="M160 620 V250 M280 620 V180 M400 620 V250"/>` +
        `<path d="M40 360 H520 M90 280 H470"/>` +
        `</g>` +
        `<ellipse cx="1120" cy="700" rx="70" ry="28" fill="${night ? "#234028" : "#2f6b3a"}"/>` +
        `<path d="M1120 700 C1100 560 1080 480 1140 400" fill="none" stroke="${night ? "#3d8f55" : "#1f6b38"}" stroke-width="8"/>`;
      return { back, mid };
    },
  },
  pinball: {
    s: [0, 1.4, 2.8, 4],
    draw: (v, s) => {
      const night = v === "night";
      const back = sky(night ? ["#120818", "#2a1040", "#0a0614"] : ["#f7e7ef", "#ffd0e4", "#d7f6ff"]) + grain(0.2);
      const tilt = -8 + s * 2;
      const mid =
        `<g transform="translate(1040 520) rotate(${tilt})">` +
        `<rect x="-220" y="-340" width="440" height="680" rx="28" fill="${night ? "#1a0e28" : "#fff6fb"}" stroke="${night ? "#ff4fa0" : "#ff5c9d"}" stroke-width="10"/>` +
        bumper(-80, -80, night) +
        bumper(70, -20, night) +
        bumper(-20, 80, night) +
        `<circle cx="40" cy="${160 - s * 20}" r="16" fill="${night ? "#ffe066" : "#f4f1ea"}" stroke="#c9a227" stroke-width="3"/>` +
        `</g>`;
      return { back, mid };
    },
  },
  snowglobe: {
    s: [0, 1.2, 2.4, 3.6],
    draw: (v, s) => {
      const night = v === "night";
      const back = sky(night ? ["#0e1830", "#1a3058", "#86e8cc"] : ["#eef4ff", "#d7ecff", "#cbb2ff"]) + grain(0.12);
      const mid =
        `<ellipse cx="1080" cy="760" rx="260" ry="36" fill="${night ? "#2a241c" : "#6b4228"}"/>` +
        `<rect x="960" y="700" width="240" height="70" rx="8" fill="${night ? "#3a2c22" : "#8a5a34"}"/>` +
        `<circle cx="1080" cy="${470 - s * 10}" r="210" fill="${night ? "#16324a" : "#f4fbff"}" fill-opacity="0.72" stroke="${night ? "#cfe8ff" : "#ffffff"}" stroke-width="8"/>` +
        `<polygon points="1020,560 1080,430 1140,560" fill="${night ? "#e8f4ff" : "#ffffff"}" opacity="0.9"/>` +
        (night ? `<path d="M900 300 Q1080 220 1260 320" fill="none" stroke="#86e8cc" stroke-width="6" opacity="0.7"/>` : "");
      return { back, mid };
    },
  },
  dunes: {
    s: [0, 1, 2, 3],
    draw: (v, s) => {
      const night = v === "night";
      const back = sky(night ? ["#070814", "#1a1848", "#3a2860"] : ["#ff8a66", "#ffb85f", "#ffe4b5"]) +
        (night ? stars() : `<circle cx="1180" cy="210" r="54" fill="#fff1d2"/>`) +
        grain(0.18);
      const shift = s * 90;
      const mid =
        `<path d="M0 ${640 + shift * 0.1} C 400 ${520 - shift * 0.2} 700 760 1100 600 C 1300 520 1500 640 ${W} 580 V${H} H0 Z" fill="${night ? "#2a2418" : "#e39a45"}"/>` +
        `<path d="M200 ${760} C 500 640 800 820 1200 700 C 1400 640 ${W} 760 ${W} ${H} H200 Z" fill="${night ? "#1a1610" : "#c46a32"}"/>` +
        monolith(980 - shift * 0.3, 560, night) +
        monolith(1180 - shift * 0.15, 610, night);
      return { back, mid };
    },
  },
  everest: {
    s: [0, 1, 2, 3, 4, 5],
    draw: (v, s) => {
      const night = v === "night";
      const back = sky(night ? ["#05070f", "#10182c", "#1a2744"] : ["#8dbcff", "#eef3f8", "#f4c552"]) +
        (night ? stars() : "") +
        grain(0.16);
      const mid =
        ridge(520, "#8aa0b8", 0.55) +
        ridge(600, night ? "#243044" : "#d5dde6", 1) +
        ridge(690, night ? "#1a2434" : "#f7f4ef", 1) +
        route(s / 5);
      return { back, mid };
    },
  },
  planes: {
    s: [0, 1.2, 2.4],
    draw: (v, s) => {
      const night = v === "night";
      const back = sky(night ? ["#14182e", "#2a2458", "#c4b08a"] : ["#ffd7b0", "#ffa684", "#bea3ff"]) +
        `<ellipse cx="400" cy="${760 - s * 20}" rx="520" ry="90" fill="${night ? "#2a3358" : "#fff6ee"}" opacity="0.8"/>` +
        `<ellipse cx="1100" cy="${700 - s * 10}" rx="480" ry="110" fill="${night ? "#1c2448" : "#ffffff"}" opacity="0.75"/>` +
        grain(0.12);
      const x = 900 + s * 80;
      const y = 420 - s * 30;
      const mid =
        `<g transform="translate(${x} ${y}) rotate(-18)">` +
        `<polygon points="0,0 90,-16 0,-8" fill="${night ? "#fff4e2" : "#fffaf4"}" stroke="${night ? "#ffd07e" : "#e8cbb2"}" stroke-width="2"/>` +
        `<polygon points="0,-4 -10,16 16,6" fill="${night ? "#ffe7c2" : "#fff"}"/>` +
        `</g>`;
      return { back, mid };
    },
  },
};

function blob(cx, cy, r, fill) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 0.86}" fill="${fill}" opacity="0.92"/>` +
    `<ellipse cx="${cx - r * 0.25}" cy="${cy - r * 0.28}" rx="${r * 0.28}" ry="${r * 0.16}" fill="#ffffff" opacity="0.55"/>`;
}

function bubble(cx, cy, r, fill) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" fill-opacity="0.55" stroke="#ffffff" stroke-opacity="0.8" stroke-width="3"/>` +
    `<ellipse cx="${cx - r * 0.3}" cy="${cy - r * 0.35}" rx="${r * 0.18}" ry="${r * 0.1}" fill="#ffffff" opacity="0.8"/>`;
}

function bumper(x, y, night) {
  return `<circle cx="${x}" cy="${y}" r="36" fill="${night ? "#2fe6ff" : "#3edcff"}" opacity="0.9"/>` +
    `<circle cx="${x}" cy="${y}" r="16" fill="${night ? "#ffe066" : "#ffffff"}"/>`;
}

function monolith(x, y, night) {
  return `<polygon points="${x},${y} ${x + 28},${y - 150} ${x + 56},${y}" fill="${night ? "#d8d2ea" : "#f6efe4"}"/>` +
    `<rect x="${x + 14}" y="${y - 90}" width="28" height="18" fill="${night ? "#8e98ff" : "#ff8a66"}"/>`;
}

function ridge(base, fill, opacity) {
  return `<path d="M0 ${base + 80} L180 ${base + 20} L340 ${base + 60} L520 ${base - 10} L700 ${base + 40} L860 ${base - 80} L980 ${base - 160} L1100 ${base - 40} L1280 ${base + 20} L1600 ${base + 70} L1600 1000 L0 1000 Z" fill="${fill}" opacity="${opacity}"/>`;
}

function route(t) {
  const pts = [[420, 760], [620, 700], [780, 640], [900, 560], [980, 470], [1040, 390]];
  const n = Math.max(2, Math.round(2 + t * (pts.length - 2)));
  const d = pts.slice(0, n).map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
  return `<path d="${d}" fill="none" stroke="#f4c552" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${pts[n - 1][0]}" cy="${pts[n - 1][1]}" r="8" fill="#ffe08a"/>`;
}

function stars() {
  let out = "";
  for (let i = 0; i < 40; i++) {
    const x = (i * 97) % W;
    const y = (i * 53) % 520;
    out += `<circle cx="${x}" cy="${y}" r="${i % 7 === 0 ? 1.8 : 1}" fill="#ffffff" opacity="0.8"/>`;
  }
  return out;
}

async function raster(body) {
  return sharp(Buffer.from(svg(body))).webp({ quality: 78 }).toBuffer();
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
        const { back, mid } = spec.draw(variant, s);
        const backBuf = await raster(back);
        const midBuf = await raster(mid);
        await writeFile(path.join(dirL, `${tag}-back.webp`), backBuf);
        await writeFile(path.join(dirL, `${tag}-mid.webp`), midBuf);
        const poster = await sharp(backBuf).composite([{ input: midBuf, blend: "over" }]).webp({ quality: 76 }).toBuffer();
        await writeFile(path.join(dirP, `${tag}.webp`), poster);
        const manifest = {
          tag,
          s,
          fov: 42,
          aspect: W / H,
          layers: [
            { band: "back", file: `${tag}-back.webp`, depth: 22 },
            { band: "mid", file: `${tag}-mid.webp`, depth: 9 },
          ],
        };
        await writeFile(path.join(dirL, `${tag}.json`), JSON.stringify(manifest));
        index.push({ tag, s, poster: `${tag}.webp`, width: W, height: H });
        const panoPath = path.join(ROOT, scene, `pano-${variant}.webp`);
        if (s === spec.s[0]) {
          const pano = await sharp(Buffer.from(svg(back))).resize(2048, 1024).webp({ quality: 76 }).toBuffer();
          await writeFile(panoPath, pano);
        }
      }
    }
    index.sort((a, b) => a.s - b.s || a.tag.localeCompare(b.tag));
    await writeFile(path.join(dirP, "index.json"), JSON.stringify(index));
    console.log(scene, index.length, "posters");
  }
}

await main();
