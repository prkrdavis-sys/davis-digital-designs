"use client";

import type { SceneId } from "@/worlds/types";

/**
 * Ambient soundscapes, one per scene, synthesized with Web Audio: no files to
 * download or license. Each bed is a few continuous layers (noise, drones,
 * pads) plus a scheduler for sparse events (birds, bells, pings, blips).
 * Beds crossfade as the scene under the viewport changes.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let reverb: ConvolverNode | null = null;
const noiseCache = new Map<string, AudioBuffer>();

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    ctx = new window.AudioContext();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    reverb = ctx.createConvolver();
    reverb.buffer = impulse(ctx, 3.2, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    reverb.connect(wet).connect(master);
  }
  return ctx;
}

function impulse(c: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function noise(c: AudioContext, color: "white" | "pink" | "brown"): AudioBuffer {
  const hit = noiseCache.get(color);
  if (hit) return hit;
  const len = c.sampleRate * 6;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (color === "white") d[i] = w * 0.5;
    else if (color === "brown") {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    } else {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  noiseCache.set(color, buf);
  return buf;
}

interface Bed {
  out: GainNode;
  stop: () => void;
}

type Builder = (c: AudioContext, out: GainNode, wet: AudioNode) => () => void;

/** Looping filtered noise with optional slow gusts. */
function wind(c: AudioContext, out: AudioNode, opts: { color?: "white" | "pink" | "brown"; type?: BiquadFilterType; freq: number; q?: number; gain: number; gust?: number; gustRate?: number }) {
  const src = c.createBufferSource();
  src.buffer = noise(c, opts.color ?? "pink");
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = opts.type ?? "bandpass";
  f.frequency.value = opts.freq;
  f.Q.value = opts.q ?? 0.8;
  const g = c.createGain();
  g.gain.value = opts.gain;
  src.connect(f).connect(g).connect(out);
  const lfos: OscillatorNode[] = [];
  if (opts.gust) {
    // Two slow, detuned LFOs make gusts that never quite repeat.
    for (const rate of [opts.gustRate ?? 0.07, (opts.gustRate ?? 0.07) * 2.3]) {
      const lfo = c.createOscillator();
      lfo.frequency.value = rate;
      const depth = c.createGain();
      depth.gain.value = opts.gain * opts.gust * 0.5;
      lfo.connect(depth).connect(g.gain);
      const fDepth = c.createGain();
      fDepth.gain.value = opts.freq * 0.35;
      lfo.connect(fDepth).connect(f.frequency);
      lfo.start();
      lfos.push(lfo);
    }
  }
  src.start();
  return () => {
    src.stop();
    lfos.forEach((l) => l.stop());
  };
}

/** Sustained chord of detuned oscillators through a breathing lowpass. */
function pad(c: AudioContext, out: AudioNode, freqs: number[], opts: { type?: OscillatorType; gain: number; cutoff?: number; breathe?: number }) {
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = opts.cutoff ?? 900;
  const g = c.createGain();
  g.gain.value = opts.gain;
  f.connect(g).connect(out);
  const oscs: OscillatorNode[] = [];
  for (const hz of freqs) {
    for (const det of [-6, 6]) {
      const o = c.createOscillator();
      o.type = opts.type ?? "sine";
      o.frequency.value = hz;
      o.detune.value = det;
      o.connect(f);
      o.start();
      oscs.push(o);
    }
  }
  const lfo = c.createOscillator();
  lfo.frequency.value = opts.breathe ?? 0.05;
  const depth = c.createGain();
  depth.gain.value = (opts.cutoff ?? 900) * 0.4;
  lfo.connect(depth).connect(f.frequency);
  lfo.start();
  return () => {
    oscs.forEach((o) => o.stop());
    lfo.stop();
  };
}

/** Random sparse events on a jittered schedule. */
function every(minS: number, maxS: number, fn: () => void) {
  let id = 0;
  const loop = () => {
    id = window.setTimeout(() => {
      fn();
      loop();
    }, (minS + Math.random() * (maxS - minS)) * 1000);
  };
  loop();
  return () => window.clearTimeout(id);
}

function bell(c: AudioContext, dest: AudioNode, hz: number, gain: number, decay = 2.5, partials = [1, 2.76, 5.4, 8.93]) {
  const t = c.currentTime;
  partials.forEach((p, i) => {
    const o = c.createOscillator();
    o.frequency.value = hz * p;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain / (i + 1), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay / (1 + i * 0.6));
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + decay + 0.1);
  });
}

function chirp(c: AudioContext, dest: AudioNode, gain: number) {
  // A small songbird: a few quick FM sweeps.
  const t0 = c.currentTime;
  const notes = 2 + Math.floor(Math.random() * 4);
  const base = 2600 + Math.random() * 2400;
  for (let n = 0; n < notes; n++) {
    const t = t0 + n * (0.07 + Math.random() * 0.06);
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.3), t);
    o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.5), t + 0.05);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.1);
  }
}

function blip(c: AudioContext, dest: AudioNode, hz: number, gain: number, type: OscillatorType = "square", dur = 0.12) {
  const t = c.currentTime;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = hz;
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 2400;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function pop(c: AudioContext, dest: AudioNode, gain: number) {
  const t = c.currentTime;
  const o = c.createOscillator();
  const hz = 500 + Math.random() * 700;
  o.frequency.setValueAtTime(hz, t);
  o.frequency.exponentialRampToValueAtTime(hz * 2.4, t + 0.06);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + 0.12);
}

function flutter(c: AudioContext, dest: AudioNode, gain: number) {
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noise(c, "white");
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 1800 + Math.random() * 1500;
  f.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  for (let k = 0; k < 6; k++) g.gain.setValueAtTime(gain * (k % 2 ? 0.2 : 1), t + k * 0.035);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 4);
  src.stop(t + 0.35);
}

const PENTA = [0, 2, 4, 7, 9];
const note = (root: number, steps: number) => root * Math.pow(2, (PENTA[((steps % 5) + 5) % 5] + 12 * Math.floor(steps / 5)) / 12);

const BEDS: Record<SceneId, Builder> = {
  garden: (c, out, wet) => {
    const a = pad(c, out, [130.8, 196, 246.9, 329.6], { gain: 0.05, cutoff: 1200, breathe: 0.04 });
    const b = every(4, 9, () => bell(c, wet, note(1046.5, Math.floor(Math.random() * 7)), 0.035, 3.5));
    return () => (a(), b());
  },
  doors: (c, out, wet) => {
    const a = pad(c, out, [55, 110, 164.8], { type: "triangle", gain: 0.035, cutoff: 500, breathe: 0.09 });
    const b = wind(c, out, { freq: 900, gain: 0.03, gust: 0.9, gustRate: 0.05 });
    const e = every(6, 12, () => bell(c, wet, 220, 0.02, 5, [1, 1.5, 2.01, 3]));
    return () => (a(), b(), e());
  },
  museum: (c, out, wet) => {
    const a = wind(c, out, { color: "brown", type: "lowpass", freq: 380, gain: 0.07 });
    const e = every(5, 11, () => blip(c, wet, 90 + Math.random() * 40, 0.03, "sine", 0.05));
    return () => (a(), e());
  },
  bubbles: (c, out, wet) => {
    const a = pad(c, out, [174.6, 220, 261.6, 349.2], { gain: 0.04, cutoff: 1400, breathe: 0.06 });
    const e = every(0.6, 2.2, () => pop(c, wet, 0.03));
    return () => (a(), e());
  },
  diorama: (c, out, wet) => {
    let step = 0;
    const e = every(0.45, 1.1, () => {
      step += Math.random() < 0.5 ? 1 : Math.random() < 0.5 ? -1 : 2;
      bell(c, wet, note(784, step), 0.03, 2.2, [1, 3.01, 5.2]);
    });
    const a = pad(c, out, [196, 293.7], { gain: 0.025, cutoff: 800 });
    return () => (e(), a());
  },
  greenhouse: (c, out, wet) => {
    const a = wind(c, out, { freq: 700, q: 0.6, gain: 0.05, gust: 0.8, gustRate: 0.06 });
    const e = every(1.5, 5, () => chirp(c, Math.random() < 0.5 ? out : wet, 0.018));
    return () => (a(), e());
  },
  dna: (c, out, wet) => {
    const a = pad(c, out, [41.2, 61.7, 82.4], { gain: 0.06, cutoff: 260, breathe: 0.03 });
    const b = wind(c, out, { color: "brown", type: "lowpass", freq: 320, gain: 0.05, gust: 0.6, gustRate: 0.04 });
    const e = every(5, 10, () => bell(c, wet, 587, 0.018, 4, [1, 2]));
    return () => (a(), b(), e());
  },
  pinball: (c, out, wet) => {
    const a = pad(c, out, [60, 120, 180], { type: "sawtooth", gain: 0.006, cutoff: 300 });
    let step = 0;
    const e = every(0.7, 2.4, () => {
      step += Math.floor(Math.random() * 3) - 1;
      blip(c, wet, note(523.3, step), 0.02);
      if (Math.random() < 0.25) window.setTimeout(() => blip(c, wet, note(523.3, step + 2), 0.02), 90);
    });
    return () => (a(), e());
  },
  snowglobe: (c, out, wet) => {
    const a = wind(c, out, { color: "white", freq: 2200, q: 0.5, gain: 0.02, gust: 0.9, gustRate: 0.05 });
    let step = 0;
    const e = every(0.8, 2.2, () => {
      step += Math.random() < 0.6 ? 1 : -1;
      bell(c, wet, note(1318.5, step), 0.02, 2.6, [1, 3.01, 5.2]);
    });
    return () => (a(), e());
  },
  dunes: (c, out) => {
    const a = wind(c, out, { freq: 520, q: 0.5, gain: 0.08, gust: 1, gustRate: 0.045 });
    const b = pad(c, out, [73.4, 110, 146.8], { type: "triangle", gain: 0.02, cutoff: 420, breathe: 0.02 });
    return () => (a(), b());
  },
  everest: (c, out, wet) => {
    const a = wind(c, out, { freq: 650, q: 1.6, gain: 0.07, gust: 1.1, gustRate: 0.08 });
    const b = wind(c, out, { color: "white", freq: 1900, q: 6, gain: 0.012, gust: 1, gustRate: 0.11 });
    const e = every(9, 18, () => bell(c, wet, 196, 0.035, 7, [1, 2.71, 5.1]));
    return () => (a(), b(), e());
  },
  planes: (c, out, wet) => {
    const a = wind(c, out, { freq: 1400, q: 0.5, gain: 0.035, gust: 0.7, gustRate: 0.05 });
    const b = pad(c, out, [220, 277.2, 329.6, 493.9], { gain: 0.03, cutoff: 1600, breathe: 0.05 });
    const e = every(3, 7, () => flutter(c, wet, 0.025));
    return () => (a(), b(), e());
  },
};

const active = new Map<SceneId, Bed>();
let current: SceneId | null = null;
let enabled = false;

function startBed(id: SceneId): Bed | null {
  const c = context();
  if (!c || !master || !reverb) return null;
  const out = c.createGain();
  out.gain.value = 0;
  out.connect(master);
  const wet = c.createGain();
  wet.gain.value = 1;
  wet.connect(reverb);
  wet.connect(out);
  const stop = BEDS[id](c, out, wet);
  out.gain.linearRampToValueAtTime(1, c.currentTime + 2.2);
  return { out, stop };
}

function fadeOut(id: SceneId) {
  const bed = active.get(id);
  const c = ctx;
  if (!bed || !c) return;
  active.delete(id);
  bed.out.gain.cancelScheduledValues(c.currentTime);
  bed.out.gain.setValueAtTime(bed.out.gain.value, c.currentTime);
  bed.out.gain.linearRampToValueAtTime(0, c.currentTime + 2);
  window.setTimeout(() => {
    bed.stop();
    bed.out.disconnect();
  }, 2200);
}

export const ambience = {
  /** Turn the soundscape on or off (call from a user gesture the first time). */
  setEnabled(on: boolean) {
    enabled = on;
    const c = context();
    if (!c || !master) return;
    if (on && c.state === "suspended") void c.resume();
    master.gain.cancelScheduledValues(c.currentTime);
    master.gain.setValueAtTime(master.gain.value, c.currentTime);
    master.gain.linearRampToValueAtTime(on ? 0.9 : 0, c.currentTime + 1.2);
    if (on && current && !active.has(current)) {
      const bed = startBed(current);
      if (bed) active.set(current, bed);
    }
    if (!on) window.setTimeout(() => !enabled && [...active.keys()].forEach(fadeOut), 1300);
  },
  /** Crossfade to a scene's bed. */
  setScene(id: SceneId | null) {
    if (id === current) return;
    current = id;
    if (!enabled) return;
    for (const k of [...active.keys()]) if (k !== id) fadeOut(k);
    if (id && !active.has(id)) {
      const bed = startBed(id);
      if (bed) active.set(id, bed);
    }
  },
  resume() {
    if (ctx?.state === "suspended") void ctx.resume();
  },
};
