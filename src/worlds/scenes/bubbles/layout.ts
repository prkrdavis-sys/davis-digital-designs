/** hi/layout.json written by art/worlds/bubbles/build.py (step `export`). */
export interface BubblesLayout {
  /** The runtime samples the rail at scene s + railOffset (the rail starts before the chapter). */
  railOffset: number;
  axis: [number, number, number];
  bubbles: {
    shape: "round" | "pill" | "square";
    color: string;
    pos: [number, number, number];
    /** three.js world matrix, column-major. */
    matrix: number[];
    mirror: boolean;
    glyph: { shape: "heart" | "star" | "dots"; color: string } | null;
    /** Distance from the bubble's centre to its front face (glyphs sit there). */
    front: number;
  }[];
  clouds: { k: number; pos: [number, number, number]; scale: number; size: [number, number] }[];
}

const URL = "/worlds/bubbles/hi/layout.json";
let pending: Promise<BubblesLayout> | null = null;

export function loadLayout(): Promise<BubblesLayout> {
  if (!pending) {
    pending = fetch(URL).then((r) => {
      if (!r.ok) throw new Error(`bubbles layout: ${r.status}`);
      return r.json() as Promise<BubblesLayout>;
    });
  }
  return pending;
}
