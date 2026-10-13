/**
 * Static prop catalogue: collision shapes (prop-local space, origin at the
 * floor centre, front facing +Z) and LOD switch distances.
 *
 * Shared by the runtime (physics + instancing) and the offline lightmap bake,
 * and kept in sync with the geometry generators in ./props/.
 *
 * Shape notation:
 *   box: { s: 'box', x, y, z, hx, hy, hz, ry? }
 *   cyl: { s: 'cyl', x, y, z, r, hh }
 */

const box = (x, y, z, hx, hy, hz, ry = 0) => ({ s: 'box', x, y, z, hx, hy, hz, ry });
const cyl = (x, y, z, r, hh) => ({ s: 'cyl', x, y, z, r, hh });

export const PROP_CATALOG = Object.freeze({
  kennelFence: { colliders: [box(0, 0.625, 0, 0.5, 0.625, 0.04)] },
  gatePost: { colliders: [box(0, 0.68, 0, 0.05, 0.68, 0.05)] },
  gateLeaf: { colliders: [box(0.5, 0.63, 0, 0.45, 0.6, 0.03)] },
  dogHouse: {
    lod: [0, 16],
    colliders: [
      box(0, 0.5, -0.71, 0.7, 0.5, 0.04),
      box(-0.66, 0.5, 0, 0.04, 0.5, 0.75),
      box(0.66, 0.5, 0, 0.04, 0.5, 0.75),
      box(-0.45, 0.5, 0.71, 0.25, 0.5, 0.04),
      box(0.45, 0.5, 0.71, 0.25, 0.5, 0.04),
      box(0, 1.0, 0.71, 0.42, 0.04, 0.04),
      box(0, 1.27, 0, 0.8, 0.25, 0.86),
    ],
  },
  dogBed: { colliders: [cyl(0, 0.05, 0, 0.55, 0.05)] },
  bowlPair: { colliders: [box(0, 0.035, 0, 0.32, 0.035, 0.15)] },
  bowlStation: { colliders: [box(0, 0.11, 0, 0.42, 0.11, 0.19)] },
  bowlSingle: { colliders: [cyl(0, 0.04, 0, 0.17, 0.04)] },
  receptionDesk: { colliders: [box(0, 0.53, 0, 1.42, 0.53, 0.39)] },
  officeChair: { colliders: [cyl(0, 0.5, 0, 0.32, 0.5)] },
  sofa: {
    colliders: [
      box(0, 0.24, 0.05, 1.1, 0.24, 0.4),
      box(0, 0.44, -0.33, 1.1, 0.44, 0.12),
      box(-1.0, 0.33, 0.05, 0.1, 0.33, 0.4),
      box(1.0, 0.33, 0.05, 0.1, 0.33, 0.4),
    ],
  },
  coffeeTable: { colliders: [box(0, 0.21, 0, 0.5, 0.21, 0.28)] },
  plantLarge: { lod: [0, 13], colliders: [cyl(0, 0.6, 0, 0.34, 0.6)] },
  plantSmall: { lod: [0, 10], colliders: [cyl(0, 0.3, 0, 0.2, 0.3)] },
  bench: { colliders: [box(0, 0.23, 0, 0.8, 0.23, 0.21)] },
  noticeBoard: { colliders: [box(0, 0.5, 0, 0.72, 0.52, 0.03)] },
  shelfUnit: { colliders: [box(0, 0.9, 0, 0.8, 0.9, 0.2)] },
  rugRect: { colliders: [] },
  rugRound: { colliders: [] },
  doormat: { colliders: [] },
  trashCan: { colliders: [cyl(0, 0.23, 0, 0.2, 0.23)] },
  fireExtinguisher: { colliders: [cyl(0, 0.25, 0, 0.1, 0.25)] },
  toyChest: { colliders: [box(0, 0.28, 0, 0.5, 0.28, 0.28)] },
  floorCushion: { colliders: [box(0, 0.08, 0, 0.37, 0.08, 0.37)] },
  cubbyShelf: { colliders: [box(0, 0.48, 0, 0.7, 0.48, 0.2)] },
  counterCabinet: { colliders: [box(0, 0.46, 0, 0.7, 0.46, 0.3)] },
  counterSink: { colliders: [box(0, 0.46, 0, 0.7, 0.46, 0.3)] },
  waterDispenser: { colliders: [box(0, 0.65, 0, 0.2, 0.65, 0.2)] },
  storageBin: { colliders: [box(0, 0.38, 0, 0.3, 0.38, 0.25)] },
  foodBags: { colliders: [box(0, 0.35, 0, 0.5, 0.35, 0.3)] },
  // Hurdle collision is a solid sheet up to the bar so it must be jumped.
  hurdleLow: {
    colliders: [
      cyl(-0.68, 0.4, 0, 0.05, 0.4),
      cyl(0.68, 0.4, 0, 0.05, 0.4),
      box(0, 0.16, 0, 0.64, 0.16, 0.025),
    ],
  },
  hurdleHigh: {
    colliders: [
      cyl(-0.68, 0.45, 0, 0.05, 0.45),
      cyl(0.68, 0.45, 0, 0.05, 0.45),
      box(0, 0.26, 0, 0.64, 0.26, 0.025),
    ],
  },
  weavePole: { colliders: [cyl(0, 0.5, 0, 0.04, 0.5)] },
  ballBasket: { colliders: [cyl(0, 0.23, 0, 0.36, 0.23)] },
  playFence: { colliders: [box(0, 0.43, 0, 0.5, 0.43, 0.04)] },
  pendantLamp: { colliders: [cyl(0, 0.08, 0, 0.26, 0.14)] },
});

/**
 * Dynamic toys: physics material + collision shape + impact sound.
 * shape: ball { r } | capsuleZ { r, hh } (lying along Z) | box { hx, hy, hz } | torus { R, r }
 */
export const TOY_CATALOG = Object.freeze({
  tennisBall: {
    shape: { s: 'ball', r: 0.07 },
    density: 380,
    restitution: 0.72,
    friction: 0.7,
    linearDamping: 0.15,
    angularDamping: 0.35,
    sound: 'bonk',
  },
  rubberBall: {
    shape: { s: 'ball', r: 0.13 },
    density: 160,
    restitution: 0.78,
    friction: 0.8,
    linearDamping: 0.12,
    angularDamping: 0.3,
    sound: 'bonk',
  },
  beachBall: {
    shape: { s: 'ball', r: 0.36 },
    density: 9,
    restitution: 0.65,
    friction: 0.6,
    linearDamping: 0.35,
    angularDamping: 0.45,
    sound: 'bonk',
  },
  plushBone: {
    shape: { s: 'capsuleZ', r: 0.06, hh: 0.13 },
    density: 120,
    restitution: 0.12,
    friction: 1.0,
    linearDamping: 0.6,
    angularDamping: 1.2,
    sound: 'squeak',
  },
  plushDuck: {
    shape: { s: 'ball', r: 0.12 },
    density: 90,
    restitution: 0.15,
    friction: 1.0,
    linearDamping: 0.6,
    angularDamping: 1.6,
    sound: 'squeak',
    /** Lower centre of mass so the duck tends to sit upright. */
    comOffsetY: -0.04,
  },
  donutRing: {
    shape: { s: 'torus', R: 0.13, r: 0.05 },
    density: 120,
    restitution: 0.3,
    friction: 0.9,
    linearDamping: 0.5,
    angularDamping: 0.9,
    sound: 'plush',
  },
  squeakyCube: {
    shape: { s: 'box', hx: 0.09, hy: 0.09, hz: 0.09 },
    density: 140,
    restitution: 0.35,
    friction: 0.9,
    linearDamping: 0.35,
    angularDamping: 0.6,
    sound: 'squeak',
  },
});
