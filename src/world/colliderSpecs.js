import {
  A_FRAMES,
  BEAM,
  BEAM_XS,
  BOUNDS,
  COLUMNS,
  COLUMN_SIZE,
  DOMES,
  DUCTS,
  INTERIOR_WALLS,
  LAMPS,
  OUTER_WALLS,
  PLATFORMS,
  PROPS,
  RAILINGS,
  RAILING_BASE,
  RAILING_HEIGHT,
  RAMPS,
  TUNNELS,
  TUNNEL_PROFILE,
} from './layout.js';
import { PROP_CATALOG } from './propCatalog.js';

/**
 * Collider tags:
 *  floor     – the ground slab
 *  platform  – walkable raised surfaces (decks, ramps, domes); receive the lightmap
 *  wall      – outer/interior walls and columns
 *  glass     – window/door glass (blocks movement, lets sunlight through in the bake)
 *  door      – solid doors
 *  ceiling   – roof slab
 *  prop      – furniture and play equipment
 *  decor     – overhead items (lamps, ducts, beams) that only the camera can reach
 *  bakeOnly  – mullions: shape the baked sun patches, never added to the physics world
 */

const IDENTITY = Object.freeze([0, 0, 0, 1]);

/** @returns {number[]} quaternion for a rotation about +Y */
export function quatYaw(angle) {
  const h = angle * 0.5;
  return [0, Math.sin(h), 0, Math.cos(h)];
}

function quatAxis(ax, ay, az, angle) {
  const h = angle * 0.5;
  const s = Math.sin(h);
  return [ax * s, ay * s, az * s, Math.cos(h)];
}

function quatMul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Rotate a local (x, z) offset about +Y. */
function rotXZ(x, z, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c + z * s, -x * s + z * c];
}

const boxSpec = (x, y, z, hx, hy, hz, q, tag) => ({
  s: 'box',
  x,
  y,
  z,
  hx,
  hy,
  hz,
  q: q || IDENTITY,
  tag,
});

/**
 * Builds the boxes for one outer wall, split around its openings.
 * Also returns glass/door fillers and bake-only mullions.
 */
function outerWall(side, specs) {
  const t = BOUNDS.wallThickness;
  const H = BOUNDS.ceiling;
  const alongX = side === 'south' || side === 'north';
  const fixed =
    side === 'south'
      ? BOUNDS.maxZ + t / 2
      : side === 'north'
        ? BOUNDS.minZ - t / 2
        : side === 'east'
          ? BOUNDS.maxX + t / 2
          : BOUNDS.minX - t / 2;
  const start = alongX ? BOUNDS.minX - t : BOUNDS.minZ;
  const end = alongX ? BOUNDS.maxX + t : BOUNDS.maxZ;

  const push = (a, b, y0, y1, tag, depth = t) => {
    if (b - a < 1e-4 || y1 - y0 < 1e-4) return;
    const c = (a + b) / 2;
    const half = (b - a) / 2;
    const hy = (y1 - y0) / 2;
    if (alongX) specs.push(boxSpec(c, y0 + hy, fixed, half, hy, depth / 2, null, tag));
    else specs.push(boxSpec(fixed, y0 + hy, c, depth / 2, hy, half, null, tag));
  };

  const openings = [...OUTER_WALLS[side]].sort((a, b) => a.center - b.center);
  let cursor = start;
  for (const o of openings) {
    const a = o.center - o.width / 2;
    const b = o.center + o.width / 2;
    push(cursor, a, 0, H, 'wall');
    push(a, b, 0, o.bottom, 'wall');
    push(a, b, o.top, H, 'wall');
    push(a, b, o.bottom, o.top, o.kind === 'doorSolid' ? 'door' : 'glass', 0.06);
    // Mullions so the baked sun patches show the window grid.
    const px = o.panesX || (o.kind === 'door' ? 2 : 1);
    const py = o.panesY || 1;
    const mw = 0.07;
    for (let i = 1; i < px; i++) {
      const m = a + ((b - a) * i) / px;
      push(m - mw / 2, m + mw / 2, o.bottom, o.top, 'bakeOnly', 0.12);
    }
    for (let j = 1; j < py; j++) {
      const m = o.bottom + ((o.top - o.bottom) * j) / py;
      push(a, b, m - mw / 2, m + mw / 2, 'bakeOnly', 0.12);
    }
    cursor = b;
  }
  push(cursor, end, 0, H, 'wall');
}

/**
 * Tunnel arch plates for one 1 m segment, in tunnel-local space.
 * @returns {{x:number,y:number,z:number,hx:number,hy:number,hz:number,roll:number}[]}
 */
export function tunnelArchPlates(segmentZ, plates = 12) {
  const { centerY, innerRadius, outerRadius, startAngle, endAngle } = TUNNEL_PROFILE;
  const rm = (innerRadius + outerRadius) / 2;
  const thick = outerRadius - innerRadius;
  const step = (endAngle - startAngle) / plates;
  const out = [];
  for (let i = 0; i < plates; i++) {
    const th = startAngle + step * (i + 0.5);
    const halfWidth = rm * Math.sin(step / 2) + 0.012;
    out.push({
      x: Math.cos(th) * rm,
      y: centerY + Math.sin(th) * rm,
      z: segmentZ,
      hx: halfWidth,
      hy: thick / 2,
      hz: 0.5,
      roll: th - Math.PI / 2,
    });
  }
  return out;
}

/** Ramp wedge corner points in world space. */
export function rampPoints(r) {
  const pts = [];
  const hw = r.width / 2;
  const hl = r.length / 2;
  const local = [
    [-hw, 0, -hl],
    [hw, 0, -hl],
    [-hw, 0, hl],
    [hw, 0, hl],
    [-hw, r.height1, hl],
    [hw, r.height1, hl],
  ];
  if (r.height0 > 0.001) local.push([-hw, r.height0, -hl], [hw, r.height0, -hl]);
  for (const [lx, ly, lz] of local) {
    const [wx, wz] = rotXZ(lx, lz, r.rotY);
    pts.push(r.x + wx, ly, r.z + wz);
  }
  return new Float32Array(pts);
}

/** A-frame triangular prism points in world space. */
export function aFramePoints(a) {
  const hw = a.width / 2;
  const local = [
    [-hw, 0, -a.halfLength],
    [hw, 0, -a.halfLength],
    [-hw, 0, a.halfLength],
    [hw, 0, a.halfLength],
    [-hw, a.peak, 0],
    [hw, a.peak, 0],
  ];
  const pts = [];
  for (const [lx, ly, lz] of local) {
    const [wx, wz] = rotXZ(lx, lz, a.rotY);
    pts.push(a.x + wx, ly, a.z + wz);
  }
  return new Float32Array(pts);
}

/** Spherical-cap dome points in world space. */
export function domePoints(d, rings = 6, segments = 18) {
  const R = (d.radius * d.radius + d.height * d.height) / (2 * d.height);
  const cy = d.height - R;
  const maxPhi = Math.asin(d.radius / R);
  const pts = [d.x, d.height, d.z];
  for (let i = 1; i <= rings; i++) {
    const phi = (maxPhi * i) / rings;
    const rr = Math.sin(phi) * R;
    const y = Math.max(0, cy + Math.cos(phi) * R);
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      pts.push(d.x + Math.cos(a) * rr, y, d.z + Math.sin(a) * rr);
    }
  }
  for (let j = 0; j < segments; j++) {
    const a = (j / segments) * Math.PI * 2;
    pts.push(d.x + Math.cos(a) * d.radius, 0, d.z + Math.sin(a) * d.radius);
  }
  return new Float32Array(pts);
}

/**
 * Transform a catalogue collider of a placed prop into world space.
 * @param {object} c Catalogue shape.
 * @param {{x:number,y:number,z:number,rotY:number,scale?:number}} p Placement.
 */
export function propColliderToWorld(c, p, tag = 'prop') {
  const s = p.scale || 1;
  const [ox, oz] = rotXZ(c.x * s, c.z * s, p.rotY);
  const x = p.x + ox;
  const y = (p.y || 0) + c.y * s;
  const z = p.z + oz;
  const q = quatYaw(p.rotY + (c.ry || 0));
  if (c.s === 'box') return boxSpec(x, y, z, c.hx * s, c.hy * s, c.hz * s, q, tag);
  return { s: 'cyl', x, y, z, r: c.r * s, hh: c.hh * s, q: IDENTITY, tag };
}

/**
 * Build every static collider in the shelter.
 * @param {{includeBakeOnly?: boolean}} [options]
 * @returns {object[]} World-space collider specs.
 */
export function buildColliderSpecs({ includeBakeOnly = false } = {}) {
  const specs = [];
  const { minX, maxX, minZ, maxZ, ceiling } = BOUNDS;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const hxAll = (maxX - minX) / 2 + 1;
  const hzAll = (maxZ - minZ) / 2 + 1;

  specs.push(boxSpec(cx, -0.5, cz, hxAll, 0.5, hzAll, null, 'floor'));
  specs.push(boxSpec(cx, ceiling + 0.2, cz, hxAll, 0.2, hzAll, null, 'ceiling'));

  for (const side of ['south', 'north', 'east', 'west']) outerWall(side, specs);

  for (const w of INTERIOR_WALLS) {
    specs.push(boxSpec(w.x, w.height / 2, w.z, w.sx / 2, w.height / 2, w.sz / 2, null, 'wall'));
  }
  const hc = COLUMN_SIZE / 2;
  for (const c of COLUMNS)
    specs.push(boxSpec(c.x, ceiling / 2, c.z, hc, ceiling / 2, hc, null, 'wall'));

  for (const p of PLATFORMS) {
    specs.push(boxSpec(p.x, p.height / 2, p.z, p.sx / 2, p.height / 2, p.sz / 2, null, 'platform'));
  }
  for (const r of RAMPS) specs.push({ s: 'hull', points: rampPoints(r), tag: 'platform' });
  for (const a of A_FRAMES) specs.push({ s: 'hull', points: aFramePoints(a), tag: 'platform' });
  for (const d of DOMES) specs.push({ s: 'hull', points: domePoints(d), tag: 'platform' });

  for (const t of TUNNELS) {
    const yaw = quatYaw(t.rotY);
    for (let k = 0; k < t.segments; k++) {
      const segZ = k - (t.segments - 1) / 2;
      for (const plate of tunnelArchPlates(segZ)) {
        const [wx, wz] = rotXZ(plate.x, plate.z, t.rotY);
        const q = quatMul(yaw, quatAxis(0, 0, 1, plate.roll));
        specs.push(boxSpec(t.x + wx, plate.y, t.z + wz, plate.hx, plate.hy, plate.hz, q, 'prop'));
      }
    }
  }

  for (const [x0, z0, x1, z1] of RAILINGS) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    specs.push(
      boxSpec(
        (x0 + x1) / 2,
        RAILING_BASE + RAILING_HEIGHT / 2,
        (z0 + z1) / 2,
        0.035,
        RAILING_HEIGHT / 2,
        len / 2,
        quatYaw(yaw),
        'prop',
      ),
    );
  }

  for (const lamp of LAMPS) {
    specs.push({
      s: 'cyl',
      x: lamp.x,
      y: lamp.y + 0.08,
      z: lamp.z,
      r: 0.26,
      hh: 0.14,
      q: IDENTITY,
      tag: 'decor',
    });
  }
  const ductRot = quatAxis(0, 0, 1, Math.PI / 2);
  for (const d of DUCTS) {
    const len = d.x1 - d.x0;
    specs.push({
      s: 'cyl',
      x: (d.x0 + d.x1) / 2,
      y: d.y,
      z: d.z,
      r: d.radius,
      hh: len / 2,
      q: ductRot,
      tag: 'decor',
    });
  }
  for (const x of BEAM_XS) {
    specs.push(
      boxSpec(
        x,
        ceiling - BEAM.depth / 2,
        cz,
        BEAM.width / 2,
        BEAM.depth / 2,
        (maxZ - minZ) / 2,
        null,
        'decor',
      ),
    );
  }

  for (const p of PROPS) {
    const entry = PROP_CATALOG[p.type];
    if (!entry) continue;
    for (const c of entry.colliders) specs.push(propColliderToWorld(c, p));
  }

  return includeBakeOnly ? specs : specs.filter((s) => s.tag !== 'bakeOnly');
}

/**
 * Convert a spec into a Rapier ColliderDesc (or null for a degenerate hull).
 * @param {any} RAPIER The initialised Rapier module.
 * @param {object} spec
 */
export function createColliderDesc(RAPIER, spec) {
  let desc = null;
  if (spec.s === 'box') desc = RAPIER.ColliderDesc.cuboid(spec.hx, spec.hy, spec.hz);
  else if (spec.s === 'cyl') desc = RAPIER.ColliderDesc.cylinder(spec.hh, spec.r);
  else if (spec.s === 'hull') desc = RAPIER.ColliderDesc.convexHull(spec.points);
  if (!desc) return null;
  if (spec.s !== 'hull') {
    desc.setTranslation(spec.x, spec.y, spec.z);
    const q = spec.q || IDENTITY;
    desc.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
  }
  return desc;
}
