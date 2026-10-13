import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Group,
  Mesh,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import {
  A_FRAMES,
  BEAM,
  BEAM_XS,
  BOUNDS,
  BUNTING,
  COLUMNS,
  COLUMN_SIZE,
  DOMES,
  DUCTS,
  INTERIOR_WALLS,
  OUTER_WALLS,
  PAW_TRAILS,
  PLATFORMS,
  PROPS,
  RAILINGS,
  RAILING_BASE,
  RAILING_HEIGHT,
  RAMPS,
  ZONES,
  ZONE_WALL_COLORS,
  AUDIO_EMITTERS,
  zoneAt,
} from './layout.js';
import { doormat, rugRect, rugRound } from './props/furniture.js';
import { PartBuilder, addTopDownUV1, planarUV } from './props/PartBuilder.js';
import { C } from './props/palette.js';
import { boneShape, box, cyl, pawShapes, rbox, rng, torus, tube } from './props/shapes.js';

const WAINSCOT = 1.15;
const UPPER = 0xf6eedf;
const TRIM = 0xfbf8f1;
const H = BOUNDS.ceiling;
const T = BOUNDS.wallThickness;

/** Texture repeats per metre for each textured slot (planar mapping). */
const UV_DENSITY = Object.freeze({
  floor_wood: 1 / 2.4,
  deck_wood: 1 / 2.4,
  floor_tile_warm: 1 / 2.4,
  floor_tile_mint: 1 / 2.1,
  floor_epoxy: 1 / 3,
  floor_rubber: 1 / 2,
  deck_play: 1 / 2,
  deck_soft: 1,
  decal_floor: 1,
  rug_floor: 3.5,
  wall: 0.5,
  ceiling: 0.35,
  wood: 2.2,
  fabric: 3.5,
});

/** Slots that receive the baked top-down lightmap. */
const LIGHTMAPPED = new Set([
  'floor_wood',
  'floor_tile_warm',
  'floor_tile_mint',
  'floor_epoxy',
  'floor_rubber',
  'deck_wood',
  'deck_play',
  'deck_soft',
  'decal_floor',
  'rug_floor',
]);

/**
 * Floor coverings are part of the floor (not instanced props) so they receive
 * the baked sun patches and lamp pools like the floor around them.
 */
export const FLOOR_COVERINGS = Object.freeze({ rugRect, rugRound, doormat });

const sides = {
  south: {
    alongX: true,
    inner: BOUNDS.maxZ,
    inward: -1,
    start: BOUNDS.minX - T,
    end: BOUNDS.maxX + T,
  },
  north: {
    alongX: true,
    inner: BOUNDS.minZ,
    inward: 1,
    start: BOUNDS.minX - T,
    end: BOUNDS.maxX + T,
  },
  east: { alongX: false, inner: BOUNDS.maxX, inward: -1, start: BOUNDS.minZ, end: BOUNDS.maxZ },
  west: { alongX: false, inner: BOUNDS.minX, inward: 1, start: BOUNDS.minZ, end: BOUNDS.maxZ },
};

const BREAKS = { true: [-8, 2, 8], false: [-3, 4, 5] };

/**
 * Add an axis-aligned box described in wall space: [a,b] along the wall,
 * [y0,y1] vertically, [d0,d1] depth measured from the inner face outwards
 * (negative depth protrudes into the room).
 */
function wallBox(builder, slot, side, a, b, y0, y1, d0, d1, color) {
  if (b - a < 1e-4 || y1 - y0 < 1e-4) return;
  const s = sides[side];
  const along = (a + b) / 2;
  const normal = s.inner - s.inward * ((d0 + d1) / 2);
  const len = b - a;
  const thick = d1 - d0;
  const g = box(s.alongX ? len : thick, y1 - y0, s.alongX ? thick : len);
  const position = s.alongX ? [along, (y0 + y1) / 2, normal] : [normal, (y0 + y1) / 2, along];
  builder.add(slot, g, { color, position });
}

function zoneColorAt(side, along) {
  const s = sides[side];
  const inside = s.inner + s.inward * 0.5;
  const zone = s.alongX ? zoneAt(along, inside) : zoneAt(inside, along);
  return ZONE_WALL_COLORS[zone.id] ?? ZONE_WALL_COLORS.hall;
}

function darken(hex, k) {
  const r = Math.round(((hex >> 16) & 255) * k);
  const g = Math.round(((hex >> 8) & 255) * k);
  const b = Math.round((hex & 255) * k);
  return (r << 16) | (g << 8) | b;
}

/** Solid wall piece with wainscot, baseboard and chair rail, split at zone borders. */
function solidWall(walls, trims, side, a, b, y0, y1) {
  if (b - a < 1e-4 || y1 - y0 < 1e-4) return;
  const cuts = [a, ...BREAKS[sides[side].alongX].filter((v) => v > a && v < b), b];
  for (let i = 0; i < cuts.length - 1; i++) {
    const p = cuts[i];
    const q = cuts[i + 1];
    const zc = zoneColorAt(side, (p + q) / 2);
    if (y0 < WAINSCOT) wallBox(walls, 'wall', side, p, q, y0, Math.min(y1, WAINSCOT), 0, T, zc);
    if (y1 > WAINSCOT) wallBox(walls, 'wall', side, p, q, Math.max(y0, WAINSCOT), y1, 0, T, UPPER);
    if (y0 <= 1e-4) wallBox(trims, 'paint', side, p, q, 0, 0.13, -0.022, 0, darken(zc, 0.72));
    if (y0 < WAINSCOT && y1 > WAINSCOT) {
      wallBox(trims, 'paint', side, p, q, WAINSCOT - 0.03, WAINSCOT + 0.03, -0.03, 0, TRIM);
    }
  }
}

function openingFrames(trims, glass, side, o) {
  const a = o.center - o.width / 2;
  const b = o.center + o.width / 2;
  const fw = 0.08;
  wallBox(trims, 'paint', side, a, a + fw, o.bottom, o.top, -0.03, T + 0.01, TRIM);
  wallBox(trims, 'paint', side, b - fw, b, o.bottom, o.top, -0.03, T + 0.01, TRIM);
  wallBox(trims, 'paint', side, a, b, o.top - fw, o.top, -0.03, T + 0.01, TRIM);

  if (o.kind === 'window') {
    wallBox(
      trims,
      'wood',
      side,
      a - 0.08,
      b + 0.08,
      o.bottom - 0.05,
      o.bottom + 0.012,
      -0.17,
      T + 0.01,
      C.woodLight,
    );
    const px = o.panesX || 1;
    const py = o.panesY || 1;
    for (let i = 1; i < px; i++) {
      const m = a + ((b - a) * i) / px;
      wallBox(trims, 'paint', side, m - 0.035, m + 0.035, o.bottom, o.top, 0.1, 0.2, TRIM);
    }
    for (let j = 1; j < py; j++) {
      const m = o.bottom + ((o.top - o.bottom) * j) / py;
      wallBox(trims, 'paint', side, a, b, m - 0.035, m + 0.035, 0.1, 0.2, TRIM);
    }
    wallBox(glass, 'glass', side, a + fw, b - fw, o.bottom, o.top - fw, 0.145, 0.155, 0xffffff);
  } else if (o.kind === 'door') {
    const mid = (a + b) / 2;
    wallBox(trims, 'paint', side, mid - 0.04, mid + 0.04, 0, o.top, 0.08, 0.22, TRIM);
    wallBox(trims, 'metal', side, a + fw, b - fw, 0, 0.26, 0.11, 0.19, C.steel);
    wallBox(trims, 'metal', side, a + 0.2, mid - 0.15, 1.0, 1.05, -0.06, 0.1, C.chrome);
    wallBox(trims, 'metal', side, mid + 0.15, b - 0.2, 1.0, 1.05, -0.06, 0.1, C.chrome);
    wallBox(glass, 'glass', side, a + fw, b - fw, 0.26, o.top - fw, 0.145, 0.155, 0xffffff);
  } else {
    const leaves = o.width > 1.3 ? 2 : 1;
    const color = o.label === 'staff' ? C.teal : C.orange;
    const lw = (b - a - fw * 2) / leaves;
    for (let i = 0; i < leaves; i++) {
      const la = a + fw + lw * i;
      const lb = la + lw;
      wallBox(trims, 'paint', side, la + 0.005, lb - 0.005, 0.01, o.top - fw, 0.08, 0.14, color);
      wallBox(trims, 'paint', side, la + 0.1, lb - 0.1, 0.2, 0.95, 0.065, 0.08, darken(color, 0.9));
      wallBox(glass, 'glass', side, la + 0.15, lb - 0.15, 1.45, 2.0, 0.09, 0.1, 0xffffff);
      const handle = leaves === 2 ? (i === 0 ? lb - 0.12 : la + 0.12) : lb - 0.12;
      wallBox(trims, 'metal', side, handle - 0.015, handle + 0.015, 0.95, 1.1, 0.0, 0.08, C.chrome);
    }
  }
}

function buildOuterWalls(walls, trims, glass) {
  for (const side of Object.keys(sides)) {
    const s = sides[side];
    const openings = [...OUTER_WALLS[side]].sort((p, q) => p.center - q.center);
    let cursor = s.start;
    for (const o of openings) {
      const a = o.center - o.width / 2;
      const b = o.center + o.width / 2;
      solidWall(walls, trims, side, cursor, a, 0, H);
      solidWall(walls, trims, side, a, b, 0, o.bottom);
      solidWall(walls, trims, side, a, b, o.top, H);
      openingFrames(trims, glass, side, o);
      cursor = b;
    }
    solidWall(walls, trims, side, cursor, s.end, 0, H);
  }
}

function buildInterior(walls, trims, decals) {
  for (const w of INTERIOR_WALLS) {
    if (w.style === 'kennel') {
      const color = w.z < -9 ? 0x9c94d6 : 0x7fb8d9;
      walls.add('paint', rbox(w.sx, w.height, w.sz, 0.04), {
        color,
        position: [w.x, w.height / 2, w.z],
      });
      walls.add('paint', rbox(w.sx + 0.04, 0.07, w.sz + 0.04, 0.03), {
        color: TRIM,
        position: [w.x, w.height + 0.02, w.z],
      });
      walls.add('paint', rbox(w.sx + 0.02, 0.1, w.sz + 0.01, 0.02), {
        color: darken(color, 0.75),
        position: [w.x, 0.05, w.z],
      });
    } else if (w.style === 'back') {
      walls.add('wall', box(w.sx, WAINSCOT, w.sz), {
        color: ZONE_WALL_COLORS.hall,
        position: [w.x, WAINSCOT / 2, w.z],
      });
      walls.add('wall', box(w.sx, w.height - WAINSCOT, w.sz), {
        color: UPPER,
        position: [w.x, (w.height + WAINSCOT) / 2, w.z],
      });
      walls.add('paint', rbox(w.sx + 0.04, 0.08, w.sz + 0.06, 0.03), {
        color: TRIM,
        position: [w.x, w.height, w.z],
      });
      for (const s of [-1, 1]) {
        walls.add('paint', box(w.sx, 0.06, 0.03), {
          color: TRIM,
          position: [w.x, WAINSCOT, w.z + s * (w.sz / 2 + 0.012)],
        });
      }
      buildMural(decals, w);
    } else {
      walls.add('wall', box(w.sx, w.height, w.sz), {
        color: ZONE_WALL_COLORS.reception,
        position: [w.x, w.height / 2, w.z],
      });
      walls.add('wood', rbox(w.sx + 0.06, 0.06, w.sz + 0.1, 0.025), {
        color: C.woodLight,
        position: [w.x, w.height + 0.03, w.z],
      });
    }
  }
  for (const c of COLUMNS) {
    walls.add('paint', rbox(COLUMN_SIZE, H, COLUMN_SIZE, 0.03), {
      color: UPPER,
      position: [c.x, H / 2, c.z],
    });
    walls.add('paint', rbox(COLUMN_SIZE + 0.04, 0.16, COLUMN_SIZE + 0.04, 0.02), {
      color: darken(ZONE_WALL_COLORS.hall, 0.8),
      position: [c.x, 0.08, c.z],
    });
    walls.add('paint', rbox(COLUMN_SIZE + 0.03, 0.08, COLUMN_SIZE + 0.03, 0.02), {
      color: ZONE_WALL_COLORS.hall,
      position: [c.x, WAINSCOT, c.z],
    });
  }
}

/** Pastel paw prints, bones and hearts painted on the kennel block's back wall. */
function buildMural(decals, w) {
  const rand = rng(2024);
  const colors = [C.coral, C.yellow, C.teal, C.lilac, C.sky, C.pink, C.orange];
  const faceZ = w.z + w.sz / 2 + 0.006;
  const backZ = w.z - w.sz / 2 - 0.006;
  const x0 = w.x - w.sx / 2 + 0.6;
  const x1 = w.x + w.sx / 2 - 0.6;
  let i = 0;
  for (let x = x0; x <= x1; x += 1.25) {
    const y = 1.5 + Math.sin(i * 1.3) * 0.25;
    const color = colors[i % colors.length];
    const scale = 0.32 + rand() * 0.12;
    const tilt = (rand() - 0.5) * 0.6;
    if (i % 3 === 2) {
      decals.add('decal', new ShapeGeometry(boneShape(1.4, 0.45), 10), {
        color,
        position: [x, y, faceZ],
        rotation: [0, 0, tilt],
        scale: [scale, scale, 1],
        noAO: true,
      });
    } else {
      for (const s of pawShapes()) {
        decals.add('decal', new ShapeGeometry(s, 10), {
          color,
          position: [x, y, faceZ],
          rotation: [0, 0, tilt],
          scale: [scale * 0.9, scale * 0.9, 1],
          noAO: true,
        });
      }
    }
    // Small hearts along the kennel-facing side.
    decals.add('decal', new ShapeGeometry(heartShape(0.22), 10), {
      color: colors[(i + 3) % colors.length],
      position: [x, 1.75, backZ],
      rotation: [0, Math.PI, 0],
      noAO: true,
    });
    i++;
  }
}

function heartShape(size) {
  const s = new Shape();
  const k = size;
  s.moveTo(0, -0.5 * k);
  s.bezierCurveTo(0.6 * k, -0.05 * k, 0.55 * k, 0.55 * k, 0, 0.3 * k);
  s.bezierCurveTo(-0.55 * k, 0.55 * k, -0.6 * k, -0.05 * k, 0, -0.5 * k);
  return s;
}

/** Rainbow + hills mural on the play zone's north wall. */
function buildPlayMural(decals) {
  const z = BOUNDS.minZ + 0.006;
  const cx = 11;
  const colors = [C.red, C.orange, C.yellow, C.green, C.blue, C.purple];
  colors.forEach((color, i) => {
    const R = 2.3 - i * 0.2;
    decals.add('decal', torus(R, 0.09, 4, 48, Math.PI), {
      color,
      position: [cx, 1.2, z],
      scale: [1, 1, 0.02],
      noAO: true,
    });
  });
  for (const [x, r, color] of [
    [6.5, 1.6, 0x7cc46b],
    [9.5, 1.2, 0x5fae58],
    [14.5, 1.8, 0x7cc46b],
    [17.2, 1.1, 0x5fae58],
  ]) {
    const g = new SphereGeometry(r, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    decals.add('decal', g, {
      color,
      position: [x, WAINSCOT, z],
      scale: [1, 0.55, 0.02],
      noAO: true,
    });
  }
  decals.add('decal', new SphereGeometry(0.55, 24, 12), {
    color: C.yellow,
    position: [cx + 4.6, 3.1, z],
    scale: [1, 1, 0.02],
    noAO: true,
  });
}

function buildCeiling(walls, trims) {
  const g = new PlaneGeometry(
    BOUNDS.maxX - BOUNDS.minX + 2 * T,
    BOUNDS.maxZ - BOUNDS.minZ + 2 * T,
    1,
    1,
  );
  g.rotateX(Math.PI / 2);
  walls.add('ceiling', g, { color: 0xf2ece0, position: [0, H, 0], noAO: true });
  for (const x of BEAM_XS) {
    trims.add('wood', box(BEAM.width, BEAM.depth, BOUNDS.maxZ - BOUNDS.minZ), {
      color: C.woodMid,
      position: [x, H - BEAM.depth / 2, 0],
      noAO: true,
    });
  }
  for (const d of DUCTS) {
    const len = d.x1 - d.x0;
    trims.add('metal', cyl(d.radius, d.radius, len, 20, true), {
      color: C.steel,
      position: [(d.x0 + d.x1) / 2, d.y, d.z],
      rotation: [0, 0, Math.PI / 2],
      noAO: true,
    });
    for (let x = d.x0 + 1; x < d.x1; x += 2.5) {
      trims.add('metal', torus(d.radius + 0.01, 0.018, 6, 28), {
        color: C.chrome,
        position: [x, d.y, d.z],
        rotation: [0, Math.PI / 2, 0],
        noAO: true,
      });
    }
    // Hangers.
    for (let x = d.x0 + 2; x < d.x1; x += 5) {
      trims.add('metal', cyl(0.012, 0.012, H - d.y, 6), {
        color: C.gunmetal,
        position: [x, (H + d.y) / 2, d.z],
        noAO: true,
      });
    }
  }
  for (const e of AUDIO_EMITTERS) {
    if (e.kind !== 'vent') continue;
    trims.add('paint', rbox(0.6, 0.06, 0.42, 0.02), {
      color: C.charcoal,
      position: [e.x, e.y + 0.02, e.z],
      noAO: true,
    });
    for (let i = 0; i < 6; i++) {
      trims.add('metal', box(0.5, 0.012, 0.03), {
        color: C.steel,
        position: [e.x, e.y - 0.015, e.z - 0.15 + i * 0.06],
        noAO: true,
      });
    }
  }
}

function buildFloors(floors) {
  for (const zone of ZONES) {
    const [x0, z0, x1, z1] = zone.rect;
    if (zone.floor === 'floor_rubber') {
      const palette = [0x46b3a8, 0xf2b74b, 0xe86f5f, 0x6c8fd8, 0x9c7fd8, 0x7cc46b];
      for (let x = x0; x < x1 - 1e-4; x += 1) {
        for (let z = z0; z < z1 - 1e-4; z += 1) {
          const ix = Math.round(x - x0);
          const iz = Math.round(z - z0);
          const g = new PlaneGeometry(Math.min(1, x1 - x), Math.min(1, z1 - z));
          g.rotateX(-Math.PI / 2);
          floors.add('floor_rubber', g, {
            color: palette[(ix * 2 + iz * 3 + ((ix * iz) % 3)) % palette.length],
            position: [x + Math.min(1, x1 - x) / 2, 0, z + Math.min(1, z1 - z) / 2],
            noAO: true,
          });
        }
      }
    } else {
      const g = new PlaneGeometry(x1 - x0, z1 - z0);
      g.rotateX(-Math.PI / 2);
      floors.add(zone.floor, g, {
        color: 0xffffff,
        position: [(x0 + x1) / 2, 0, (z0 + z1) / 2],
        noAO: true,
      });
    }
  }
}

function buildPlatforms(floors, trims) {
  const softColors = {
    pauseTable: C.teal,
    foam1: C.yellow,
    foam2: C.coral,
    foam3: C.sky,
    foam4: C.lilac,
  };
  for (const p of PLATFORMS) {
    let color = 0xffffff;
    if (p.material === 'deck_play')
      color =
        p.id === 'playDeck'
          ? 0xf28c5a
          : p.id.endsWith('1') || p.id.endsWith('3')
            ? 0x5ab3d6
            : 0xf5c84c;
    if (p.material === 'deck_soft') color = softColors[p.id] ?? C.teal;
    floors.add(p.material, rbox(p.sx, p.height, p.sz, Math.min(0.035, p.height / 3)), {
      color,
      position: [p.x, p.height / 2, p.z],
      noAO: true,
    });
    if (p.id === 'nookDeck') {
      trims.add('wood', rbox(p.sx + 0.02, 0.05, 0.08, 0.02), {
        color: C.woodMid,
        position: [p.x, p.height - 0.02, p.z - p.sz / 2],
      });
    }
    if (p.id === 'playDeck') {
      // Support posts and a skirt so the deck reads as a play structure.
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          trims.add('paint', rbox(0.12, p.height + 0.6, 0.12, 0.03), {
            color: 0x2f7fb8,
            position: [
              p.x + sx * (p.sx / 2 - 0.06),
              (p.height + 0.6) / 2,
              p.z + sz * (p.sz / 2 - 0.06),
            ],
          });
          trims.add('gloss', rbox(0.18, 0.12, 0.18, 0.05), {
            color: C.yellow,
            position: [p.x + sx * (p.sx / 2 - 0.06), p.height + 0.66, p.z + sz * (p.sz / 2 - 0.06)],
          });
        }
      }
    }
  }
  for (const [x0, z0, x1, z1] of RAILINGS) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    trims.add('paint', rbox(0.07, 0.07, len + 0.07, 0.03), {
      color: C.white,
      position: [cx, RAILING_BASE + RAILING_HEIGHT, cz],
      rotation: [0, yaw, 0],
    });
    const n = Math.max(1, Math.round(len / 0.16));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      trims.add('paint', cyl(0.016, 0.016, RAILING_HEIGHT, 8), {
        color: i % 2 ? C.teal : C.white,
        position: [x0 + (x1 - x0) * t, RAILING_BASE + RAILING_HEIGHT / 2, z0 + (z1 - z0) * t],
      });
    }
  }
}

/** Build a wedge (ramp) as flat-shaded triangles in local space. */
function wedgeGeometry(width, length, h0, h1) {
  const hw = width / 2;
  const hl = length / 2;
  const v = {
    a: [-hw, 0, -hl],
    b: [hw, 0, -hl],
    c: [hw, 0, hl],
    d: [-hw, 0, hl],
    e: [-hw, h0, -hl],
    f: [hw, h0, -hl],
    g: [hw, h1, hl],
    h: [-hw, h1, hl],
  };
  const quads = [
    ['e', 'h', 'g', 'f'],
    ['d', 'c', 'g', 'h'],
    ['a', 'd', 'h', 'e'],
    ['b', 'f', 'g', 'c'],
  ];
  if (h0 > 0.001) quads.push(['a', 'e', 'f', 'b']);
  const pos = [];
  for (const [p, q, r, s] of quads) {
    for (const k of [p, q, r, p, r, s]) pos.push(...v[k]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

function buildRampsAndFrames(floors, trims) {
  const colors = { deckRamp: 0x5ab3d6, deckSlide: 0xf5c84c, nookRamp: 0xffffff };
  for (const r of RAMPS) {
    const slot = r.id === 'nookRamp' ? 'deck_wood' : 'deck_play';
    floors.add(slot, wedgeGeometry(r.width, r.length, r.height0, r.height1), {
      color: colors[r.id] ?? 0xffffff,
      position: [r.x, 0, r.z],
      rotation: [0, r.rotY, 0],
      noAO: true,
    });
    if (slot === 'deck_play') {
      const angle = Math.atan2(r.height1 - r.height0, r.length);
      const n = Math.floor(r.length / 0.32);
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const lz = -r.length / 2 + r.length * t;
        const ly = r.height0 + (r.height1 - r.height0) * t + 0.012;
        const c = Math.cos(r.rotY);
        const s = Math.sin(r.rotY);
        trims.add('paint', rbox(r.width * 0.9, 0.025, 0.05, 0.01), {
          color: C.navy,
          position: [r.x + lz * s, ly, r.z + lz * c],
          rotation: [-angle, r.rotY, 0, 'YXZ'],
        });
      }
    }
  }
  for (const a of A_FRAMES) {
    const slope = Math.hypot(a.halfLength, a.peak);
    const angle = Math.atan2(a.peak, a.halfLength);
    for (const s of [-1, 1]) {
      const g = new PlaneGeometry(a.width, slope, 1, 10);
      g.rotateX(-Math.PI / 2);
      floors.add('deck_play', g, {
        color: (x, y, z, out) => out.set(y < 0.32 ? 0xf5c84c : 0x3f7fd0),
        position: [a.x, a.peak / 2, a.z + s * (a.halfLength / 2)],
        rotation: [s * angle, a.rotY, 0, 'YXZ'],
        noAO: true,
      });
      for (let i = 1; i < 7; i++) {
        const t = i / 7;
        trims.add('paint', rbox(a.width * 0.92, 0.025, 0.05, 0.01), {
          color: C.white,
          position: [a.x, a.peak * (1 - t) + 0.015, a.z + s * a.halfLength * t],
          rotation: [s * angle, a.rotY, 0, 'YXZ'],
        });
      }
    }
    // Edge rails along both slopes plus a peak bar.
    for (const s of [-1, 1]) {
      for (const sx of [-1, 1]) {
        const c = Math.cos(a.rotY);
        const sn = Math.sin(a.rotY);
        const lx = sx * (a.width / 2 + 0.03);
        const lz = (s * a.halfLength) / 2;
        trims.add('paint', rbox(0.06, 0.07, slope + 0.04, 0.02), {
          color: C.navy,
          position: [a.x + lx * c + lz * sn, a.peak / 2 + 0.01, a.z - lx * sn + lz * c],
          rotation: [s * angle, a.rotY, 0, 'YXZ'],
        });
      }
    }
    trims.add('paint', cyl(0.04, 0.04, a.width + 0.12, 12), {
      color: C.navy,
      position: [a.x, a.peak + 0.02, a.z],
      rotation: [0, a.rotY, Math.PI / 2, 'YXZ'],
    });
  }
  for (const d of DOMES) {
    const R = (d.radius * d.radius + d.height * d.height) / (2 * d.height);
    const maxPhi = Math.asin(d.radius / R);
    const g = new SphereGeometry(R, 40, 10, 0, Math.PI * 2, 0, maxPhi);
    g.translate(0, d.height - R, 0);
    floors.add('deck_soft', g, {
      color: (x, y, z, out) => {
        const a = Math.atan2(z, x);
        out.set(Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8) % 2 ? 0xf28c5a : 0xf5c84c);
      },
      position: [d.x, 0, d.z],
      noAO: true,
    });
  }
}

function buildFloorCoverings(floors) {
  for (const p of PROPS) {
    const gen = FLOOR_COVERINGS[p.type];
    if (!gen) continue;
    floors.mergeAs(gen(), 'rug_floor', {
      position: [p.x, p.y || 0, p.z],
      rotation: [0, p.rotY || 0, 0],
    });
  }
}

function buildPawTrails(floors) {
  const shapes = pawShapes();
  const colors = [0xc98d5a, 0x5aa6a0];
  PAW_TRAILS.forEach(([x0, z0, x1, z1, steps], t) => {
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    const px = Math.cos(yaw);
    const pz = -Math.sin(yaw);
    for (let i = 0; i < steps; i++) {
      const k = (i + 0.5) / steps;
      const side = i % 2 ? 1 : -1;
      const x = x0 + (x1 - x0) * k + px * side * 0.12;
      const z = z0 + (z1 - z0) * k + pz * side * 0.12;
      for (const s of shapes) {
        const g = new ShapeGeometry(s, 6);
        g.rotateX(-Math.PI / 2);
        floors.add('decal_floor', g, {
          color: colors[t % colors.length],
          position: [x, 0.004, z],
          rotation: [0, yaw + Math.PI, 0],
          scale: 0.17,
          noAO: true,
        });
      }
    }
  });
}

function buildBunting(trims) {
  const colors = [C.coral, C.yellow, C.teal, C.blue, C.purple, C.orange, C.green];
  for (const [x0, z0, x1, z1, height, sag] of BUNTING) {
    const pts = [];
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push(
        new Vector3(x0 + (x1 - x0) * t, height - Math.sin(t * Math.PI) * sag, z0 + (z1 - z0) * t),
      );
    }
    const curve = new CatmullRomCurve3(pts);
    trims.add(
      'matte',
      tube(
        pts.map((p) => [p.x, p.y, p.z]),
        0.008,
        64,
        4,
      ),
      { color: 0xf6f1e6, noAO: true },
    );
    const len = curve.getLength();
    const count = Math.floor(len / 0.42);
    const tangent = new Vector3();
    for (let i = 1; i < count; i++) {
      const t = i / count;
      const p = curve.getPointAt(t);
      curve.getTangentAt(t, tangent);
      const yaw = Math.atan2(tangent.x, tangent.z) + Math.PI / 2;
      const g = new BufferGeometry();
      g.setAttribute(
        'position',
        new BufferAttribute(new Float32Array([-0.13, 0, 0, 0.13, 0, 0, 0, -0.26, 0]), 3),
      );
      g.computeVertexNormals();
      trims.add('doubleMatte', g, {
        color: colors[i % colors.length],
        position: [p.x, p.y - 0.01, p.z],
        rotation: [0, yaw, 0],
        noAO: true,
      });
    }
  }
}

/**
 * Build every static architectural mesh of the shelter. Work is split into
 * stages separated by `step()` so the browser stays responsive while loading.
 * @param {import('./MaterialLibrary.js').MaterialLibrary} materials
 * @param {() => Promise<void>} [step] Yields to the browser between stages.
 * @returns {Promise<Group>}
 */
export async function buildArchitecture(materials, step = async () => {}) {
  const floors = new PartBuilder({ groundAO: 0 });
  const walls = new PartBuilder({ groundAO: 0.22, groundAOHeight: 0.5 });
  const trims = new PartBuilder({ groundAO: 0.18, groundAOHeight: 0.3 });
  const glass = new PartBuilder({ groundAO: 0 });
  const decals = new PartBuilder({ groundAO: 0 });

  const stages = [
    () => buildFloors(floors),
    () => buildFloorCoverings(floors),
    () => buildPawTrails(floors),
    () => buildOuterWalls(walls, trims, glass),
    () => buildInterior(walls, trims, decals),
    () => buildPlayMural(decals),
    () => buildCeiling(walls, trims),
    () => buildPlatforms(floors, trims),
    () => buildRampsAndFrames(floors, trims),
    () => buildBunting(trims),
  ];
  for (const stage of stages) {
    stage();
    await step();
  }

  const group = new Group();
  group.name = 'Architecture';
  const keepUV = (slot) => slot in UV_DENSITY;
  for (const builder of [floors, walls, trims, decals, glass]) {
    for (const [slot, geometry] of Object.entries(builder.build({ keepUV }))) {
      if (slot in UV_DENSITY) planarUV(geometry, UV_DENSITY[slot]);
      if (LIGHTMAPPED.has(slot)) addTopDownUV1(geometry, BOUNDS);
      const mesh = new Mesh(geometry, materials.get(slot));
      mesh.name = `arch:${slot}`;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.receiveShadow = slot !== 'glass';
      mesh.castShadow = false;
      if (slot === 'glass') mesh.renderOrder = 2;
      group.add(mesh);
    }
    await step();
  }
  return group;
}
