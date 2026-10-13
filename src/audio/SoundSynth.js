/**
 * Procedural sound design. Every sound in the game is synthesised here from
 * oscillators, filtered noise and formant filters (no third-party audio, so
 * everything is original and released under CC0 with the project).
 *
 * All generators are deterministic (seeded) and return mono Float32Array PCM
 * at `SR`; AudioManager wraps them in AudioBuffers after the first gesture.
 */

export const SR = 44100;
const TAU = Math.PI * 2;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const buffer = (seconds) => new Float32Array(Math.ceil(seconds * SR));

/** RBJ biquad (band-pass constant 0 dB peak, low-pass, high-pass). */
class Biquad {
  constructor(type, freq, q) {
    this.type = type;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(freq, q);
  }
  set(freq, q) {
    const w = (TAU * Math.min(freq, SR * 0.45)) / SR;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0;
    let b1;
    let b2;
    if (this.type === 'lowpass') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else if (this.type === 'highpass') {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  process(x) {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

function normalize(data, peak = 0.9) {
  let max = 0;
  for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i]));
  if (max > 0) {
    const k = peak / max;
    for (let i = 0; i < data.length; i++) data[i] *= k;
  }
  // 3 ms fade in/out to avoid clicks.
  const f = Math.min(Math.floor(SR * 0.003), data.length >> 2);
  for (let i = 0; i < f; i++) {
    data[i] *= i / f;
    data[data.length - 1 - i] *= i / f;
  }
  return data;
}

/** Make a buffer loop seamlessly by cross-fading its tail into its head. */
function loopify(data, fadeSeconds) {
  const f = Math.floor(fadeSeconds * SR);
  const out = new Float32Array(data.length - f);
  out.set(data.subarray(0, out.length));
  for (let i = 0; i < f; i++) {
    const t = i / f;
    out[i] = data[out.length + i] * (1 - t) + data[i] * t;
  }
  return out;
}

/** Robot paw footstep: rubbery thud + tiny servo click. */
export function footstep(variant) {
  const r = rng(100 + variant);
  const d = buffer(0.12);
  const pitch = 0.88 + r() * 0.24;
  const lp = new Biquad('lowpass', 700, 0.7);
  const bp = new Biquad('bandpass', 2600 + r() * 1400, 3);
  let phase = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / SR;
    const f = (60 + 90 * Math.exp(-t * 40)) * pitch;
    phase += (TAU * f) / SR;
    const thud = Math.sin(phase) * Math.exp(-t * 32);
    const n = r() * 2 - 1;
    const body = lp.process(n) * Math.exp(-t * 55) * 0.9;
    const click = bp.process(n) * Math.exp(-t * 260) * 0.5;
    const tick = (Math.sin(TAU * 1800 * pitch * t) > 0 ? 1 : -1) * Math.exp(-t * 400) * 0.04;
    d[i] = thud * 0.8 + body + click + tick;
  }
  return normalize(d, 0.8);
}

/** Jump: servo whir up + springy boing. */
export function jump() {
  const d = buffer(0.36);
  const lp = new Biquad('lowpass', 2200, 0.8);
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / SR;
    const f = 260 * Math.pow(2.8, Math.min(1, t / 0.2));
    p1 += (TAU * f) / SR;
    const saw = ((p1 / TAU) % 1) * 2 - 1;
    const whir = lp.process(saw) * Math.min(1, t / 0.01) * Math.exp(-t * 9);
    const fb = 380 + 140 * Math.min(1, t / 0.15) + Math.sin(TAU * 18 * t) * 25;
    p2 += (TAU * fb) / SR;
    const boing = Math.sin(p2) * Math.exp(-t * 11) * 0.5;
    d[i] = whir * 0.6 + boing;
  }
  return normalize(d, 0.75);
}

/** Landing: thump + light metallic clank. */
export function land() {
  const r = rng(7);
  const d = buffer(0.4);
  const lp = new Biquad('lowpass', 420, 0.7);
  const partials = [720, 1130, 1580, 2210];
  let phase = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / SR;
    const f = 45 + 55 * Math.exp(-t * 18);
    phase += (TAU * f) / SR;
    let clank = 0;
    for (let k = 0; k < partials.length; k++)
      clank += Math.sin(TAU * partials[k] * t + k) * Math.exp(-t * (22 + k * 6));
    d[i] =
      Math.sin(phase) * Math.exp(-t * 12) +
      lp.process(r() * 2 - 1) * Math.exp(-t * 28) * 0.9 +
      clank * 0.08;
  }
  return normalize(d, 0.85);
}

/**
 * Robot bark: a glottal pulse train with a "ruff" pitch contour through two
 * moving formants, light bit-crushing for an electronic voice, then a short
 * synth chirp.
 */
export function robotBark(variant) {
  const r = rng(300 + variant);
  const d = buffer(0.5);
  const base = 0.9 + variant * 0.12;
  const f1 = new Biquad('bandpass', 700, 5);
  const f2 = new Biquad('bandpass', 1300, 6);
  const f3 = new Biquad('bandpass', 2600, 7);
  const lp = new Biquad('lowpass', 3200, 0.7);
  let phase = 0;
  let held = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / SR;
    let f0;
    if (t < 0.035) f0 = 240 + (430 - 240) * (t / 0.035);
    else f0 = 430 - 190 * Math.min(1, (t - 0.035) / 0.16);
    f0 *= base;
    phase += f0 / SR;
    const pulse = (phase % 1) * 2 - 1 + (r() * 2 - 1) * 0.15;
    const env = Math.min(1, t / 0.006) * (t < 0.13 ? 1 : Math.exp(-(t - 0.13) * 28));
    const k = Math.min(1, t / 0.12);
    f1.set(650 + 220 * k, 5);
    f2.set(1250 + 300 * k, 6);
    let v =
      f1.process(pulse) * 1.0 +
      f2.process(pulse) * 0.7 +
      f3.process(pulse) * 0.25 +
      lp.process(pulse) * 0.18;
    v *= env;
    // Sample-and-hold + 6-bit quantisation for a friendly robotic grit.
    if (i % 3 === 0) held = Math.round(v * 32) / 32;
    let out = held * 0.75 + v * 0.25;
    // Electronic chirp tail.
    if (t > 0.2 && t < 0.26) {
      const ct = (t - 0.2) / 0.06;
      out += Math.sin(TAU * (1700 + 900 * ct) * t) * Math.sin(Math.PI * ct) * 0.12;
    }
    d[i] = out;
  }
  return normalize(d, 0.9);
}

/** Squeaky toy. */
export function squeak(variant) {
  const r = rng(500 + variant);
  const d = buffer(0.3);
  const bp = new Biquad('bandpass', 3000, 2);
  const k = 0.9 + variant * 0.15;
  let phase = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / SR;
    const contour = t < 0.08 ? 900 + 800 * (t / 0.08) : 1700 - 500 * Math.min(1, (t - 0.08) / 0.18);
    const f = (contour + Math.sin(TAU * 35 * t) * 60) * k;
    phase += (TAU * f) / SR;
    const env = Math.min(1, t / 0.015) * Math.exp(-Math.max(0, t - 0.1) * 14);
    d[i] =
      (Math.sin(phase) + Math.sin(phase * 2) * 0.25) * env + bp.process(r() * 2 - 1) * env * 0.12;
  }
  return normalize(d, 0.7);
}

/** Rubber ball bounce. */
export function bonk(variant) {
  const r = rng(600 + variant);
  const d = buffer(0.25);
  const lp = new Biquad('lowpass', 2000, 0.7);
  const k = 0.85 + variant * 0.2;
  let p = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / SR;
    const f = (150 + 70 * Math.exp(-t * 30)) * k;
    p += (TAU * f) / SR;
    d[i] =
      Math.sin(p) * Math.exp(-t * 18) +
      Math.sin(TAU * 520 * k * t) * Math.exp(-t * 30) * 0.3 +
      lp.process(r() * 2 - 1) * Math.exp(-t * 120) * 0.5;
  }
  return normalize(d, 0.75);
}

/** Soft plush thump. */
export function plush() {
  const r = rng(700);
  const d = buffer(0.16);
  const lp = new Biquad('lowpass', 320, 0.7);
  for (let i = 0; i < d.length; i++) {
    const t = i / SR;
    d[i] =
      lp.process(r() * 2 - 1) * Math.exp(-t * 35) +
      Math.sin(TAU * 110 * t) * Math.exp(-t * 30) * 0.4;
  }
  return normalize(d, 0.6);
}

/** Ventilation hum loop: brown noise + mains hum + slow flutter. */
export function ventLoop() {
  const r = rng(800);
  const d = buffer(6.5);
  const lp = new Biquad('lowpass', 480, 0.7);
  let brown = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / SR;
    brown = brown * 0.985 + (r() * 2 - 1) * 0.1;
    const am = 0.85 + 0.15 * Math.sin(TAU * 0.23 * t);
    d[i] =
      lp.process(brown) * am * 1.6 + Math.sin(TAU * 60 * t) * 0.08 + Math.sin(TAU * 120 * t) * 0.04;
  }
  return normalize(loopify(d, 0.5), 0.6);
}

/** Room tone: soft, airy, dark noise bed. */
export function roomToneLoop() {
  const r = rng(900);
  const d = buffer(8.5);
  const lp = new Biquad('lowpass', 260, 0.6);
  const lp2 = new Biquad('lowpass', 2400, 0.6);
  const hp = new Biquad('highpass', 900, 0.6);
  for (let i = 0; i < d.length; i++) {
    const n = r() * 2 - 1;
    d[i] = lp.process(n) * 2.2 + hp.process(lp2.process(n)) * 0.08;
  }
  return normalize(loopify(d, 0.5), 0.5);
}

/** Bubbling water dispenser loop. */
export function waterLoop() {
  const r = rng(1000);
  const d = buffer(5.5);
  const bp = new Biquad('bandpass', 2800, 1.5);
  for (let i = 0; i < d.length; i++)
    d[i] = bp.process(r() * 2 - 1) * (0.05 + 0.03 * Math.sin(i / 3000));
  const bubbles = 34;
  for (let b = 0; b < bubbles; b++) {
    const start = Math.floor(r() * (d.length - SR * 0.06));
    const f0 = 450 + r() * 700;
    const len = Math.floor(SR * (0.025 + r() * 0.03));
    let p = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      p += (TAU * f0 * (1 + t * 30)) / SR;
      d[start + i] += Math.sin(p) * Math.exp(-t * 60) * (0.3 + r() * 0.2);
    }
  }
  return normalize(loopify(d, 0.4), 0.55);
}

/**
 * Real (organic) dog bark heard through a door: breathy pulse source, fixed
 * formants, muffled with a low-pass and given a short room reverb tail.
 */
export function distantBark(variant) {
  const r = rng(1100 + variant);
  const d = buffer(1.1);
  const f1 = new Biquad('bandpass', 650, 4);
  const f2 = new Biquad('bandpass', 1600, 5);
  const muffle = new Biquad('lowpass', 1000, 0.7);
  const barks = variant % 2 === 0 ? [0] : [0, 0.28];
  const pitch = 0.85 + variant * 0.1;
  let phase = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / SR;
    let v = 0;
    for (const s of barks) {
      const bt = t - s;
      if (bt < 0 || bt > 0.22) continue;
      const f0 = (520 - 260 * Math.min(1, bt / 0.15)) * pitch;
      phase += f0 / SR;
      const src = ((phase % 1) * 2 - 1) * 0.7 + (r() * 2 - 1) * 0.35;
      const env = Math.min(1, bt / 0.008) * Math.exp(-bt * 14);
      v += (f1.process(src) + f2.process(src) * 0.6) * env;
    }
    d[i] = muffle.process(v);
  }
  // Short reverb: three feedback combs.
  const out = new Float32Array(d.length);
  const delays = [1557, 1617, 1491];
  for (const delay of delays) {
    const comb = new Float32Array(d.length);
    for (let i = 0; i < d.length; i++) {
      comb[i] = d[i] + (i >= delay ? comb[i - delay] * 0.55 : 0);
      out[i] += comb[i] / delays.length;
    }
  }
  for (let i = 0; i < d.length; i++) out[i] = d[i] * 0.7 + out[i] * 0.5;
  return normalize(out, 0.7);
}

/** UI click / hover blips. */
export function uiBlip(high) {
  const d = buffer(high ? 0.05 : 0.07);
  let p = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / SR;
    const f = high ? 1500 : 880 + 500 * Math.min(1, t / 0.03);
    p += (TAU * f) / SR;
    d[i] = Math.sin(p) * Math.exp(-t * (high ? 70 : 45));
  }
  return normalize(d, high ? 0.25 : 0.4);
}

/**
 * Robot "voice" chirp: a short melody of FM beeps with quick glides between
 * notes — happy (up-step), excited (rising trill) or sleepy (falling sigh).
 * @param {'happy'|'excited'|'sleepy'} mood
 */
export function chirp(mood) {
  const notes =
    mood === 'excited'
      ? [
          [660, 0.06],
          [880, 0.06],
          [990, 0.06],
          [1320, 0.14],
        ]
      : mood === 'sleepy'
        ? [
            [700, 0.16],
            [520, 0.18],
            [390, 0.34],
          ]
        : [
            [620, 0.09],
            [930, 0.18],
          ];
  const total = notes.reduce((a, [, len]) => a + len, 0) + 0.08;
  const d = buffer(total);
  const lp = new Biquad('lowpass', 3600, 0.7);
  let phase = 0;
  let modPhase = 0;
  let i = 0;
  let prevF = notes[0][0];
  for (const [f, len] of notes) {
    const n = Math.floor(len * SR);
    for (let k = 0; k < n && i < d.length; k++, i++) {
      const t = k / SR;
      const glide = Math.min(1, t / 0.018);
      const freq = prevF + (f - prevF) * glide;
      // A fast 28 Hz warble gives the beeps a robotic voice.
      modPhase += (TAU * 28) / SR;
      phase += (TAU * freq * (1 + 0.035 * Math.sin(modPhase))) / SR;
      const env = Math.min(1, t / 0.005) * Math.exp(-t * (mood === 'sleepy' ? 4 : 9));
      d[i] = lp.process(Math.sin(phase) + 0.25 * Math.sin(phase * 2)) * env;
    }
    prevF = f;
  }
  return normalize(d, 0.6);
}

/** Soft robotic snore: a filtered-noise inhale, then a low buzzy exhale. */
export function snore() {
  const r = rng(1300);
  const d = buffer(1.9);
  const bp = new Biquad('bandpass', 300, 2);
  const lp = new Biquad('lowpass', 380, 0.8);
  let phase = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / SR;
    let v = 0;
    if (t < 0.95) {
      const k = t / 0.95;
      bp.set(300 + 320 * k, 2);
      v += bp.process(r() * 2 - 1) * Math.sin(Math.PI * k) * 0.9;
    } else if (t < 1.8) {
      const k = (t - 0.95) / 0.85;
      phase += (TAU * (72 - 14 * k)) / SR;
      const buzz = (phase / TAU) % 1 < 0.3 ? 1 : -0.4;
      v += lp.process(buzz + (r() * 2 - 1) * 0.3) * Math.sin(Math.PI * k) * 0.8;
    }
    d[i] = v;
  }
  return normalize(d, 0.5);
}

/** Camera shutter: two mechanical clicks and a soft thunk. */
export function shutter() {
  const r = rng(1400);
  const d = buffer(0.22);
  const hp = new Biquad('highpass', 1800, 0.7);
  const hp2 = new Biquad('highpass', 1400, 0.7);
  for (let i = 0; i < d.length; i++) {
    const t = i / SR;
    const n = r() * 2 - 1;
    let v = hp.process(n) * Math.exp(-t * 160) * 0.9;
    v += Math.sin(TAU * 3200 * t) * Math.exp(-t * 90) * 0.15;
    v += Math.sin(TAU * (120 + 60 * Math.exp(-t * 40)) * t) * Math.exp(-t * 35) * 0.5;
    const t2 = t - 0.075;
    if (t2 > 0) {
      v += hp2.process(n) * Math.exp(-t2 * 200) * 0.6;
      v += Math.sin(TAU * 2600 * t2) * Math.exp(-t2 * 110) * 0.1;
    }
    d[i] = v;
  }
  return normalize(d, 0.7);
}

/** Every sound the game uses, in synthesis order. */
export const SOUND_LIST = Object.freeze([
  ['step0', () => footstep(0)],
  ['step1', () => footstep(1)],
  ['step2', () => footstep(2)],
  ['step3', () => footstep(3)],
  ['jump', jump],
  ['land', land],
  ['bark0', () => robotBark(0)],
  ['bark1', () => robotBark(1)],
  ['bark2', () => robotBark(2)],
  ['squeak0', () => squeak(0)],
  ['squeak1', () => squeak(1)],
  ['bonk0', () => bonk(0)],
  ['bonk1', () => bonk(1)],
  ['plush', plush],
  ['vent', ventLoop],
  ['room', roomToneLoop],
  ['water', waterLoop],
  ['distant0', () => distantBark(0)],
  ['distant1', () => distantBark(1)],
  ['distant2', () => distantBark(2)],
  ['uiClick', () => uiBlip(false)],
  ['uiHover', () => uiBlip(true)],
  ['chirpHappy', () => chirp('happy')],
  ['chirpExcited', () => chirp('excited')],
  ['chirpSleepy', () => chirp('sleepy')],
  ['snore', snore],
  ['shutter', shutter],
]);
