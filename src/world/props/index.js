import * as F from './furniture.js';
import * as P from './plants.js';
import * as G from './play.js';
import * as T from './toys.js';

/**
 * Registry of procedural prop generators, consumed by the offline asset
 * pipeline (scripts/build-assets.mjs) which bakes them into a
 * Meshopt-compressed GLB. Each entry lists one generator per LOD level.
 */
export const PROP_GENERATORS = Object.freeze({
  kennelFence: [F.kennelFence],
  gatePost: [F.gatePost],
  gateLeaf: [F.gateLeaf],
  dogHouse: [() => F.dogHouse(0), () => F.dogHouse(1)],
  dogBed: [F.dogBed],
  bowlPair: [F.bowlPair],
  bowlStation: [() => F.bowlStation(7)],
  bowlSingle: [F.bowlSingle],
  receptionDesk: [F.receptionDesk],
  officeChair: [F.officeChair],
  sofa: [F.sofa],
  coffeeTable: [F.coffeeTable],
  plantLarge: [() => P.plantLarge(0), () => P.plantLarge(1)],
  plantSmall: [() => P.plantSmall(0), () => P.plantSmall(1)],
  bench: [F.bench],
  noticeBoard: [F.noticeBoard],
  shelfUnit: [() => F.shelfUnit(3)],
  rugRect: [F.rugRect],
  rugRound: [F.rugRound],
  doormat: [F.doormat],
  trashCan: [F.trashCan],
  fireExtinguisher: [F.fireExtinguisher],
  toyChest: [F.toyChest],
  floorCushion: [F.floorCushion],
  cubbyShelf: [() => F.cubbyShelf(9)],
  counterCabinet: [() => F.counterCabinet(false)],
  counterSink: [() => F.counterCabinet(true)],
  waterDispenser: [F.waterDispenser],
  storageBin: [F.storageBin],
  foodBags: [F.foodBags],
  hurdleLow: [G.hurdleLow],
  hurdleHigh: [G.hurdleHigh],
  weavePole: [G.weavePole],
  ballBasket: [G.ballBasket],
  playFence: [G.playFence],
  pendantLamp: [F.pendantLamp],
  tunnelSegment: [G.tunnelSegment],
  tree: [() => P.tree(0, 3), () => P.tree(1, 3)],
  bush: [() => P.bush(5)],
});

/** Dynamic toy generators (single LOD). */
export const TOY_GENERATORS = Object.freeze({
  tennisBall: T.tennisBall,
  rubberBall: T.rubberBall,
  beachBall: T.beachBall,
  plushBone: T.plushBone,
  plushDuck: T.plushDuck,
  donutRing: T.donutRing,
  squeakyCube: T.squeakyCube,
});
