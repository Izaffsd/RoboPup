import {
  BoxGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  ExtrudeGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Small, deterministic geometry vocabulary used by the procedural generators.
 * Every function returns a fresh BufferGeometry centred at the origin unless
 * noted otherwise.
 */

/**
 * Rounded box (soft "toy" edges are what sells the stylised look). Bevel
 * segments default to the cheapest count that still reads as rounded for the
 * given radius: RoundedBoxGeometry emits ~(2·seg+2)²·6 vertices.
 */
export function rbox(w, h, d, r = 0.03, seg) {
  const radius = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const segments = seg ?? (radius < 0.015 ? 1 : 2);
  return new RoundedBoxGeometry(w, h, d, segments, radius);
}

/** Plain box. */
export const box = (w, h, d) => new BoxGeometry(w, h, d);

/** Cylinder (Y axis). */
export const cyl = (rTop, rBottom, h, radial = 16, open = false) =>
  new CylinderGeometry(rTop, rBottom, h, radial, 1, open);

/** Sphere. */
export const sphere = (r, w = 16, h = 12) => new SphereGeometry(r, w, h);

/** Low-poly blob (icosahedron) — foliage clumps. */
export const blob = (r, detail = 1) => new IcosahedronGeometry(r, detail);

/** Capsule along Y with total cylinder `length` between cap centres. */
export const capsule = (r, length, cap = 4, radial = 12) =>
  new CapsuleGeometry(r, length, cap, radial);

/** Torus in the XY plane. */
export const torus = (R, r, radial = 10, tubular = 32, arc = Math.PI * 2) =>
  new TorusGeometry(R, r, radial, tubular, arc);

/**
 * Lathe from [radius, y] pairs around Y.
 * @param {number[][]} profile
 */
export const lathe = (profile, segments = 28) =>
  new LatheGeometry(
    profile.map(([r, y]) => new Vector2(Math.max(0, r), y)),
    segments,
  );

/**
 * Extrude a 2D outline (XY) along +Z with soft bevels, centred on Z.
 * @param {Shape} shape
 * @param {number} depth
 */
export function extrude(shape, depth, bevel = 0.01, curveSegments = 12) {
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, depth - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments,
  });
  g.translate(0, 0, -depth / 2 + bevel);
  return g;
}

/**
 * Tube through 3D points.
 * @param {number[][]} points
 */
export function tube(points, radius, tubular = 24, radial = 8, closed = false) {
  const curve = new CatmullRomCurve3(
    points.map(([x, y, z]) => new Vector3(x, y, z)),
    closed,
    'catmullrom',
    0.2,
  );
  return new TubeGeometry(curve, tubular, radius, radial, closed);
}

/** Rounded rectangle outline centred at the origin. */
export function roundedRectShape(w, h, r) {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Classic dog-bone outline (for plush toys and decals), length along X. */
export function boneShape(length, width) {
  const s = new Shape();
  const hl = length / 2;
  const hw = width / 2;
  const kr = width * 0.55;
  const neck = hw * 0.55;
  s.moveTo(-hl + kr * 0.9, -neck);
  s.lineTo(hl - kr * 0.9, -neck);
  s.absarc(hl - kr * 0.55, -hw * 0.65, kr * 0.55, Math.PI * 0.9, Math.PI * 2.35, false);
  s.absarc(hl - kr * 0.55, hw * 0.65, kr * 0.55, -Math.PI * 0.35, Math.PI * 1.1, false);
  s.lineTo(-hl + kr * 0.9, neck);
  s.absarc(-hl + kr * 0.55, hw * 0.65, kr * 0.55, -Math.PI * 0.1, Math.PI * 1.35, false);
  s.absarc(-hl + kr * 0.55, -hw * 0.65, kr * 0.55, Math.PI * 0.65, Math.PI * 2.1, false);
  return s;
}

/** Paw-print outline set: returns [mainPad, ...toes] shapes, ~1 unit tall. */
export function pawShapes() {
  const shapes = [];
  const pad = new Shape();
  pad.moveTo(0, -0.42);
  pad.bezierCurveTo(0.32, -0.42, 0.42, -0.1, 0.3, 0.06);
  pad.bezierCurveTo(0.2, 0.18, -0.2, 0.18, -0.3, 0.06);
  pad.bezierCurveTo(-0.42, -0.1, -0.32, -0.42, 0, -0.42);
  shapes.push(pad);
  const toes = [
    [-0.36, 0.26, 0.11, 0.14],
    [-0.13, 0.42, 0.11, 0.15],
    [0.13, 0.42, 0.11, 0.15],
    [0.36, 0.26, 0.11, 0.14],
  ];
  for (const [x, y, rx, ry] of toes) {
    const t = new Shape();
    t.absellipse(x, y, rx, ry, 0, Math.PI * 2, false, 0);
    shapes.push(t);
  }
  return shapes;
}

/** Deterministic PRNG (mulberry32) so generated assets are reproducible. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Jitter a hex colour's lightness deterministically (±amount). */
export function vary(hex, rand, amount = 0.06) {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const k = 1 + (rand() * 2 - 1) * amount;
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k * 255)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}
