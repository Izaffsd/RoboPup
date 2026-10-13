import { MathUtils, Vector3 } from 'three';
import { PHYSICS, PLAYER } from '../config/config.js';
import { Events } from '../core/EventBus.js';

const { damp } = MathUtils;

/** Shortest signed angle from a to b. */
function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Gameplay controller for the robo-pup.
 *
 * Input is sampled every rendered frame; movement runs in the fixed 60 Hz
 * physics step:
 *  - camera-relative WASD / stick direction, walk vs sprint speed;
 *  - acceleration / deceleration curves, reduced air control;
 *  - realistic gravity with a slightly heavier fall, terminal velocity;
 *  - coyote time and jump buffering, variable jump height (early release);
 *  - facing turns smoothly toward the movement direction;
 *  - bark with cooldown (sound + head animation + toy nudge via events).
 *
 * Rendering reads an interpolated, step-smoothed root transform.
 */
export class DogController {
  /**
   * @param {object} deps
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {import('../physics/CharacterController.js').CharacterController} deps.character
   * @param {import('./DogAnimator.js').DogAnimator} deps.animator
   * @param {(x: number, z: number) => {id: string, name: string}} deps.zoneAt
   */
  constructor({ bus, character, animator, zoneAt }) {
    this.bus = bus;
    this.character = character;
    this.animator = animator;
    this.zoneAt = zoneAt;

    /** Requested velocity (m/s): horizontal is accelerated, vertical integrates gravity. */
    this.velocity = new Vector3();
    this.yaw = PLAYER.spawn.yaw;
    this.prevYaw = this.yaw;
    this.renderYaw = this.yaw;
    this.turnRate = 0;
    this.grounded = false;
    this.jumping = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpCut = false;
    this.barkQueued = false;
    this.barkCooldown = 0;
    this.sprint = false;
    this.airTime = 0;

    /** Desired move direction in world space (length ≤ 1). */
    this.wish = new Vector3();
    /** Interpolated feet position used by animation and camera. */
    this.rootPos = new Vector3();
    this._physRoot = new Vector3();
    this._visualY = null;
    this.smoothedVelocity = new Vector3();
    this.forward = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.zone = null;
    /**
     * Emote control: 'free' (player input moves the pup), 'hold' (stand
     * still while posing) or 'auto' (EmoteSystem steers via `autopilot`).
     */
    this.emoteMode = 'free';
    /** Unit direction the autopilot runs towards (sprinting). */
    this.autopilot = new Vector3();

    this._jumpPayload = { x: 0, y: 0, z: 0 };
    this._landPayload = { impact: 0, hard: false, x: 0, y: 0, z: 0 };
    this._barkPayload = { x: 0, y: 0, z: 0, dirX: 0, dirZ: 1 };
    this._zonePayload = { id: '', name: '' };
    this.character.getFeetPosition(1, this.rootPos);
  }

  /**
   * Sample input (once per rendered frame).
   * @param {import('../core/Input.js').Input['state']} input
   * @param {number} cameraYaw Orbit yaw of the camera.
   */
  handleInput(input, cameraYaw) {
    if (this.emoteMode === 'hold') {
      this.wish.set(0, 0, 0);
      this.sprint = false;
    } else if (this.emoteMode === 'auto') {
      this.wish.copy(this.autopilot);
      this.sprint = true;
    } else {
      const fx = -Math.sin(cameraYaw);
      const fz = -Math.cos(cameraYaw);
      const rx = Math.cos(cameraYaw);
      const rz = -Math.sin(cameraYaw);
      this.wish.set(fx * input.moveY + rx * input.moveX, 0, fz * input.moveY + rz * input.moveX);
      const len = this.wish.length();
      if (len > 1) this.wish.multiplyScalar(1 / len);
      this.sprint = input.sprint;
    }
    if (input.jumpPressed) this.jumpBuffer = PLAYER.jumpBufferTime;
    if (input.jumpReleased) this.jumpCut = true;
    if (input.barkPressed) this.barkQueued = true;
  }

  /** Clear any pending input (menus). */
  clearInput() {
    this.wish.set(0, 0, 0);
    this.sprint = false;
    this.jumpBuffer = 0;
    this.jumpCut = false;
    this.barkQueued = false;
  }

  /**
   * Fixed-step simulation.
   * @param {number} dt
   */
  fixedUpdate(dt) {
    const v = this.velocity;
    this.prevYaw = this.yaw;
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.barkCooldown = Math.max(0, this.barkCooldown - dt);

    // Horizontal acceleration toward the wished velocity.
    const maxSpeed = this.sprint ? PLAYER.runSpeed : PLAYER.walkSpeed;
    const tx = this.wish.x * maxSpeed;
    const tz = this.wish.z * maxSpeed;
    const hasInput = this.wish.lengthSq() > 1e-4;
    let rate = hasInput ? PLAYER.groundAcceleration : PLAYER.groundDeceleration;
    if (!this.grounded) rate *= PLAYER.airControl;
    const dx = tx - v.x;
    const dz = tz - v.z;
    const dist = Math.hypot(dx, dz);
    const maxStep = rate * dt;
    if (dist <= maxStep) {
      v.x = tx;
      v.z = tz;
    } else {
      v.x += (dx / dist) * maxStep;
      v.z += (dz / dist) * maxStep;
    }

    // Face the movement direction.
    if (hasInput) {
      const targetYaw = Math.atan2(this.wish.x, this.wish.z);
      const turn = PLAYER.turnRate * (this.grounded ? 1 : 0.5);
      this.yaw += angleDelta(this.yaw, targetYaw) * (1 - Math.exp(-turn * dt));
    }
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));

    // Jump (coyote time + buffer).
    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0) && !this.jumping) {
      v.y = PLAYER.jumpVelocity;
      this.jumping = true;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.jumpCut = false;
      const p = this.character.position;
      this._jumpPayload.x = p.x;
      this._jumpPayload.y = p.y;
      this._jumpPayload.z = p.z;
      this.bus.emit(Events.PLAYER_JUMP, this._jumpPayload);
    }
    if (this.jumpCut) {
      if (this.jumping && v.y > 0) v.y *= PLAYER.jumpCutMultiplier;
      this.jumpCut = false;
    }

    // Gravity accumulates only while airborne. On the ground a small constant
    // downward "stick" velocity keeps contact (snap-to-ground handles slopes
    // and steps), so walking never builds up a large downward speed.
    if (this.grounded && !this.jumping) {
      v.y = -PLAYER.groundStickSpeed;
    } else {
      const g = PHYSICS.gravity * (v.y < 0 ? PLAYER.fallGravityMultiplier : 1);
      v.y = Math.max(-PLAYER.maxFallSpeed, v.y + g * dt);
    }
    const fallSpeed = -v.y;

    this.character.move(dt, v, this.forward.x, this.forward.z, this.sprint ? 1 : 0.3);

    const wasGrounded = this.grounded;
    this.grounded = this.character.grounded && !(this.jumping && v.y > 0);
    if (this.character.hitCeiling && v.y > 0) v.y = 0;

    if (this.grounded) {
      if (!wasGrounded) this._land(fallSpeed);
      this.jumping = false;
      this.coyote = PLAYER.coyoteTime;
      this.airTime = 0;
      // Blocked by walls/props: don't keep pushing a stored speed into them.
      const a = this.character.actualVelocity;
      v.x = a.x;
      v.z = a.z;
    } else {
      this.coyote = Math.max(0, this.coyote - dt);
      this.airTime += dt;
    }

    this.turnRate = damp(this.turnRate, angleDelta(this.prevYaw, this.yaw) / dt, 12, dt);

    if (this.barkQueued) {
      this.barkQueued = false;
      if (this.barkCooldown <= 0) this._bark();
    }
  }

  _land(fallSpeed) {
    const p = this._landPayload;
    p.impact = fallSpeed;
    p.hard = fallSpeed > PLAYER.hardLandingSpeed;
    p.x = this.rootPos.x;
    p.y = this.rootPos.y;
    p.z = this.rootPos.z;
    this.bus.emit(Events.PLAYER_LAND, p);
    this.character.getFeetPosition(1, this._physRoot);
    this.animator.onLand(fallSpeed, this._physRoot);
  }

  _bark() {
    this.barkCooldown = PLAYER.barkCooldown;
    const p = this._barkPayload;
    const c = this.character.position;
    p.x = c.x + this.forward.x * 0.45;
    p.y = c.y - this.character.footOffset + 0.6;
    p.z = c.z + this.forward.z * 0.45;
    p.dirX = this.forward.x;
    p.dirZ = this.forward.z;
    this.animator.triggerBark();
    this.bus.emit(Events.PLAYER_BARK, p);
  }

  /**
   * Per-frame visual update: interpolation + animation.
   * @param {number} dt Frame delta.
   * @param {number} alpha Fixed-step interpolation factor.
   * @param {number} time Elapsed seconds.
   * @param {Vector3} [lookAt] Point the dog may glance at when idle.
   */
  update(dt, alpha, time, lookAt) {
    this.character.getFeetPosition(alpha, this._physRoot);
    // Smooth auto-step/snap height changes while grounded; follow exactly in the air.
    if (
      this._visualY === null ||
      !this.grounded ||
      Math.abs(this._physRoot.y - this._visualY) > 0.45
    ) {
      this._visualY = this._physRoot.y;
    } else {
      this._visualY = damp(this._visualY, this._physRoot.y, 16, dt);
    }
    this.rootPos.set(this._physRoot.x, this._visualY, this._physRoot.z);
    this.renderYaw = this.prevYaw + angleDelta(this.prevYaw, this.yaw) * alpha;
    const a = this.character.actualVelocity;
    this.smoothedVelocity.x = damp(this.smoothedVelocity.x, a.x, 14, dt);
    this.smoothedVelocity.y = this.grounded ? 0 : this.velocity.y;
    this.smoothedVelocity.z = damp(this.smoothedVelocity.z, a.z, 14, dt);

    this.animator.update(dt, {
      rootPos: this.rootPos,
      yaw: this.renderYaw,
      velocity: this.smoothedVelocity,
      grounded: this.grounded,
      turnRate: this.turnRate,
      time,
      lookAt,
    });

    const zone = this.zoneAt(this.rootPos.x, this.rootPos.z);
    if (zone !== this.zone) {
      this.zone = zone;
      this._zonePayload.id = zone.id;
      this._zonePayload.name = zone.name;
      this.bus.emit(Events.PLAYER_ZONE, this._zonePayload);
    }
  }

  /** Return to the spawn point. */
  respawn() {
    const s = PLAYER.spawn;
    this.character.teleport(s);
    this.velocity.set(0, 0, 0);
    this.yaw = s.yaw;
    this.prevYaw = s.yaw;
    this.renderYaw = s.yaw;
    this.grounded = false;
    this.jumping = false;
    this._visualY = null;
    this.character.getFeetPosition(1, this.rootPos);
    this.animator.resetPose(this.rootPos, this.yaw);
  }
}
