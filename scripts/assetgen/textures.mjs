/**
 * Procedural, tileable texture synthesis (pure JS, no canvas) for the shelter.
 * Every texture is generated from integer-hashed periodic value noise so it
 * tiles seamlessly, then encoded to KTX2 (Basis Universal) by the caller.
 */

const TAU = Math.PI * 2;

function hash(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);
const mod = (a, n) => ((a % n) + n) % n;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** Periodic value noise: `period` lattice cells across the [0,1) domain. */
function vnoise(u, v, period, seed) {
  const x = u * period;
  const y = v * period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const ix0 = mod(x0, period);
  const iy0 = mod(y0, period);
  const ix1 = mod(x0 + 1, period);
  const iy1 = mod(y0 + 1, period);
  const a = hash(ix0, iy0, seed);
  const b = hash(ix1, iy0, seed);
  const c = hash(ix0, iy1, seed);
  const d = hash(ix1, iy1, seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

/** Periodic fBm. */
function fbm(u, v, basePeriod, octaves, seed, gain = 0.5) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(u, v, period, seed + o * 17) * amp;
    norm += amp;
    amp *= gain;
    period *= 2;
  }
  return sum / norm;
}

/** Anisotropic periodic fBm (different periods along u and v) for wood grain. */
function fbmAniso(u, v, pu, pv, octaves, seed) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const k = 1 << o;
    const x = u * pu * k;
    const y = v * pv * k;
    const px = pu * k;
    const py = pv * k;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const s = seed + o * 31;
    const a = hash(mod(x0, px), mod(y0, py), s);
    const b = hash(mod(x0 + 1, px), mod(y0, py), s);
    const c = hash(mod(x0, px), mod(y0 + 1, py), s);
    const d = hash(mod(x0 + 1, px), mod(y0 + 1, py), s);
    sum += lerp(lerp(a, b, fx), lerp(c, d, fx), fy) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

function makeImage(size, fn) {
  const data = new Uint8Array(size * size * 4);
  const out = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      fn((x + 0.5) / size, (y + 0.5) / size, out, x, y);
      const i = (y * size + x) * 4;
      data[i] = Math.round(clamp01(out[0]) * 255);
      data[i + 1] = Math.round(clamp01(out[1]) * 255);
      data[i + 2] = Math.round(clamp01(out[2]) * 255);
      data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

/** Honey-toned wooden planks: 8 rows, staggered joints, grain and knots. */
export function woodPlanks(size = 1024) {
  const rows = 8;
  const tones = [0xd6a46c, 0xc8955f, 0xdcae78, 0xbf8a55, 0xd09c64, 0xe0b582].map(hex);
  return makeImage(size, (u, v, out) => {
    const row = Math.floor(v * rows);
    const rv = v * rows - row;
    const offset = hash(row, 3, 7);
    const lu = mod(u + offset, 1);
    const plank = Math.floor(lu * 2);
    const pu = lu * 2 - plank;
    const id = row * 2 + plank;
    const tone = tones[Math.floor(hash(id, 1, 11) * tones.length)];
    const grain = fbmAniso(u, v, 3, rows * 6, 4, 101 + id);
    const rings = 0.5 + 0.5 * Math.sin((rv * 6 + grain * 5 + hash(id, 9, 2) * 10) * TAU * 0.5);
    const streak = fbmAniso(u, v, 2, rows * 28, 3, 211);
    let k = 0.86 + grain * 0.18 + rings * 0.06 - streak * 0.06;
    k *= 0.92 + hash(id, 4, 5) * 0.12;
    // Knots.
    const kx = hash(id, 13, 3);
    const ky = 0.5;
    const d = Math.hypot((pu - kx) * 6, (rv - ky) * 1.2);
    if (hash(id, 21, 9) > 0.65 && d < 0.18) k *= 0.75 + d * 1.2;
    // Seams.
    const seamV = Math.min(rv, 1 - rv) * (size / rows);
    const seamU = Math.min(pu, 1 - pu) * (size / 2);
    if (seamV < 1.4 || seamU < 1.2) k *= 0.55;
    else if (seamV < 2.6 || seamU < 2.2) k *= 0.85;
    out[0] = tone[0] * k;
    out[1] = tone[1] * k;
    out[2] = tone[2] * k;
  });
}

/** Square tiles with grout and subtle per-tile variation. */
export function tiles(size, count, colorsA, colorsB, grout, checker = true) {
  const A = colorsA.map(hex);
  const B = colorsB.map(hex);
  const G = hex(grout);
  return makeImage(size, (u, v, out) => {
    const tx = Math.floor(u * count);
    const ty = Math.floor(v * count);
    const fu = u * count - tx;
    const fv = v * count - ty;
    const set = checker && (tx + ty) % 2 ? B : A;
    const base = set[Math.floor(hash(tx, ty, 5) * set.length)];
    const n = fbm(u, v, count * 2, 3, 77);
    const edge = Math.min(fu, 1 - fu, fv, 1 - fv) * (size / count);
    let k = 0.94 + n * 0.1 + hash(tx, ty, 9) * 0.04;
    if (edge < 2.2) {
      out[0] = G[0] * (0.9 + n * 0.15);
      out[1] = G[1] * (0.9 + n * 0.15);
      out[2] = G[2] * (0.9 + n * 0.15);
      return;
    }
    if (edge < 5) k *= 0.93 + (edge - 2.2) * 0.025;
    out[0] = base[0] * k;
    out[1] = base[1] * k;
    out[2] = base[2] * k;
  });
}

/** Speckled EPDM rubber detail (near-white, multiplies vertex colours). */
export function rubberSpeckle(size = 512) {
  return makeImage(size, (u, v, out) => {
    const n = fbm(u, v, 8, 4, 5);
    const fine = vnoise(u, v, 256, 13);
    let k = 0.9 + n * 0.08;
    if (fine > 0.82) k *= 0.82;
    else if (fine < 0.12) k = Math.min(1, k * 1.08);
    out[0] = k;
    out[1] = k;
    out[2] = k;
  });
}

/** Light terrazzo / speckled epoxy floor. */
export function epoxyTerrazzo(size = 512) {
  const base = hex(0xd8dbe2);
  const flecks = [0x9aa3b5, 0xf3f1ea, 0xc89f7a, 0x7f8aa3, 0xe6c7a5, 0x6f9fa0].map(hex);
  const cells = 48;
  return makeImage(size, (u, v, out) => {
    const cloud = fbm(u, v, 4, 4, 51);
    let r = base[0] * (0.95 + cloud * 0.08);
    let g = base[1] * (0.95 + cloud * 0.08);
    let b = base[2] * (0.95 + cloud * 0.08);
    const cx = Math.floor(u * cells);
    const cy = Math.floor(v * cells);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const ix = mod(cx + ox, cells);
        const iy = mod(cy + oy, cells);
        if (hash(ix, iy, 3) > 0.34) continue;
        const px = (cx + ox + hash(ix, iy, 7)) / cells;
        const py = (cy + oy + hash(ix, iy, 8)) / cells;
        const rad = (0.1 + hash(ix, iy, 9) * 0.24) / cells;
        const d = Math.hypot(u - px, v - py);
        if (d < rad) {
          const c = flecks[Math.floor(hash(ix, iy, 10) * flecks.length)];
          r = c[0];
          g = c[1];
          b = c[2];
        }
      }
    }
    out[0] = r;
    out[1] = g;
    out[2] = b;
  });
}

/** Woven fabric detail (near-white). */
export function fabricWeave(size = 256) {
  const threads = 64;
  return makeImage(size, (u, v, out) => {
    const tu = u * threads;
    const tv = v * threads;
    const over = (Math.floor(tu) + Math.floor(tv)) % 2;
    const wu = Math.sin((tu % 1) * Math.PI);
    const wv = Math.sin((tv % 1) * Math.PI);
    const w = over ? wu * 0.7 + 0.3 : wv * 0.7 + 0.3;
    const n = fbm(u, v, 16, 3, 61);
    const k = 0.8 + w * 0.16 + n * 0.06;
    out[0] = k;
    out[1] = k;
    out[2] = k;
  });
}

/** Furniture wood grain (warm near-white, multiplies vertex colours). */
export function woodGrain(size = 512) {
  return makeImage(size, (u, v, out) => {
    const g = fbmAniso(u, v, 2, 24, 4, 401);
    const rings = 0.5 + 0.5 * Math.sin((u * 3 + g * 4) * TAU);
    const k = 0.84 + g * 0.12 + rings * 0.06;
    out[0] = k;
    out[1] = k * 0.96;
    out[2] = k * 0.92;
  });
}

/** Subtle plaster mottling for walls (near-white). */
export function plaster(size = 256) {
  return makeImage(size, (u, v, out) => {
    const n = fbm(u, v, 6, 5, 91);
    const k = 0.93 + n * 0.07;
    out[0] = k;
    out[1] = k;
    out[2] = k;
  });
}

/** All colour textures with their encoding settings. */
export function textureSet() {
  return [
    { name: 'floor_wood', image: () => woodPlanks(1024), quality: 200 },
    {
      name: 'floor_tile_warm',
      image: () => tiles(512, 4, [0xf3e4c6, 0xefdcba], [0xe8a27a, 0xe39a70], 0xc9b490, true),
      quality: 180,
    },
    {
      name: 'floor_tile_mint',
      image: () => tiles(512, 6, [0xf4f7f2, 0xeef3ed], [0xa6e1cc, 0x9bd8c2], 0xcfd8d0, true),
      quality: 180,
    },
    { name: 'detail_rubber', image: () => rubberSpeckle(512), quality: 160 },
    { name: 'floor_epoxy', image: () => epoxyTerrazzo(512), quality: 180 },
    { name: 'detail_fabric', image: () => fabricWeave(256), quality: 160 },
    { name: 'detail_wood', image: () => woodGrain(512), quality: 170 },
    { name: 'detail_plaster', image: () => plaster(256), quality: 150 },
  ];
}
