import { Shape, ShapeGeometry } from 'three';
import { PartBuilder } from './PartBuilder.js';
import { C } from './palette.js';
import { blob, cyl, lathe, rng, tube, vary } from './shapes.js';

/**
 * Broad tropical leaf in the XY plane pointing +Y, bent backwards along its
 * length and cupped across its width for a soft, stylised silhouette.
 */
function leafGeometry(length, width, bend = 0.25, cup = 0.12) {
  const s = new Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(width * 0.62, length * 0.18, width * 0.55, length * 0.72, 0, length);
  s.bezierCurveTo(-width * 0.55, length * 0.72, -width * 0.62, length * 0.18, 0, 0);
  const g = new ShapeGeometry(s, 10);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = y / length;
    pos.setZ(i, bend * length * t * t + cup * Math.abs(x) * (1 - t * 0.5));
  }
  g.computeVertexNormals();
  return g;
}

/** Narrow upright blade (snake plant). */
function bladeGeometry(height, width) {
  const s = new Shape();
  s.moveTo(-width / 2, 0);
  s.bezierCurveTo(-width * 0.7, height * 0.4, -width * 0.35, height * 0.85, 0, height);
  s.bezierCurveTo(width * 0.35, height * 0.85, width * 0.7, height * 0.4, width / 2, 0);
  s.lineTo(-width / 2, 0);
  const g = new ShapeGeometry(s, 8);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, -Math.abs(x) * 0.6);
  }
  g.computeVertexNormals();
  return g;
}

function pot(b, r, h, color, slot = 'matte') {
  b.add(
    slot,
    lathe(
      [
        [0, 0.01],
        [r * 0.72, 0.01],
        [r * 0.78, 0],
        [r * 0.92, h * 0.82],
        [r * 1.05, h * 0.86],
        [r * 1.06, h],
        [r * 0.94, h],
        [r * 0.9, h * 0.9],
        [0, h * 0.9],
      ],
      28,
    ),
    { color },
  );
  b.add('matte', cyl(r * 0.9, r * 0.9, 0.01, 24), {
    color: C.soil,
    position: [0, h * 0.9, 0],
    noAO: true,
  });
}

/**
 * Large potted plant (monstera-like). LOD 0 = dense, LOD 1 = sparse.
 * @param {number} lod
 */
export function plantLarge(lod = 0) {
  const b = new PartBuilder();
  const rand = rng(31);
  pot(b, 0.3, 0.5, C.terracotta);
  const count = lod === 0 ? 15 : 7;
  for (let i = 0; i < count; i++) {
    const yaw = (i / count) * Math.PI * 2 + rand() * 0.4;
    const tilt = 0.35 + rand() * 0.75;
    const stemLen = 0.35 + rand() * 0.55;
    const sx = Math.sin(yaw) * Math.sin(tilt) * stemLen * 0.55;
    const sz = Math.cos(yaw) * Math.sin(tilt) * stemLen * 0.55;
    const sy = 0.45 + Math.cos(tilt) * stemLen;
    if (lod === 0) {
      b.add(
        'leaf',
        tube(
          [
            [0, 0.45, 0],
            [sx * 0.5, (0.45 + sy) * 0.5 + 0.08, sz * 0.5],
            [sx, sy, sz],
          ],
          0.012,
          8,
          5,
        ),
        {
          color: C.leafDark,
        },
      );
    }
    const len = (0.38 + rand() * 0.2) * (lod === 0 ? 1 : 1.25);
    b.add('leaf', leafGeometry(len, len * 0.85, 0.3, 0.18), {
      color: (x, y, z, out) => {
        out.set(vary(i % 3 === 0 ? C.leafLight : C.leaf, rand, 0.12));
        const k = 0.75 + Math.min(1, (y - 0.45) / 1.1) * 0.35;
        out.multiplyScalar(k);
      },
      position: [sx, sy, sz],
      rotation: [tilt + 0.25, yaw, 0, 'YXZ'],
      noAO: true,
    });
  }
  return b;
}

/** Small potted snake plant. */
export function plantSmall(lod = 0) {
  const b = new PartBuilder();
  const rand = rng(41);
  pot(b, 0.17, 0.3, C.blue, 'gloss');
  const count = lod === 0 ? 8 : 4;
  for (let i = 0; i < count; i++) {
    const yaw = (i / count) * Math.PI * 2 + rand() * 0.6;
    const h = 0.42 + rand() * 0.28;
    b.add('leaf', bladeGeometry(h, 0.09), {
      color: (x, y, _z, out) => {
        const edge = Math.abs(x) > 0.035 ? 1 : 0;
        out.set(edge ? 0xc9d96a : vary(C.leafDark, rand, 0.1));
        out.multiplyScalar(0.85 + (y / 1.0) * 0.3);
      },
      position: [Math.sin(yaw) * 0.04, 0.27, Math.cos(yaw) * 0.04],
      rotation: [0.12 + rand() * 0.15, yaw, 0, 'YXZ'],
      noAO: true,
    });
  }
  return b;
}

/** Outdoor stylised tree (seen through windows). */
export function tree(lod = 0, seed = 1) {
  const b = new PartBuilder({ groundAO: 0 });
  const rand = rng(seed);
  b.add('matte', cyl(0.16, 0.26, 2.4, lod === 0 ? 10 : 6), {
    color: 0x6b4a33,
    position: [0, 1.2, 0],
  });
  const clumps = lod === 0 ? 6 : 2;
  for (let i = 0; i < clumps; i++) {
    const a = rand() * Math.PI * 2;
    const r = i === 0 ? 0 : 0.6 + rand() * 0.5;
    const size = i === 0 ? 1.5 : 0.9 + rand() * 0.5;
    b.add('leaf', blob(size, lod === 0 ? 1 : 0), {
      color: vary(i % 2 ? 0x5fae4f : 0x4f9a47, rand, 0.1),
      position: [Math.cos(a) * r, 2.9 + rand() * 0.9 + (i === 0 ? 0.6 : 0), Math.sin(a) * r],
      scale: [1, 0.85, 1],
    });
  }
  return b;
}

/** Outdoor bush. */
export function bush(seed = 5) {
  const b = new PartBuilder({ groundAO: 0 });
  const rand = rng(seed);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    b.add('leaf', blob(0.55 + rand() * 0.25, 1), {
      color: vary(0x5aa64a, rand, 0.12),
      position: [Math.cos(a) * 0.45, 0.4 + rand() * 0.2, Math.sin(a) * 0.45],
    });
  }
  return b;
}
