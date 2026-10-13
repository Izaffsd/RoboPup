import { MathUtils, Vector3 } from 'three';
import { EMOTES, PLAYER } from '../config/config.js';
import { Events } from '../core/EventBus.js';
import { EMOTE_DEFS } from './emotePoses.js';

const { clamp } = MathUtils;

/**
 * Gameplay side of emotes (the pose itself lives in DogAnimator):
 *
 * - starts emotes requested through {@link Events.EMOTE_REQUEST} (wheel,
 *   number keys) — immediately when grounded, or on landing within a short
 *   grace period when requested mid-air;
 * - holds the pup still, or steers it for Zoomies (a sprint around a circle
 *   that reverses when blocked);
 * - ends one-shot emotes after their duration, and cancels any emote as soon
 *   as the player moves or jumps (barking wakes a sleeping pup);
 * - lies the pup down to sleep by itself after a long idle;
 * - announces EMOTE_START / EMOTE_END for audio, the face, stats and (later)
 *   NPC reactions.
 */
export class EmoteSystem {
  /**
   * @param {object} deps
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {import('./DogAnimator.js').DogAnimator} deps.animator
   * @param {import('./DogController.js').DogController} deps.controller
   */
  constructor({ bus, animator, controller }) {
    this.bus = bus;
    this.animator = animator;
    this.controller = controller;
    /** Current emote id ('' when none). */
    this.id = '';
    this.def = null;
    this.t = 0;
    /** Only accept requests while playing. */
    this.enabled = false;
    this._pending = '';
    this._pendingT = 0;
    this._idle = 0;
    this._center = new Vector3();
    this._dir = 1;
    this._blocked = 0;
    this._reversals = 0;
    this._startPayload = { id: '', x: 0, y: 0, z: 0 };
    this._endPayload = { id: '', reason: '' };
    this._unsub = bus.on(Events.EMOTE_REQUEST, (id) => this.request(id));
  }

  /** @param {string} id */
  request(id) {
    if (!this.enabled || !EMOTE_DEFS[id]) return;
    if (!this.controller.grounded) {
      this._pending = id;
      this._pendingT = EMOTES.airborneGrace;
      return;
    }
    this._start(id);
  }

  /** Stop the current emote (blends out smoothly). */
  cancel() {
    this._pending = '';
    if (this.id) this._end('cancelled');
  }

  _start(id) {
    if (this.id) this._end('cancelled');
    const def = EMOTE_DEFS[id];
    const c = this.controller;
    this.id = id;
    this.def = def;
    this.t = 0;
    this._pending = '';
    this._idle = 0;
    this.animator.playEmote(id);
    if (def.locomotion) {
      // Circle to one side of the current heading, starting straight ahead.
      this._dir = Math.random() < 0.5 ? 1 : -1;
      const rx = Math.cos(c.yaw);
      const rz = -Math.sin(c.yaw);
      this._center.set(
        c.rootPos.x + rx * EMOTES.zoomiesRadius * this._dir,
        c.rootPos.y,
        c.rootPos.z + rz * EMOTES.zoomiesRadius * this._dir,
      );
      this._blocked = 0;
      this._reversals = 0;
      c.emoteMode = 'auto';
      this._steer(0);
    } else {
      c.emoteMode = 'hold';
    }
    const p = this._startPayload;
    p.id = id;
    p.x = c.rootPos.x;
    p.y = c.rootPos.y;
    p.z = c.rootPos.z;
    this.bus.emit(Events.EMOTE_START, p);
  }

  _end(reason) {
    const id = this.id;
    this.id = '';
    this.def = null;
    this.animator.stopEmote();
    this.controller.emoteMode = 'free';
    this._endPayload.id = id;
    this._endPayload.reason = reason;
    this.bus.emit(Events.EMOTE_END, this._endPayload);
  }

  /**
   * @param {number} dt
   * @param {import('../core/Input.js').Input['state']} input Gameplay input this frame.
   */
  update(dt, input) {
    const c = this.controller;
    if (this._pending) {
      this._pendingT -= dt;
      if (c.grounded) this._start(this._pending);
      else if (this._pendingT <= 0) this._pending = '';
    }

    if (!this.id) {
      const still =
        c.grounded && this.animator.speed < PLAYER.idleSpeedThreshold && !input.jumpPressed;
      this._idle = still ? this._idle + dt : 0;
      if (this._idle > EMOTES.autoSleepAfter) this._start('sleep');
      return;
    }

    this.t += dt;
    const moving = Math.hypot(input.moveX, input.moveY) > EMOTES.cancelThreshold;
    if (moving || input.jumpPressed || (this.id === 'sleep' && input.barkPressed)) {
      this._end('cancelled');
      return;
    }
    if (this.t >= this.def.duration) {
      this._end('done');
      return;
    }
    if (this.def.locomotion) this._steer(dt);
  }

  /** Zoomies: run tangentially around the centre, correcting towards the radius. */
  _steer(dt) {
    const c = this.controller;
    const R = EMOTES.zoomiesRadius;
    const dx = c.rootPos.x - this._center.x;
    const dz = c.rootPos.z - this._center.z;
    const r = Math.max(1e-3, Math.hypot(dx, dz));
    const nx = dx / r;
    const nz = dz / r;
    const corr = clamp((R - r) / R, -1, 1) * 0.9;
    let tx = nz * this._dir + nx * corr;
    let tz = -nx * this._dir + nz * corr;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    c.autopilot.set(tx, 0, tz);

    // Blocked by a wall or prop: mirror the circle and run the other way.
    const v = c.character.actualVelocity;
    const speed = Math.hypot(v.x, v.z);
    this._blocked = this.t > 0.4 && speed < EMOTES.zoomiesMinSpeed ? this._blocked + dt : 0;
    if (this._blocked > EMOTES.zoomiesBlockedTime) {
      this._blocked = 0;
      this._reversals++;
      if (this._reversals > 2) {
        this._end('done');
        return;
      }
      this._dir = -this._dir;
      this._center.set(
        2 * c.rootPos.x - this._center.x,
        c.rootPos.y,
        2 * c.rootPos.z - this._center.z,
      );
    }
  }

  /** Forget pending requests and idle time (pause, quit). */
  reset() {
    this._pending = '';
    this._idle = 0;
  }

  dispose() {
    this._unsub();
  }
}
