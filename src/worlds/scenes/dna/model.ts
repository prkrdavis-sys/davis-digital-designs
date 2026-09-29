/**
 * Runtime mirror of art/worlds/dna/dna_model.py. The Python side writes the
 * atom templates, wrapped (nucleosome) frames and the scroll timeline; this
 * file loads them and re-implements the timeline sampling so the shader and
 * the Cycles renders agree.
 */

export interface Nucleosome {
  center: [number, number, number];
  axis: [number, number, number];
  firstBp: number;
  lastBp: number;
}

export interface DnaMeta {
  rise: number;
  twist: number;
  nBp: number;
  atoms: number;
  stride: number;
  /** atoms.bin record layout (see dna_model.quantize_atoms). */
  atomFormat: { bytes: number; q: number };
  fork: { width: number; maxSep: number; bubble: number };
  nucleosomes: Nucleosome[];
  nucStart: number;
  timeline: Record<"fork" | "wrap" | "chromosome" | "helix", [number, number][]>;
  sequence: string;
  chromosome?: { center: [number, number, number]; scale: number };
}

export interface DnaData {
  meta: DnaMeta;
  /** Rows of 9 floats: bp, strand, lx, ly, lz, radius, group, element, ao. */
  atoms: Float32Array;
  /** Rows of 9 floats per base pair: origin, tangent (bp +Y), x axis. */
  frames: Float32Array;
}

let pending: Promise<DnaData> | null = null;

export function loadDna(): Promise<DnaData> {
  pending ??= (async () => {
    const [meta, atoms, frames] = await Promise.all([
      fetch("/worlds/dna/hi/dna.json").then((r) => r.json() as Promise<DnaMeta>),
      fetch("/worlds/dna/hi/atoms.bin").then((r) => r.arrayBuffer()),
      fetch("/worlds/dna/hi/frames.bin").then((r) => r.arrayBuffer()),
    ]);
    return { meta, atoms: decodeAtoms(atoms, meta), frames: new Float32Array(frames) };
  })();
  return pending;
}

/** Unpack the 14-byte records into rows of 9 floats (bp, strand, lx, ly, lz, radius, group, element, ao). */
function decodeAtoms(buf: ArrayBuffer, meta: DnaMeta): Float32Array {
  const view = new DataView(buf);
  const { bytes, q } = meta.atomFormat;
  const n = meta.atoms;
  const out = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const o = i * bytes;
    const r = i * 9;
    out[r] = view.getInt16(o, true);
    out[r + 2] = view.getInt16(o + 2, true) / q;
    out[r + 3] = view.getInt16(o + 4, true) / q;
    out[r + 4] = view.getInt16(o + 6, true) / q;
    out[r + 1] = view.getUint8(o + 8);
    out[r + 5] = view.getUint8(o + 9) / 1000;
    out[r + 6] = view.getUint8(o + 10);
    out[r + 7] = view.getUint8(o + 11);
    out[r + 8] = view.getUint8(o + 12) / 255;
  }
  return out;
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** Same keyed smoothstep interpolation as dna_model.sample(). */
export function sampleTrack(meta: DnaMeta, track: keyof DnaMeta["timeline"], s: number): number {
  const pts = meta.timeline[track];
  if (s <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [s0, v0] = pts[i];
    const [s1, v1] = pts[i + 1];
    if (s <= s1) return v0 + (v1 - v0) * smooth((s - s0) / (s1 - s0));
  }
  return pts[pts.length - 1][1];
}

/** Straight-duplex origin of base pair i (the bubble opening is small next to this). */
export function axisPoint(meta: DnaMeta, i: number): [number, number, number] {
  return [0, -i * meta.rise, 0];
}

/** How open the replication bubble is at bp i (dna_model.bubble_open). */
export function bubbleOpen(meta: DnaMeta, i: number, fork: number): number {
  if (fork <= 0) return 0;
  const { width, bubble } = meta.fork;
  return smooth((i - fork) / width) * (1 - smooth((i - fork - bubble + width) / width));
}

/** Separation of a strand at bp i with the upper fork at bp `fork` (dna_model.fork_offset). */
export function forkOffset(meta: DnaMeta, i: number, strand: 0 | 1, fork: number): [number, number, number] {
  const o = bubbleOpen(meta, i, fork);
  const ang = i * 0.018;
  const k = strand === 0 ? 1 : -1;
  return [Math.cos(ang) * meta.fork.maxSep * o * k, 0, Math.sin(ang) * meta.fork.maxSep * o * k];
}
