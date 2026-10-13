import { SphereGeometry } from 'three';
import { PartBuilder } from './PartBuilder.js';
import { C } from './palette.js';
import { boneShape, extrude, rbox, rng, sphere, torus, tube } from './shapes.js';

/*
 * Dynamic toys. Geometry is centred on the body's centre of mass and matches
 * the collision shapes in TOY_CATALOG. No ground AO (they move).
 */

const noAO = () => new PartBuilder({ groundAO: 0 });

export function tennisBall() {
  const b = noAO();
  const r = 0.07;
  b.add('fabric', sphere(r, 20, 14), { color: 0xd8ef3c });
  const pts = [];
  const a = 0.75;
  const k = 0.25;
  const c = 2 * Math.sqrt(a * k);
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    const x = a * Math.cos(t) + k * Math.cos(3 * t);
    const y = a * Math.sin(t) - k * Math.sin(3 * t);
    const z = c * Math.sin(2 * t);
    const len = Math.hypot(x, y, z);
    pts.push([(x / len) * r * 1.01, (z / len) * r * 1.01, (y / len) * r * 1.01]);
  }
  b.add('matte', tube(pts, 0.004, 96, 5, true), { color: 0xf6f8ee });
  return b;
}

export function rubberBall() {
  const b = noAO();
  b.add('gloss', sphere(0.13, 24, 16), { color: C.red });
  b.add('gloss', torus(0.128, 0.018, 8, 40), { color: C.yellow, rotation: [Math.PI / 2, 0, 0] });
  return b;
}

/** Six crisp coloured gores + white caps. */
export function beachBall() {
  const b = noAO();
  const r = 0.36;
  const gores = [C.red, C.yellow, C.blue, C.green, C.orange, C.white];
  const cap = 0.22;
  for (let i = 0; i < 6; i++) {
    const g = new SphereGeometry(
      r,
      8,
      14,
      (i / 6) * Math.PI * 2,
      Math.PI / 3,
      cap,
      Math.PI - cap * 2,
    );
    b.add('gloss', g, { color: gores[i] });
  }
  b.add('gloss', new SphereGeometry(r, 24, 4, 0, Math.PI * 2, 0, cap), { color: C.white });
  b.add('gloss', new SphereGeometry(r, 24, 4, 0, Math.PI * 2, Math.PI - cap, cap), {
    color: C.white,
  });
  b.add('gloss', sphere(0.035, 10, 6), {
    color: C.white,
    position: [0, r * 0.995, 0],
    scale: [1, 0.35, 1],
  });
  return b;
}

export function plushBone() {
  const b = noAO();
  const g = extrude(boneShape(0.38, 0.15), 0.1, 0.035, 10);
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.PI / 2);
  b.add('fabric', g, { color: 0xf3e2c0 });
  return b;
}

export function plushDuck() {
  const b = noAO();
  const yellow = 0xffd84a;
  b.add('fabric', sphere(0.12, 20, 14), {
    color: yellow,
    position: [0, -0.02, -0.01],
    scale: [1, 0.82, 1.15],
  });
  b.add('fabric', sphere(0.075, 18, 12), { color: yellow, position: [0, 0.095, 0.07] });
  b.add('fabric', rbox(0.075, 0.026, 0.065, 0.012), {
    color: C.orange,
    position: [0, 0.085, 0.145],
  });
  for (const s of [-1, 1]) {
    b.add('gloss', sphere(0.012, 8, 6), { color: C.charcoal, position: [s * 0.036, 0.118, 0.128] });
    b.add('fabric', sphere(0.08, 14, 10), {
      color: 0xf5c63c,
      position: [s * 0.108, -0.01, -0.02],
      scale: [0.35, 0.7, 1.0],
    });
  }
  b.add('fabric', sphere(0.05, 12, 8), {
    color: yellow,
    position: [0, 0.03, -0.14],
    scale: [0.6, 0.5, 1],
  });
  return b;
}

export function donutRing() {
  const b = noAO();
  const g = torus(0.13, 0.05, 14, 40);
  g.rotateX(Math.PI / 2);
  b.add('fabric', g, {
    color: (x, y, z, out) => {
      const wave = Math.sin(Math.atan2(z, x) * 7) * 0.008;
      out.set(y > 0.006 + wave ? 0xff8fb5 : 0xd9a066);
    },
  });
  const rand = rng(99);
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2;
    const rr = 0.13 + (rand() - 0.5) * 0.05;
    b.add('gloss', rbox(0.022, 0.006, 0.006, 0.002, 1), {
      color: [C.white, C.yellow, C.sky, C.mint][i % 4],
      position: [Math.cos(a) * rr, 0.048, Math.sin(a) * rr],
      rotation: [0, rand() * Math.PI, 0],
    });
  }
  return b;
}

/** Dice-like squeaky cube. */
export function squeakyCube() {
  const b = noAO();
  const s = 0.18;
  b.add('gloss', rbox(s, s, s, 0.04, 3), { color: C.teal });
  const h = s / 2 + 0.001;
  const d = 0.045;
  const pips = {
    1: [[0, 0]],
    2: [
      [-d, -d],
      [d, d],
    ],
    3: [
      [-d, -d],
      [0, 0],
      [d, d],
    ],
    4: [
      [-d, -d],
      [d, -d],
      [-d, d],
      [d, d],
    ],
    5: [
      [-d, -d],
      [d, -d],
      [0, 0],
      [-d, d],
      [d, d],
    ],
    6: [
      [-d, -d],
      [d, -d],
      [-d, 0],
      [d, 0],
      [-d, d],
      [d, d],
    ],
  };
  const faces = [
    [1, (u, v) => [u, h, v]],
    [6, (u, v) => [u, -h, v]],
    [2, (u, v) => [h, u, v]],
    [5, (u, v) => [-h, u, v]],
    [3, (u, v) => [u, v, h]],
    [4, (u, v) => [u, v, -h]],
  ];
  for (const [n, place] of faces) {
    for (const [u, v] of pips[n]) {
      b.add('gloss', sphere(0.014, 8, 6), { color: C.white, position: place(u, v), scale: 0.9 });
    }
  }
  return b;
}
