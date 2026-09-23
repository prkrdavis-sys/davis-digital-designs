"use client";

import { useUi } from "@/lib/store";

/**
 * Tiny Web Audio synth. No audio files to download, no licensing, and every
 * sound is a few lines of code you can tweak. Respects the global mute.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let lastHover = 0;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function canPlay(): boolean {
  return !useUi.getState().muted;
}

interface ToneOpts {
  freq: number;
  to?: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
}

function tone({ freq, to, dur = 0.12, type = "sine", gain = 1, delay = 0 }: ToneOpts) {
  const c = getCtx();
  if (!c || !master) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noiseBurst(dur = 0.08, gain = 0.4) {
  const c = getCtx();
  if (!c || !master) return;
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1800;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(master);
  src.start();
}

export const sfx = {
  /** Soft blip for hovering interactive things. Throttled so lists don't machine-gun. */
  hover() {
    if (!canPlay()) return;
    const now = performance.now();
    if (now - lastHover < 70) return;
    lastHover = now;
    tone({ freq: 720 + Math.random() * 120, to: 1100, dur: 0.07, gain: 0.5 });
  },
  /** Two-note chime for clicks and taps. */
  click() {
    if (!canPlay()) return;
    tone({ freq: 660, to: 880, dur: 0.09, type: "triangle", gain: 0.8 });
    tone({ freq: 990, to: 1320, dur: 0.14, type: "sine", gain: 0.6, delay: 0.05 });
  },
  /** Bubble pop for particles, toggles, and small surprises. */
  pop() {
    if (!canPlay()) return;
    tone({ freq: 380, to: 1200, dur: 0.1, type: "sine", gain: 0.9 });
    noiseBurst(0.05, 0.25);
  },
  /** Ascending arpeggio for success states. */
  success() {
    if (!canPlay()) return;
    [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.18, type: "triangle", gain: 0.6, delay: i * 0.07 }));
  },
  /** Whoosh for page transitions. */
  whoosh() {
    if (!canPlay()) return;
    noiseBurst(0.35, 0.18);
    tone({ freq: 220, to: 90, dur: 0.35, type: "sine", gain: 0.4 });
  },
  /** Sparkly firefly catch. */
  sparkle() {
    if (!canPlay()) return;
    tone({ freq: 1500 + Math.random() * 600, to: 2400, dur: 0.12, gain: 0.5 });
    tone({ freq: 2200, to: 3200, dur: 0.1, gain: 0.3, delay: 0.04 });
  },
};

export type Sfx = typeof sfx;
