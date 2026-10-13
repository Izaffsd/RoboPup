/**
 * Shelter layout — the single source of truth for where everything is.
 *
 * Pure data + tiny helpers with no three.js / Rapier dependency, so it is
 * shared verbatim by the runtime world builder, the physics collider
 * generator and the offline lightmap baker (scripts/build-assets.mjs).
 *
 * Coordinates: metres, +Y up. Interior spans x∈[-20,20], z∈[-15,15].
 * South (+Z) holds the big sunlit windows; north (−Z) holds the kennels.
 */

export const BOUNDS = Object.freeze({
  minX: -20,
  maxX: 20,
  minZ: -15,
  maxZ: 15,
  ceiling: 5.5,
  wallThickness: 0.3,
});

/** Lightmap covers the whole interior footprint (top-down projection). */
export const LIGHTMAP = Object.freeze({
  /** ~3.9 cm per texel: enough to resolve window mullions in the sun patches. */
  width: 1024,
  height: 768,
  /** Ambient occlusion is low-frequency, so it is baked at half resolution. */
  aoDownsample: 2,
  /** Encoded value = irradiance / scale (so the 8-bit range covers bright sun patches). */
  scale: 2.6,
});

/**
 * Zones: floor material + display name. Rects are [minX, minZ, maxX, maxZ];
 * they tile the interior without overlapping (each becomes one floor mesh).
 */
export const ZONES = Object.freeze([
  { id: 'reception', name: 'Reception', rect: [-20, 4, -8, 15], floor: 'floor_tile_warm' },
  { id: 'nook', name: 'Sunny Nook', rect: [-8, 5, 8, 15], floor: 'floor_wood' },
  { id: 'feeding', name: 'Feeding Corner', rect: [8, 5, 20, 15], floor: 'floor_tile_mint' },
  { id: 'play', name: 'Play Zone', rect: [2, -15, 20, 5], floor: 'floor_rubber' },
  { id: 'kennels', name: 'Kennel Rows', rect: [-20, -15, 2, -3], floor: 'floor_epoxy' },
  { id: 'hall', name: 'Main Hall', rect: [-20, -3, 2, 4], floor: 'floor_epoxy' },
  { id: 'hall', name: 'Main Hall', rect: [-8, 4, 2, 5], floor: 'floor_epoxy' },
]);

/** Wainscot (lower wall) colour per zone; upper walls are a warm cream. */
export const ZONE_WALL_COLORS = Object.freeze({
  reception: 0x3e9e9c,
  nook: 0x8fb98b,
  feeding: 0xf08a6c,
  play: 0x5b8fd6,
  kennels: 0x8a83c9,
  hall: 0xe0a14a,
});

/**
 * Returns the zone containing (x, z), or the hall as a fallback.
 * @param {number} x
 * @param {number} z
 */
export function zoneAt(x, z) {
  for (const zone of ZONES) {
    const [x0, z0, x1, z1] = zone.rect;
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return zone;
  }
  return ZONES[5];
}

/**
 * Openings in the four outer walls. `center` is measured along the wall
 * (x for north/south walls, z for east/west walls).
 * kind: window | door (glass) | doorSolid. `panesX`/`panesY` = mullion grid.
 */
export const OUTER_WALLS = Object.freeze({
  south: [
    { kind: 'door', center: -14, width: 2.4, bottom: 0, top: 2.7, label: 'entrance' },
    { kind: 'window', center: -10.6, width: 1.9, bottom: 0.9, top: 2.8, panesX: 2, panesY: 2 },
    { kind: 'window', center: -18.2, width: 1.6, bottom: 0.9, top: 2.8, panesX: 2, panesY: 2 },
    {
      kind: 'window',
      center: -5.1,
      width: 2.9,
      bottom: 0.55,
      top: 3.9,
      panesX: 2,
      panesY: 2,
      sun: true,
    },
    {
      kind: 'window',
      center: -1.7,
      width: 2.9,
      bottom: 0.55,
      top: 3.9,
      panesX: 2,
      panesY: 2,
      sun: true,
    },
    {
      kind: 'window',
      center: 1.7,
      width: 2.9,
      bottom: 0.55,
      top: 3.9,
      panesX: 2,
      panesY: 2,
      sun: true,
    },
    {
      kind: 'window',
      center: 5.1,
      width: 2.9,
      bottom: 0.55,
      top: 3.9,
      panesX: 2,
      panesY: 2,
      sun: true,
    },
    { kind: 'window', center: 11.0, width: 1.8, bottom: 1.1, top: 2.8, panesX: 2, panesY: 2 },
    { kind: 'window', center: 16.6, width: 1.8, bottom: 1.1, top: 2.8, panesX: 2, panesY: 2 },
  ],
  north: [
    { kind: 'window', center: -16, width: 2.4, bottom: 3.7, top: 4.9, panesX: 3, panesY: 1 },
    { kind: 'window', center: -9.5, width: 2.4, bottom: 3.7, top: 4.9, panesX: 3, panesY: 1 },
    { kind: 'window', center: -3, width: 2.4, bottom: 3.7, top: 4.9, panesX: 3, panesY: 1 },
    { kind: 'window', center: 6, width: 2.4, bottom: 3.7, top: 4.9, panesX: 3, panesY: 1 },
    { kind: 'window', center: 12, width: 2.4, bottom: 3.7, top: 4.9, panesX: 3, panesY: 1 },
    { kind: 'window', center: 17.5, width: 2.4, bottom: 3.7, top: 4.9, panesX: 3, panesY: 1 },
  ],
  west: [
    { kind: 'doorSolid', center: -9.4, width: 1.8, bottom: 0, top: 2.5, label: 'kennelWing' },
    { kind: 'window', center: 0.6, width: 1.8, bottom: 1.0, top: 2.8, panesX: 2, panesY: 2 },
    { kind: 'window', center: 5.4, width: 1.4, bottom: 1.0, top: 2.7, panesX: 2, panesY: 2 },
    { kind: 'doorSolid', center: 14.1, width: 1.1, bottom: 0, top: 2.3, label: 'staff' },
  ],
  east: [
    { kind: 'window', center: -12, width: 2.2, bottom: 1.2, top: 3.1, panesX: 2, panesY: 2 },
    { kind: 'door', center: -6.5, width: 1.5, bottom: 0, top: 2.6, label: 'yard' },
    { kind: 'window', center: -1.2, width: 2.2, bottom: 1.2, top: 3.1, panesX: 2, panesY: 2 },
    { kind: 'window', center: 3.2, width: 2.2, bottom: 1.2, top: 3.1, panesX: 2, panesY: 2 },
  ],
});

/**
 * Interior walls as axis-aligned boxes: centre (x, z), size (sx, sz), height.
 * style: kennel (painted divider), back (mural wall), half (reception half wall).
 */
export const INTERIOR_WALLS = (() => {
  const walls = [];
  // Kennel row A (north wall, fronts face +z at z = -11.8).
  for (const x of [-17, -14, -11, -8, -5, -2]) {
    walls.push({ x, z: -13.4, sx: 0.16, sz: 3.2, height: 2.2, style: 'kennel' });
  }
  // Kennel row B (free standing, fronts face −z at z = −7.4, back wall at −4.2).
  for (const x of [-17, -14, -11, -8, -5, -2]) {
    walls.push({ x, z: -5.8, sx: 0.16, sz: 3.2, height: 2.2, style: 'kennel' });
  }
  walls.push({ x: -9.5, z: -4.1, sx: 15.16, sz: 0.2, height: 2.4, style: 'back' });
  // Reception half wall with a gap into the hall.
  walls.push({ x: -15, z: 4, sx: 10, sz: 0.26, height: 1.1, style: 'half' });
  return Object.freeze(walls.map((w) => Object.freeze(w)));
})();

/** Structural columns (square, full height). */
export const COLUMNS = Object.freeze([
  { x: -8, z: 4.6 },
  { x: 8, z: 5.6 },
  { x: 2, z: -3 },
]);
export const COLUMN_SIZE = 0.5;

/**
 * Walkable raised surfaces (boxes from the floor up to `height`).
 * They receive the baked lightmap (top-down projection).
 */
export const PLATFORMS = Object.freeze([
  // Sunny nook reading deck under the windows (one 0.2 m step).
  { id: 'nookDeck', x: 0, z: 13.6, sx: 13.2, sz: 2.8, height: 0.2, material: 'deck_wood' },
  // Play deck + stairs (0.2 m rises exercise the auto-step).
  { id: 'playDeck', x: 14.3, z: -10.7, sx: 2.6, sz: 2.6, height: 1.0, material: 'deck_play' },
  { id: 'stair1', x: 12.75, z: -10.7, sx: 0.5, sz: 1.4, height: 0.8, material: 'deck_play' },
  { id: 'stair2', x: 12.25, z: -10.7, sx: 0.5, sz: 1.4, height: 0.6, material: 'deck_play' },
  { id: 'stair3', x: 11.75, z: -10.7, sx: 0.5, sz: 1.4, height: 0.4, material: 'deck_play' },
  { id: 'stair4', x: 11.25, z: -10.7, sx: 0.5, sz: 1.4, height: 0.2, material: 'deck_play' },
  // Agility pause table.
  { id: 'pauseTable', x: 4.2, z: 2.6, sx: 1.3, sz: 1.3, height: 0.22, material: 'deck_soft' },
  // Foam block staircase against the east wall.
  { id: 'foam1', x: 19.1, z: -1.6, sx: 1.0, sz: 0.8, height: 0.15, material: 'deck_soft' },
  { id: 'foam2', x: 19.1, z: -0.8, sx: 1.0, sz: 0.8, height: 0.3, material: 'deck_soft' },
  { id: 'foam3', x: 19.1, z: 0.0, sx: 1.0, sz: 0.8, height: 0.45, material: 'deck_soft' },
  { id: 'foam4', x: 19.1, z: 0.8, sx: 1.0, sz: 0.8, height: 0.6, material: 'deck_soft' },
]);

/** Railings on the play deck: [x0, z0, x1, z1] along the open edges. */
export const RAILINGS = Object.freeze([
  [13.0, -12.0, 15.6, -12.0],
  [15.6, -12.0, 15.6, -11.3],
  [15.6, -10.1, 15.6, -9.4],
  [13.0, -9.4, 13.65, -9.4],
  [14.95, -9.4, 15.6, -9.4],
]);
export const RAILING_HEIGHT = 0.75;
export const RAILING_BASE = 1.0;

/**
 * Ramps (wedges). The surface rises from `height0` at the start edge to
 * `height1` at the end edge along local +Z after rotating by `rotY`.
 */
export const RAMPS = Object.freeze([
  // Up to the play deck from the south (≈21°).
  {
    id: 'deckRamp',
    x: 14.3,
    z: -8.1,
    rotY: Math.PI,
    length: 2.6,
    width: 1.3,
    height0: 0,
    height1: 1.0,
  },
  // Slide off the east side (≈29°).
  {
    id: 'deckSlide',
    x: 16.5,
    z: -10.7,
    rotY: -Math.PI / 2,
    length: 1.8,
    width: 1.2,
    height0: 0,
    height1: 1.0,
  },
  // Gentle ramp onto the nook deck.
  {
    id: 'nookRamp',
    x: 7.35,
    z: 13.6,
    rotY: -Math.PI / 2,
    length: 1.5,
    width: 1.4,
    height0: 0,
    height1: 0.2,
  },
]);

/** A-frames: symmetric triangular prisms (centre, rotY, half length, width, peak). */
export const A_FRAMES = Object.freeze([
  { id: 'aFrame', x: 6.6, z: -10.0, rotY: 0, halfLength: 1.6, width: 1.15, peak: 1.0 },
]);

/** Soft-play domes: uneven ground for the foot IK. */
export const DOMES = Object.freeze([
  { id: 'dome1', x: 9.2, z: 2.4, radius: 1.35, height: 0.34 },
  { id: 'dome2', x: 4.6, z: -13.2, radius: 1.2, height: 0.3 },
]);

/** Tunnels: arches built from 1 m segments along local +Z. */
export const TUNNELS = Object.freeze([
  { id: 'tunnelLong', x: 6.5, z: -5.0, rotY: Math.PI / 2, segments: 5 },
  { id: 'tunnelShort', x: 17.0, z: -5.6, rotY: 0, segments: 3 },
]);

/** Tunnel cross-section: an arch of a circle centred `centerY` above the floor. */
export const TUNNEL_PROFILE = Object.freeze({
  centerY: 0.3,
  innerRadius: 0.76,
  outerRadius: 0.84,
  startAngle: -0.4,
  endAngle: Math.PI + 0.4,
});

/** Pendant lamps (bulb position). Used for visuals and baked light pools. */
export const LAMPS = Object.freeze([
  { x: -16, z: 7.5, y: 3.1, intensity: 7 },
  { x: -11.5, z: 11.2, y: 3.1, intensity: 7 },
  { x: -14, z: 0.5, y: 3.3, intensity: 7 },
  { x: -6, z: 0.5, y: 3.3, intensity: 7 },
  { x: -15.5, z: -9.6, y: 3.0, intensity: 6 },
  { x: -9.5, z: -9.6, y: 3.0, intensity: 6 },
  { x: -3.5, z: -9.6, y: 3.0, intensity: 6 },
  { x: 12, z: 10.4, y: 3.0, intensity: 7 },
  { x: 16.5, z: 10.4, y: 3.0, intensity: 7 },
  { x: 6, z: -6.5, y: 3.6, intensity: 8 },
  { x: 13, z: -3.5, y: 3.6, intensity: 8 },
  { x: 15.5, z: 1.5, y: 3.6, intensity: 8 },
  { x: -4, z: 9.5, y: 3.4, intensity: 6 },
  { x: 4, z: 9.5, y: 3.4, intensity: 6 },
]);

/** Ventilation ducts along X at a given z (they host the hum emitters). */
export const DUCTS = Object.freeze([
  { z: -1.0, y: 4.75, x0: -19.7, x1: 19.7, radius: 0.32 },
  { z: 9.8, y: 4.75, x0: -19.7, x1: 19.7, radius: 0.32 },
]);

/** Ceiling beams (along Z) at these x positions. */
export const BEAM_XS = Object.freeze([-18, -14, -10, -6, -2, 2, 6, 10, 14, 18]);
export const BEAM = Object.freeze({ width: 0.3, depth: 0.45 });

/** Positional ambient emitters. */
export const AUDIO_EMITTERS = Object.freeze([
  { kind: 'vent', x: -12, y: 4.4, z: -1.0 },
  { kind: 'vent', x: 12, y: 4.4, z: -1.0 },
  { kind: 'vent', x: 0, y: 4.4, z: 9.8 },
  { kind: 'water', x: 19.25, y: 0.9, z: 6.35 },
  { kind: 'kennels', x: -21.6, y: 1.4, z: -9.4 },
  { kind: 'kennels', x: -8, y: 1.6, z: -16.6 },
]);

// ---------------------------------------------------------------- kennels
const KENNEL_NAMES = [
  'BISCUIT',
  'LUNA',
  'PIXEL',
  'MOCHI',
  'REX',
  'PEPPER',
  'NUGGET',
  'ZIGGY',
  'OLIVE',
  'BEAN',
  'COMET',
];

/**
 * Kennel stalls. `facing` is the direction their open front faces (+1 = +z).
 * `backZ` is the inner face of the wall behind them.
 */
export const KENNELS = (() => {
  const list = [];
  let n = 0;
  for (const [i, x] of [-18.5, -15.5, -12.5, -9.5, -6.5, -3.5].entries()) {
    list.push({
      x,
      z: -13.4,
      frontZ: -11.8,
      backZ: -15,
      facing: 1,
      open: i % 2 === 0,
      name: KENNEL_NAMES[n++],
    });
  }
  for (const [i, x] of [-15.5, -12.5, -9.5, -6.5, -3.5].entries()) {
    list.push({
      x,
      z: -5.8,
      frontZ: -7.4,
      backZ: -4.2,
      facing: -1,
      open: i % 2 === 1,
      name: KENNEL_NAMES[n++],
    });
  }
  return Object.freeze(list.map((k) => Object.freeze(k)));
})();

/** Prop placement helpers. */
const props = [];
const P = (type, x, z, rotY = 0, extra = {}) => props.push({ type, x, y: 0, z, rotY, ...extra });

for (const [i, k] of KENNELS.entries()) {
  const rot = k.facing > 0 ? 0 : Math.PI;
  // Front fence: two 1 m panels either side of a 1 m gate.
  P('kennelFence', k.x - 1.0, k.frontZ, rot);
  P('kennelFence', k.x + 1.0, k.frontZ, rot);
  P('gatePost', k.x - 0.5, k.frontZ, rot);
  P('gatePost', k.x + 0.5, k.frontZ, rot);
  // Gate leaf is hinged on the left post and extends along local +X when closed.
  if (k.open) P('gateLeaf', k.x - 0.5, k.frontZ, k.facing > 0 ? -1.75 : 1.75);
  else P('gateLeaf', k.x - 0.5, k.frontZ, 0);
  const side = i % 2 ? 1 : -1;
  if (i % 3 !== 1) P('dogHouse', k.x + side * 0.6, k.backZ + k.facing * 0.82, rot);
  P('dogBed', k.x - side * 0.75, k.z - k.facing * 0.55, 0);
  P('bowlPair', k.x - side * 0.85, k.frontZ - k.facing * 0.45, rot);
}

// ---------------------------------------------------------------- reception
P('receptionDesk', -16.6, 10.2, Math.PI / 2);
P('officeChair', -18.4, 10.2, Math.PI / 2);
P('sofa', -10.6, 14.15, Math.PI);
P('coffeeTable', -10.6, 12.7, 0);
P('plantLarge', -19.25, 14.25, 0.4);
P('plantLarge', -8.9, 14.2, 1.9);
P('plantLarge', -19.2, 4.8, 2.6);
P('plantSmall', -12.2, 4.55, 0.7);
P('bench', -15.5, 4.62, 0);
P('bowlSingle', -15.1, 8.0, 0);
P('noticeBoard', -19.84, 7.4, Math.PI / 2, { y: 0.55 });
P('shelfUnit', -19.62, 12.0, Math.PI / 2);
P('rugRect', -12.8, 9.2, 0);
P('doormat', -14, 14.35, 0);
P('trashCan', -17.6, 13.0, 0);

// ---------------------------------------------------------------- hall
P('bench', -9.5, -3.72, 0);
P('bench', -13.5, -3.72, 0);
P('plantLarge', -18.6, -2.4, 1.1);
P('plantLarge', -1.0, -2.5, 2.1);
P('plantSmall', -4.8, -3.62, 0.2);
P('plantLarge', 1.2, 3.9, 0.9);
P('fireExtinguisher', -19.84, -1.5, Math.PI / 2, { y: 0.45 });
P('bench', -19.55, 2.4, Math.PI / 2);

// ---------------------------------------------------------------- kennel lounge (east end of the corridor)
P('toyChest', 0.8, -14.4, 0);
P('plantLarge', -1.2, -14.4, 0.4);
P('bench', 1.55, -12.5, -Math.PI / 2);

// ---------------------------------------------------------------- sunny nook
P('rugRound', 0, 8.6, 0);
P('dogBed', 0, 8.6, 0, { scale: 1.25 });
P('floorCushion', -4.6, 13.7, 0.2, { y: 0.2 });
P('floorCushion', -2.6, 13.9, -0.15, { y: 0.2 });
P('floorCushion', 3.4, 13.8, 0.3, { y: 0.2 });
P('dogBed', -0.2, 13.75, 0, { y: 0.2 });
P('dogBed', 5.4, 13.75, 0, { y: 0.2 });
P('plantLarge', -7.2, 14.2, 0.7);
P('plantLarge', 7.4, 12.0, 2.2);
P('plantSmall', -6.2, 12.9, 1.4, { y: 0.2 });
P('cubbyShelf', -7.55, 8.6, Math.PI / 2);
P('cubbyShelf', 7.55, 8.2, -Math.PI / 2);
P('plantSmall', -7.5, 10.4, 0.5);
P('plantSmall', 7.5, 6.6, 2.0);

// ---------------------------------------------------------------- feeding corner
for (const z of [7.8, 9.2, 10.6, 12.0]) P('counterCabinet', 19.65, z, -Math.PI / 2);
P('counterSink', 19.65, 13.4, -Math.PI / 2);
P('waterDispenser', 19.3, 6.35, -Math.PI / 2);
for (const x of [10.5, 12.5, 14.5, 16.5]) {
  P('bowlStation', x, 9.0, 0);
  P('bowlStation', x, 12.0, Math.PI);
}
P('storageBin', 15.5, 14.55, 0);
P('storageBin', 16.25, 14.55, 0);
P('storageBin', 17.0, 14.55, 0);
P('foodBags', 9.3, 14.4, 0);
P('plantLarge', 8.8, 6.4, 0.3);
P('shelfUnit', 13.8, 14.72, Math.PI);

// ---------------------------------------------------------------- play zone
P('hurdleLow', 5.0, -1.4, Math.PI / 2);
P('hurdleLow', 7.0, -1.4, Math.PI / 2);
P('hurdleHigh', 9.0, -1.4, Math.PI / 2);
for (let i = 0; i < 7; i++) P('weavePole', 12.2 + i * 0.75, 3.4, 0, { tint: i % 2 });
P('toyChest', 19.2, -14.3, 0);
P('ballBasket', 3.0, -14.2, 0);
for (const z of [-14.5, -13.5, -12.5, -11.5, -10.5, -6.5, -5.5, -4.5, -3.6]) {
  P('playFence', 2.0, z, Math.PI / 2);
}
for (const x of [8.5, 9.5, 10.5, 11.5, 15.0, 16.0, 17.0, 18.0, 19.0]) P('playFence', x, 5.6, 0);
P('plantLarge', 19.2, 4.6, 1.2);
P('plantLarge', 2.9, -2.4, 0.2);
P('bench', 9.0, -14.62, 0);
P('fireExtinguisher', 19.84, -8.2, -Math.PI / 2, { y: 0.45 });

export const PROPS = Object.freeze(props.map((p) => Object.freeze(p)));

/** Dynamic physics toys and their spawn points. */
export const TOYS = Object.freeze([
  { type: 'tennisBall', x: 6, y: 0.3, z: -2.6 },
  { type: 'tennisBall', x: 10.6, y: 0.3, z: -7.2 },
  { type: 'tennisBall', x: 15, y: 0.3, z: -1.2 },
  { type: 'tennisBall', x: 4.2, y: 0.3, z: -11 },
  { type: 'tennisBall', x: -12.5, y: 0.3, z: -13 },
  { type: 'rubberBall', x: 13, y: 0.3, z: 2.6 },
  { type: 'rubberBall', x: 8.2, y: 0.3, z: -12.6 },
  { type: 'rubberBall', x: -6, y: 0.3, z: 1.5 },
  { type: 'beachBall', x: 11, y: 0.6, z: -2.2 },
  { type: 'beachBall', x: -3, y: 0.6, z: 6.6 },
  { type: 'plushBone', x: -2, y: 0.3, z: 7.4 },
  { type: 'plushBone', x: -14, y: 0.3, z: 2.0 },
  { type: 'plushBone', x: -6.5, y: 0.3, z: -6.4 },
  { type: 'plushDuck', x: 1.6, y: 0.3, z: 9.4 },
  { type: 'plushDuck', x: -11, y: 0.3, z: 7.2 },
  { type: 'donutRing', x: 0.8, y: 0.5, z: 13.0 },
  { type: 'donutRing', x: -3.5, y: 0.3, z: -13 },
  { type: 'squeakyCube', x: 16, y: 0.3, z: -6.6 },
  { type: 'squeakyCube', x: 5.6, y: 0.3, z: 0.6 },
  { type: 'squeakyCube', x: 11.2, y: 0.3, z: 7.6 },
]);

/** Text signage. Positions are the sign centre; `rotY` turns the readable side. */
export const SIGNS = Object.freeze([
  {
    text: 'Happy Paws Shelter',
    style: 'logo',
    x: -19.84,
    y: 3.05,
    z: 10.2,
    rotY: Math.PI / 2,
    w: 3.4,
    h: 0.95,
  },
  {
    text: 'Reception',
    style: 'zone',
    x: -12,
    y: 3.25,
    z: 4.05,
    rotY: Math.PI,
    w: 1.9,
    h: 0.5,
    hang: true,
  },
  { text: 'Kennels', style: 'zone', x: 0, y: 3.25, z: -3.1, rotY: 0, w: 1.8, h: 0.5, hang: true },
  {
    text: 'Play Zone',
    style: 'zone',
    x: 2.0,
    y: 3.25,
    z: 0.8,
    rotY: -Math.PI / 2,
    w: 1.9,
    h: 0.5,
    hang: true,
  },
  {
    text: 'Feeding Corner',
    style: 'zone',
    x: 13.2,
    y: 3.0,
    z: 5.6,
    rotY: Math.PI,
    w: 2.3,
    h: 0.5,
    hang: true,
  },
  {
    text: 'Sunny Nook',
    style: 'zone',
    x: 0,
    y: 3.6,
    z: 5.3,
    rotY: Math.PI,
    w: 2.0,
    h: 0.5,
    hang: true,
  },
  {
    text: 'Kennel Wing B',
    style: 'door',
    x: -19.84,
    y: 2.85,
    z: -9.4,
    rotY: Math.PI / 2,
    w: 1.7,
    h: 0.32,
  },
  {
    text: 'Staff Only',
    style: 'door',
    x: -19.84,
    y: 2.6,
    z: 14.1,
    rotY: Math.PI / 2,
    w: 1.0,
    h: 0.24,
  },
  { text: 'EXIT', style: 'exit', x: -14, y: 2.95, z: 14.84, rotY: Math.PI, w: 0.7, h: 0.24 },
  { text: 'EXIT', style: 'exit', x: 19.84, y: 2.85, z: -6.5, rotY: -Math.PI / 2, w: 0.7, h: 0.24 },
  {
    text: 'Feeding Schedule',
    style: 'chart',
    x: 19.84,
    y: 1.9,
    z: 10.6,
    rotY: -Math.PI / 2,
    w: 1.3,
    h: 0.9,
  },
  {
    text: 'Play Rules',
    style: 'chart',
    x: 19.84,
    y: 1.75,
    z: -9.6,
    rotY: -Math.PI / 2,
    w: 1.1,
    h: 0.8,
  },
  {
    text: 'Adopt',
    style: 'poster',
    x: -19.78,
    y: 1.24,
    z: 7.0,
    rotY: Math.PI / 2,
    w: 0.42,
    h: 0.56,
  },
  {
    text: 'Walks',
    style: 'poster',
    x: -19.78,
    y: 1.2,
    z: 7.6,
    rotY: Math.PI / 2,
    w: 0.42,
    h: 0.42,
  },
  {
    text: 'Volunteer',
    style: 'poster',
    x: -19.78,
    y: 0.82,
    z: 7.15,
    rotY: Math.PI / 2,
    w: 0.5,
    h: 0.28,
  },
  {
    text: 'Lost?',
    style: 'poster',
    x: -19.78,
    y: 0.84,
    z: 7.85,
    rotY: Math.PI / 2,
    w: 0.3,
    h: 0.36,
  },
]);

/** Wall clock (animated hands, real local time). */
export const CLOCK = Object.freeze({ x: -19.83, y: 2.85, z: 13.0, rotY: Math.PI / 2, radius: 0.3 });

/** Bunting strings over the play zone: [x0, z0, x1, z1, height, sag]. */
export const BUNTING = Object.freeze([
  [2.3, -14.6, 19.6, -2.2, 3.5, 0.55],
  [2.3, -2.2, 19.6, -14.6, 3.7, 0.6],
  [2.3, -8.2, 19.6, -8.2, 3.3, 0.45],
]);

/** Paw-print decal trails on the floor: [x0, z0, x1, z1, steps]. */
export const PAW_TRAILS = Object.freeze([
  [-13.6, 13.0, -10.6, 1.6, 14],
  [-10.6, 1.2, -1.2, -9.0, 16],
  [-6.0, 2.2, 3.4, 0.2, 10],
  [-2.0, 3.4, 0.0, 7.0, 6],
  [3.2, 4.8, 12.8, 6.6, 11],
]);
