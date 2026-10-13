import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS } from '../config/config.js';
import { createColliderDesc } from '../world/colliderSpecs.js';

/** Friction per static collider tag (walls are slippery so the dog slides along them). */
const TAG_FRICTION = Object.freeze({
  floor: 0.9,
  platform: 0.9,
  wall: 0.1,
  glass: 0.05,
  door: 0.1,
  ceiling: 0.1,
  prop: 0.6,
  decor: 0.3,
});

/**
 * Collision-group bits. Window glass lives in its own group so light rays can
 * ignore it while movement and the camera still collide with it.
 * Rapier groups: (memberships << 16) | filter.
 */
export const GROUP_GLASS = 0x0002;
export const GROUPS_GLASS_COLLIDER = ((GROUP_GLASS << 16) | 0xffff) >>> 0;
/** Query filter that sees everything except glass. */
export const QUERY_IGNORE_GLASS = ((0xffff << 16) | (0xffff & ~GROUP_GLASS)) >>> 0;

/**
 * Thin wrapper around the Rapier world: initialisation, static collider
 * creation from layout specs, fixed stepping, contact-force events and
 * allocation-free query helpers (reused Ray/shape/vector objects).
 */
export class PhysicsWorld {
  /**
   * Initialise the Rapier WASM module and create the world.
   * @returns {Promise<PhysicsWorld>}
   */
  static async create() {
    await RAPIER.init();
    return new PhysicsWorld();
  }

  constructor() {
    /** The Rapier module (exposed so other physics classes share one instance). */
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: PHYSICS.gravity, z: 0 });
    this.world.timestep = PHYSICS.fixedTimeStep;
    this.eventQueue = new RAPIER.EventQueue(true);
    /** Number of fixed steps executed so far. */
    this.stepCount = 0;
    /** Callbacks run after each step (e.g. toys snapshotting transforms). */
    this._postStep = [];

    this._ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this._shapePos = { x: 0, y: 0, z: 0 };
    this._shapeVel = { x: 0, y: 0, z: 0 };
    this._identity = { x: 0, y: 0, z: 0, w: 1 };
    /** @type {Map<number, any>} Ball shapes cached by radius (mm). */
    this._balls = new Map();
    /** Last query hit normal (valid after a successful castRayNormal). */
    this.hitNormal = { x: 0, y: 1, z: 0 };
    /** Collider handle of the last hit (or -1). */
    this.hitHandle = -1;
  }

  /**
   * Create fixed colliders from world-space specs (see colliderSpecs.js).
   * @param {object[]} specs
   * @returns {number} Number of colliders created.
   */
  addStaticSpecs(specs) {
    let n = 0;
    for (const spec of specs) {
      const desc = createColliderDesc(RAPIER, spec);
      if (!desc) continue;
      desc.setFriction(TAG_FRICTION[spec.tag] ?? 0.6);
      if (spec.tag === 'glass') desc.setCollisionGroups(GROUPS_GLASS_COLLIDER);
      desc.setRestitution(spec.tag === 'floor' || spec.tag === 'platform' ? 0.25 : 0.35);
      this.world.createCollider(desc);
      n++;
    }
    return n;
  }

  /**
   * Run one step so freshly created colliders become visible to scene
   * queries (Rapier only rebuilds its query acceleration structure on step).
   */
  prime() {
    this.world.step(this.eventQueue);
    this.eventQueue.clear();
  }

  /** @param {() => void} fn Called after every fixed step. */
  onPostStep(fn) {
    this._postStep.push(fn);
  }

  /** Advance the simulation by one fixed step. */
  step() {
    this.world.step(this.eventQueue);
    this.stepCount++;
    for (let i = 0; i < this._postStep.length; i++) this._postStep[i]();
  }

  /**
   * Drain contact-force events gathered during the last step(s).
   * @param {(handle1: number, handle2: number, force: number) => void} fn
   */
  drainContactForces(fn) {
    this.eventQueue.drainContactForceEvents((event) => {
      fn(event.collider1(), event.collider2(), event.totalForceMagnitude());
    });
  }

  /**
   * Cast a ray; returns hit distance or -1.
   * @param {number} ox @param {number} oy @param {number} oz Origin.
   * @param {number} dx @param {number} dy @param {number} dz Unit direction.
   * @param {number} maxDist
   * @param {number} [flags] RAPIER.QueryFilterFlags
   * @param {any} [exclude] Collider to ignore.
   * @param {number} [groups] Interaction groups filter.
   */
  castRay(ox, oy, oz, dx, dy, dz, maxDist, flags, exclude, groups) {
    const r = this._ray;
    r.origin.x = ox;
    r.origin.y = oy;
    r.origin.z = oz;
    r.dir.x = dx;
    r.dir.y = dy;
    r.dir.z = dz;
    const hit = this.world.castRay(r, maxDist, true, flags, groups, exclude);
    if (!hit) {
      this.hitHandle = -1;
      return -1;
    }
    this.hitHandle = hit.collider.handle;
    return hit.timeOfImpact;
  }

  /**
   * Cast a ray and also record the surface normal in {@link PhysicsWorld#hitNormal}.
   * @returns {number} Distance or -1.
   */
  castRayNormal(ox, oy, oz, dx, dy, dz, maxDist, flags, exclude) {
    const r = this._ray;
    r.origin.x = ox;
    r.origin.y = oy;
    r.origin.z = oz;
    r.dir.x = dx;
    r.dir.y = dy;
    r.dir.z = dz;
    const hit = this.world.castRayAndGetNormal(r, maxDist, true, flags, undefined, exclude);
    if (!hit) {
      this.hitHandle = -1;
      return -1;
    }
    this.hitHandle = hit.collider.handle;
    this.hitNormal.x = hit.normal.x;
    this.hitNormal.y = hit.normal.y;
    this.hitNormal.z = hit.normal.z;
    return hit.timeOfImpact;
  }

  /**
   * Sweep a sphere; returns the travel distance before contact or -1.
   * @param {number} ox @param {number} oy @param {number} oz Start centre.
   * @param {number} dx @param {number} dy @param {number} dz Unit direction.
   * @param {number} maxDist
   * @param {number} radius
   * @param {number} [flags]
   * @param {any} [exclude]
   */
  castSphere(ox, oy, oz, dx, dy, dz, maxDist, radius, flags, exclude) {
    const key = Math.round(radius * 1000);
    let ball = this._balls.get(key);
    if (!ball) {
      ball = new RAPIER.Ball(radius);
      this._balls.set(key, ball);
    }
    const p = this._shapePos;
    p.x = ox;
    p.y = oy;
    p.z = oz;
    const v = this._shapeVel;
    v.x = dx;
    v.y = dy;
    v.z = dz;
    const hit = this.world.castShape(
      p,
      this._identity,
      v,
      ball,
      0,
      maxDist,
      true,
      flags,
      undefined,
      exclude,
    );
    if (!hit) {
      this.hitHandle = -1;
      return -1;
    }
    this.hitHandle = hit.collider.handle;
    return hit.time_of_impact;
  }

  /**
   * Count non-fixed rigid bodies and how many of them are awake.
   * @param {{bodies: number, awake: number}} out
   */
  countBodies(out) {
    let bodies = 0;
    let awake = 0;
    this.world.bodies.forEach((b) => {
      if (b.isFixed()) return;
      bodies++;
      if (!b.isSleeping()) awake++;
    });
    out.bodies = bodies;
    out.awake = awake;
    return out;
  }

  /** Free WASM memory. */
  dispose() {
    this.eventQueue.free();
    this.world.free();
  }
}
