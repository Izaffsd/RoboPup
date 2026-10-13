import { Vector3 } from 'three';
import { PHYSICS, PLAYER } from '../config/config.js';

const _toyDir = new Vector3();

/**
 * Kinematic capsule character built on Rapier's KinematicCharacterController.
 *
 * Responsibilities: collide-and-slide movement, slope limits, auto-step for
 * small ledges, snap-to-ground, grounded detection, a forward "head probe"
 * that keeps the snout (which sticks out of the capsule) from entering walls,
 * and nudging dynamic toys out of the way.
 *
 * Gameplay decisions (input, jump rules, gravity multipliers) live in
 * DogController; this class only executes a requested velocity.
 */
export class CharacterController {
  /**
   * @param {import('./PhysicsWorld.js').PhysicsWorld} physics
   * @param {{x:number,y:number,z:number}} spawn Feet position.
   */
  constructor(physics, spawn) {
    const R = physics.RAPIER;
    this.physics = physics;
    this.RAPIER = R;
    this.halfHeight = PLAYER.capsuleHalfHeight;
    this.radius = PLAYER.capsuleRadius;
    /** Distance from the capsule centre down to the feet. */
    this.footOffset = this.halfHeight + this.radius;

    const world = physics.world;
    this.body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(
        spawn.x,
        spawn.y + this.footOffset,
        spawn.z,
      ),
    );
    this.collider = world.createCollider(
      R.ColliderDesc.capsule(this.halfHeight, this.radius).setFriction(0).setRestitution(0),
      this.body,
    );

    const kcc = world.createCharacterController(PLAYER.controllerOffset);
    kcc.setUp({ x: 0, y: 1, z: 0 });
    kcc.setSlideEnabled(true);
    kcc.setMaxSlopeClimbAngle(PLAYER.maxSlopeClimbAngle);
    kcc.setMinSlopeSlideAngle(PLAYER.minSlopeSlideAngle);
    kcc.enableAutostep(PLAYER.autostepMaxHeight, PLAYER.autostepMinWidth, false);
    kcc.enableSnapToGround(PLAYER.snapToGroundDistance);
    kcc.setApplyImpulsesToDynamicBodies(false);
    this.kcc = kcc;

    /** Capsule centre at the previous and current fixed step (for interpolation). */
    this.prevPosition = new Vector3(spawn.x, spawn.y + this.footOffset, spawn.z);
    this.position = this.prevPosition.clone();
    /** Velocity actually achieved during the last step (m/s). */
    this.actualVelocity = new Vector3();
    this.grounded = false;
    this.hitCeiling = false;
    /** Remaining head clearance in front of the dog (m); negative = penetrating. */
    this.headClearance = Infinity;

    this._desired = { x: 0, y: 0, z: 0 };
    this._moved = { x: 0, y: 0, z: 0 };
    this._next = { x: 0, y: 0, z: 0 };
    this._collision = null;
    this._pushed = new Set();
    this._probeFlags = R.QueryFilterFlags.EXCLUDE_DYNAMIC | R.QueryFilterFlags.EXCLUDE_SENSORS;
    this._moveFlags = R.QueryFilterFlags.EXCLUDE_SENSORS;
    this._spawn = { ...spawn };
  }

  /**
   * Move with the requested velocity for one fixed step.
   * @param {number} dt
   * @param {Vector3} velocity Requested velocity (m/s), including vertical.
   * @param {number} facingX Unit facing direction (x).
   * @param {number} facingZ Unit facing direction (z).
   * @param {number} pushSpeedScale Extra lift multiplier when sprinting into toys.
   */
  move(dt, velocity, facingX, facingZ, pushSpeedScale = 0) {
    this.prevPosition.copy(this.position);
    const d = this._desired;
    d.x = velocity.x * dt;
    d.y = velocity.y * dt;
    d.z = velocity.z * dt;

    // Head probe: keep the snout out of walls and props.
    this._applyHeadProbe(d, facingX, facingZ);

    this.kcc.computeColliderMovement(this.collider, d, this._moveFlags);
    this.kcc.computedMovement(this._moved);
    const m = this._moved;
    this.grounded = this.kcc.computedGrounded();
    this.hitCeiling = d.y > 0 && m.y < d.y * 0.5;

    this._pushToys(velocity, pushSpeedScale);

    const p = this.position;
    p.x += m.x;
    p.y += m.y;
    p.z += m.z;
    if (p.y < PHYSICS.killPlaneY) this.teleport(this._spawn);
    this._next.x = p.x;
    this._next.y = p.y;
    this._next.z = p.z;
    this.body.setNextKinematicTranslation(this._next);

    const inv = 1 / dt;
    this.actualVelocity.set(m.x * inv, m.y * inv, m.z * inv);
  }

  _applyHeadProbe(d, fx, fz) {
    const len = Math.hypot(fx, fz);
    if (len < 1e-4) return;
    fx /= len;
    fz /= len;
    const p = this.position;
    const probeY = p.y - this.footOffset + PLAYER.headProbeHeight;
    const r = PLAYER.headProbeRadius;
    const reach = PLAYER.headReach - r;
    const t = this.physics.castSphere(
      p.x,
      probeY,
      p.z,
      fx,
      0,
      fz,
      reach + 0.25,
      r,
      this._probeFlags,
      this.collider,
    );
    this.headClearance = t < 0 ? Infinity : t - reach;
    if (this.headClearance >= 0.02) return;
    // Block forward motion and gently back away if the snout is already inside.
    const forward = d.x * fx + d.z * fz;
    const allowed = Math.max(0, this.headClearance);
    if (forward > allowed) {
      const cut = forward - allowed;
      d.x -= fx * cut;
      d.z -= fz * cut;
    }
    if (this.headClearance < 0) {
      const back = Math.min(-this.headClearance, 0.03);
      d.x -= fx * back;
      d.z -= fz * back;
    }
  }

  _pushToys(velocity, liftScale) {
    const n = this.kcc.numComputedCollisions();
    if (n === 0) return;
    const speed = Math.hypot(velocity.x, velocity.z);
    if (speed < 0.05) return;
    this._pushed.clear();
    const p = this.position;
    for (let i = 0; i < n; i++) {
      this._collision = this.kcc.computedCollision(i, this._collision || undefined);
      const c = this._collision;
      if (!c || !c.collider) continue;
      const body = c.collider.parent();
      if (!body || !body.isDynamic() || this._pushed.has(body.handle)) continue;
      this._pushed.add(body.handle);
      const t = body.translation();
      _toyDir.set(t.x - p.x, 0, t.z - p.z);
      if (_toyDir.lengthSq() < 1e-6) _toyDir.set(velocity.x, 0, velocity.z);
      _toyDir.normalize();
      // Blend toward the move direction so toys roll ahead of the dog.
      _toyDir.x = _toyDir.x * 0.5 + (velocity.x / speed) * 0.5;
      _toyDir.z = _toyDir.z * 0.5 + (velocity.z / speed) * 0.5;
      _toyDir.normalize();
      const mass = body.mass();
      const j = Math.min(PLAYER.maxPushImpulse, mass * speed * PLAYER.pushStrength);
      body.applyImpulse(
        { x: _toyDir.x * j, y: j * PLAYER.pushLift * liftScale, z: _toyDir.z * j },
        true,
      );
    }
  }

  /**
   * Instantly move the character (feet position).
   * @param {{x:number,y:number,z:number}} feet
   */
  teleport(feet) {
    this.position.set(feet.x, feet.y + this.footOffset, feet.z);
    this.prevPosition.copy(this.position);
    this._next.x = this.position.x;
    this._next.y = this.position.y;
    this._next.z = this.position.z;
    this.body.setTranslation(this._next, true);
    this.actualVelocity.set(0, 0, 0);
  }

  /**
   * Interpolated feet position for rendering.
   * @param {number} alpha
   * @param {Vector3} out
   */
  getFeetPosition(alpha, out) {
    out.lerpVectors(this.prevPosition, this.position, alpha);
    out.y -= this.footOffset;
    return out;
  }

  dispose() {
    this.physics.world.removeCharacterController(this.kcc);
    this.physics.world.removeRigidBody(this.body);
  }
}
