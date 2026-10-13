import { Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { PHYSICS, PLAYER } from '../config/config.js';
import { Events } from '../core/EventBus.js';
import { TOY_CATALOG } from './propCatalog.js';

const _m = new Matrix4();
const _pa = new Vector3();
const _pb = new Vector3();
const _qa = new Quaternion();
const _qb = new Quaternion();
const _one = new Vector3(1, 1, 1);
const _mPart = new Matrix4();

/**
 * Dynamic physics toys (balls, plushies, squeaky cubes).
 *
 * - Rapier rigid bodies stepped at 60 Hz; transforms are snapshotted after
 *   each step and interpolated for rendering (no jitter at any refresh rate).
 * - One InstancedMesh per toy type and material part; only awake bodies
 *   rewrite their instance matrices.
 * - Contact-force events produce TOY_IMPACT (sound) events with a per-toy
 *   cooldown; the dog's bark gives nearby toys a playful radial nudge.
 */
export class Toys {
  /**
   * @param {object} deps
   * @param {import('../physics/PhysicsWorld.js').PhysicsWorld} deps.physics
   * @param {Map<string, any[][]>} deps.lib Parsed prop library.
   * @param {import('./MaterialLibrary.js').MaterialLibrary} deps.materials
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {{type:string,x:number,y:number,z:number}[]} deps.spawns
   */
  constructor({ physics, lib, materials, bus, spawns }) {
    this.physics = physics;
    this.bus = bus;
    this.group = new Group();
    this.group.name = 'Toys';
    const R = physics.RAPIER;
    const world = physics.world;

    const n = spawns.length;
    this.count = n;
    this.bodies = new Array(n);
    this.types = new Array(n);
    this.spawns = spawns;
    this.prev = new Float32Array(n * 7);
    this.curr = new Float32Array(n * 7);
    this.awake = new Uint8Array(n);
    this.dirty = new Uint8Array(n).fill(1);
    this.cooldown = new Float32Array(n);
    /** @type {Map<number, number>} collider handle → toy index */
    this.byCollider = new Map();
    /** @type {Map<string, {meshes: {mesh: InstancedMesh, partMatrix: Matrix4}[], indices: number[]}>} */
    this.renderTypes = new Map();
    this._impact = { kind: '', x: 0, y: 0, z: 0, strength: 0 };

    spawns.forEach((s, i) => {
      if (!this.renderTypes.has(s.type)) this.renderTypes.set(s.type, { meshes: [], indices: [] });
      const rt = this.renderTypes.get(s.type);
      rt.indices.push(i);
      this.types[i] = s.type;
    });

    for (const [type, rt] of this.renderTypes) {
      const lods = lib.get(`toy_${type}`);
      if (!lods) throw new Error(`Toys: toy "${type}" missing from library`);
      for (const part of lods[0]) {
        const mesh = new InstancedMesh(part.geometry, materials.get(part.slot), rt.indices.length);
        mesh.name = `toy:${type}|${part.slot}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        // Toys roam the whole shelter: keep them out of frustum culling
        // rather than recomputing bounds every frame.
        mesh.frustumCulled = false;
        rt.meshes.push({ mesh, partMatrix: part.matrix });
        this.group.add(mesh);
      }
    }

    spawns.forEach((s, i) => {
      const def = TOY_CATALOG[s.type];
      const body = world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(s.x, s.y, s.z)
          .setLinearDamping(def.linearDamping)
          .setAngularDamping(def.angularDamping)
          .setCcdEnabled(def.shape.s === 'ball' && def.shape.r < 0.1),
      );
      for (const desc of this._colliderDescs(R, def)) {
        desc
          .setRestitution(def.restitution)
          .setFriction(def.friction)
          .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS);
        const collider = world.createCollider(desc, body);
        this.byCollider.set(collider.handle, i);
      }
      // Fire impact events only well above the toy's resting weight.
      const threshold = body.mass() * 9.81 * 3 + PHYSICS.toyImpactForceThreshold;
      for (let c = 0; c < body.numColliders(); c++)
        body.collider(c).setContactForceEventThreshold(threshold);
      this.bodies[i] = body;
      this._snapshot(i, this.curr);
      this.prev.set(this.curr.subarray(i * 7, i * 7 + 7), i * 7);
    });

    this._onBark = bus.on(Events.PLAYER_BARK, (e) => this._bark(e));
    physics.onPostStep(() => this._postStep());
  }

  _colliderDescs(R, def) {
    const s = def.shape;
    const out = [];
    if (s.s === 'ball') out.push(R.ColliderDesc.ball(s.r).setDensity(def.density));
    else if (s.s === 'box')
      out.push(R.ColliderDesc.cuboid(s.hx, s.hy, s.hz).setDensity(def.density));
    else if (s.s === 'capsuleZ') {
      const h = Math.SQRT1_2;
      out.push(
        R.ColliderDesc.capsule(s.hh, s.r)
          .setRotation({ x: h, y: 0, z: 0, w: h })
          .setDensity(def.density),
      );
    } else if (s.s === 'torus') {
      const segments = 8;
      for (let k = 0; k < segments; k++) {
        const a = (k / segments) * Math.PI * 2;
        out.push(
          R.ColliderDesc.ball(s.r)
            .setTranslation(Math.cos(a) * s.R, 0, Math.sin(a) * s.R)
            .setDensity(def.density),
        );
      }
    }
    if (def.comOffsetY) {
      // A small dense ballast lowers the centre of mass (self-righting duck).
      out.push(
        R.ColliderDesc.ball(0.03)
          .setTranslation(0, def.comOffsetY, 0)
          .setDensity(def.density * 6),
      );
    }
    return out;
  }

  _snapshot(i, target) {
    const b = this.bodies[i];
    const t = b.translation();
    const r = b.rotation();
    const o = i * 7;
    target[o] = t.x;
    target[o + 1] = t.y;
    target[o + 2] = t.z;
    target[o + 3] = r.x;
    target[o + 4] = r.y;
    target[o + 5] = r.z;
    target[o + 6] = r.w;
  }

  _postStep() {
    const prev = this.prev;
    const curr = this.curr;
    for (let i = 0; i < this.count; i++) {
      const body = this.bodies[i];
      const o = i * 7;
      if (body.isSleeping()) {
        if (this.awake[i]) {
          for (let k = 0; k < 7; k++) prev[o + k] = curr[o + k];
          this.awake[i] = 0;
          this.dirty[i] = 1;
        }
        continue;
      }
      for (let k = 0; k < 7; k++) prev[o + k] = curr[o + k];
      this._snapshot(i, curr);
      this.awake[i] = 1;
      this.dirty[i] = 1;
      if (curr[o + 1] < PHYSICS.killPlaneY) this.respawn(i);
    }
    this.physics.drainContactForces((h1, h2, force) => {
      const i = this.byCollider.get(h1) ?? this.byCollider.get(h2);
      if (i === undefined || this.cooldown[i] > 0) return;
      this.cooldown[i] = 0.14;
      const o = i * 7;
      const p = this._impact;
      p.kind = TOY_CATALOG[this.types[i]].sound;
      p.x = curr[o];
      p.y = curr[o + 1];
      p.z = curr[o + 2];
      p.strength = Math.min(1, force / (this.bodies[i].mass() * 120 + 40));
      this.bus.emit(Events.TOY_IMPACT, p);
    });
  }

  /**
   * Put a toy back at its spawn point.
   * @param {number} i
   */
  respawn(i) {
    const s = this.spawns[i];
    const b = this.bodies[i];
    b.setTranslation({ x: s.x, y: s.y + 0.2, z: s.z }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this._snapshot(i, this.curr);
    this.prev.set(this.curr.subarray(i * 7, i * 7 + 7), i * 7);
  }

  /** Respawn every toy (used when returning to the title screen). */
  resetAll() {
    for (let i = 0; i < this.count; i++) this.respawn(i);
    this.dirty.fill(1);
  }

  /**
   * Distance to the nearest toy within a ±60° cone in front of a point.
   * @param {number} x @param {number} z Position.
   * @param {number} dirX @param {number} dirZ Unit facing.
   * @returns {number} Metres, or Infinity.
   */
  nearestAhead(x, z, dirX, dirZ) {
    let best = Infinity;
    for (let i = 0; i < this.count; i++) {
      const o = i * 7;
      const dx = this.curr[o] - x;
      const dz = this.curr[o + 2] - z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-3 || d >= best) continue;
      if ((dx * dirX + dz * dirZ) / d < 0.5) continue;
      best = d;
    }
    return best;
  }

  _bark(e) {
    const range = PLAYER.barkRadius;
    for (let i = 0; i < this.count; i++) {
      const o = i * 7;
      const dx = this.curr[o] - e.x;
      const dy = this.curr[o + 1] - e.y;
      const dz = this.curr[o + 2] - e.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range || dist < 1e-3) continue;
      const nx = dx / dist;
      const nz = dz / dist;
      if (nx * e.dirX + nz * e.dirZ < PLAYER.barkConeDot) continue;
      const body = this.bodies[i];
      const k = PLAYER.barkImpulse * body.mass() * (1 - dist / range) * (dy < 1 ? 1 : 0.4);
      body.applyImpulse({ x: nx * k, y: k * 0.55, z: nz * k }, true);
    }
  }

  /**
   * Interpolate transforms for rendering.
   * @param {number} alpha
   * @param {number} dt
   */
  update(alpha, dt) {
    for (let i = 0; i < this.count; i++) if (this.cooldown[i] > 0) this.cooldown[i] -= dt;
    for (const rt of this.renderTypes.values()) {
      let changed = false;
      for (let k = 0; k < rt.indices.length; k++) {
        const i = rt.indices[k];
        if (!this.dirty[i] && !this.awake[i]) continue;
        const o = i * 7;
        _pa.set(this.prev[o], this.prev[o + 1], this.prev[o + 2]);
        _pb.set(this.curr[o], this.curr[o + 1], this.curr[o + 2]);
        _pa.lerp(_pb, this.awake[i] ? alpha : 1);
        _qa.set(this.prev[o + 3], this.prev[o + 4], this.prev[o + 5], this.prev[o + 6]);
        _qb.set(this.curr[o + 3], this.curr[o + 4], this.curr[o + 5], this.curr[o + 6]);
        _qa.slerp(_qb, this.awake[i] ? alpha : 1);
        const base = _m.compose(_pa, _qa, _one);
        for (const { mesh, partMatrix } of rt.meshes) {
          mesh.setMatrixAt(k, _mPart.multiplyMatrices(base, partMatrix));
        }
        if (!this.awake[i]) this.dirty[i] = 0;
        changed = true;
      }
      if (changed) for (const { mesh } of rt.meshes) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    this._onBark();
    for (const b of this.bodies) this.physics.world.removeRigidBody(b);
    this.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
  }
}
