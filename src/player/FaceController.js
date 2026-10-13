import { MathUtils } from 'three';
import { FACE, PLAYER } from '../config/config.js';
import { Events } from '../core/EventBus.js';
import { EMOTE_DEFS } from './emotePoses.js';

const { damp, clamp } = MathUtils;
const rand = (a, b) => a + Math.random() * (b - a);

/** Expression ids and their shader weights. */
export const EXPRESSIONS = Object.freeze([
  'neutral',
  'happy',
  'curious',
  'sleepy',
  'excited',
  'lowBattery',
]);
const CHANNELS = Object.freeze({
  happy: 'uHappy',
  curious: 'uCurious',
  sleepy: 'uSleepy',
  excited: 'uExcited',
  lowBattery: 'uLowBat',
});

/**
 * Chooses the LED face expression from gameplay state and animates it.
 *
 * Priority (highest first):
 *   1. a forced expression (photo mode);
 *   2. low battery (set by the battery system through setLowBattery);
 *   3. the current emote's face (e.g. Zoomies → excited, Sleep → asleep);
 *   4. short reactions: excited after a big toy hit nearby or when an item
 *      is collected (react()), curious on entering a new zone or when a toy
 *      comes into view right in front of an idle pup (excited is never
 *      replaced by curious);
 *   5. sleepy after idling for a while;
 *   6. happy while barking or sitting; otherwise neutral.
 *
 * Expression weights cross-fade, blinking runs on its own timer, and the eyes
 * follow the head's look direction.
 */
export class FaceController {
  /**
   * @param {object} deps
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {import('./RobotDog.js').RobotDog} deps.dog
   * @param {import('./DogAnimator.js').DogAnimator} deps.animator
   * @param {(x: number, z: number, dirX: number, dirZ: number) => number} deps.toyAhead
   *   Distance to the nearest toy in front of the pup (Infinity if none).
   */
  constructor({ bus, dog, animator, toyAhead }) {
    this.uniforms = dog.faceMaterial.uniforms;
    this.animator = animator;
    this.toyAhead = toyAhead;
    /** Expression currently shown (after priorities). */
    this.expression = 'neutral';
    /** Forced expression ('auto' = gameplay driven). */
    this.forced = 'auto';
    this.lowBattery = false;
    this._weights = { happy: 0, curious: 0, sleepy: 0, excited: 0, lowBattery: 0 };
    this._reaction = '';
    this._reactionT = 0;
    this._emote = '';
    this._barkT = 0;
    this._squintT = 0;
    this._blinkTimer = rand(...FACE.blinkInterval);
    this._blinkT = 1;
    this._asleep = 0;
    this._zone = '';
    this._toyCheck = 0;
    this._toyNear = false;
    this._pos = { x: 0, z: 0, dirX: 0, dirZ: 1 };

    this._unsubs = [
      bus.on(Events.PLAYER_BARK, () => {
        this._barkT = 0.9;
      }),
      bus.on(Events.PLAYER_LAND, ({ hard }) => {
        if (hard) this._squintT = 0.6;
      }),
      bus.on(Events.PLAYER_ZONE, ({ id }) => {
        if (this._zone && id !== this._zone) this.react('curious', FACE.curiousDuration);
        this._zone = id;
      }),
      bus.on(Events.TOY_IMPACT, (e) => {
        if (e.strength < FACE.excitedImpactStrength) return;
        const dx = e.x - this._pos.x;
        const dz = e.z - this._pos.z;
        if (dx * dx + dz * dz < FACE.excitedImpactRadius ** 2) {
          this.react('excited', FACE.excitedDuration);
        }
      }),
      bus.on(Events.EMOTE_START, ({ id }) => {
        this._emote = EMOTE_DEFS[id] ? EMOTE_DEFS[id].face : '';
      }),
      bus.on(Events.EMOTE_END, () => {
        this._emote = '';
      }),
    ];
  }

  /**
   * Show an expression for a while (e.g. 'excited' when an item is collected).
   * @param {'happy'|'curious'|'excited'} expression
   * @param {number} seconds
   */
  react(expression, seconds) {
    if (expression === 'curious' && this._reaction === 'excited' && this._reactionT > 0) return;
    this._reaction = expression;
    this._reactionT = seconds;
  }

  /** @param {boolean} low Battery below its warning level. */
  setLowBattery(low) {
    this.lowBattery = low;
  }

  /**
   * Force an expression (photo mode) or return to gameplay-driven ('auto').
   * Forced expressions apply instantly.
   * @param {string} expression 'auto' or one of EXPRESSIONS.
   */
  force(expression) {
    this.forced = expression;
    if (expression === 'auto') return;
    for (const key of Object.keys(this._weights)) this._weights[key] = key === expression ? 1 : 0;
    this._blinkT = 1;
    this._squintT = 0;
    this._write(0, true);
  }

  /** Pick the expression from the current state. */
  _choose() {
    if (this.forced !== 'auto') return this.forced;
    if (this.lowBattery) return 'lowBattery';
    if (this._emote) return this._emote;
    if (this._reactionT > 0) return this._reaction;
    if (this.animator.idleTime > FACE.sleepyAfter) return 'sleepy';
    if (this._barkT > 0 || this.animator.sit > 0.6) return 'happy';
    return 'neutral';
  }

  /**
   * @param {number} dt
   * @param {number} time Elapsed seconds (shader animation clock).
   * @param {import('three').Vector3} position Pup feet position.
   * @param {number} yaw Pup facing.
   */
  update(dt, time, position, yaw) {
    const p = this._pos;
    p.x = position.x;
    p.z = position.z;
    p.dirX = Math.sin(yaw);
    p.dirZ = Math.cos(yaw);
    this._reactionT = Math.max(0, this._reactionT - dt);
    this._barkT = Math.max(0, this._barkT - dt);
    this._squintT = Math.max(0, this._squintT - dt);

    this._toyCheck -= dt;
    if (this._toyCheck <= 0) {
      this._toyCheck = 0.25;
      const idle = this.animator.speed < PLAYER.idleSpeedThreshold * 4;
      const near = idle && this.toyAhead(p.x, p.z, p.dirX, p.dirZ) < FACE.curiousToyDistance;
      if (near && !this._toyNear) this.react('curious', FACE.curiousDuration);
      this._toyNear = near;
    }

    const expr = this._choose();
    this.expression = expr === 'sleep' ? 'sleepy' : expr;
    for (const key of Object.keys(this._weights)) {
      const target = key === this.expression ? 1 : 0;
      this._weights[key] = damp(this._weights[key], target, FACE.blendRate, dt);
    }

    // Blinking (eyes stay shut while asleep).
    this._blinkTimer -= dt;
    if (this._blinkTimer <= 0) {
      this._blinkTimer = rand(...FACE.blinkInterval);
      this._blinkT = 0;
    }
    this._blinkT = Math.min(1, this._blinkT + dt / 0.16);
    this._asleep = damp(this._asleep, expr === 'sleep' ? 1 : 0, 4, dt);
    this._write(time, false);
  }

  _write(time, forced) {
    const u = this.uniforms;
    const a = this.animator;
    const blink = this._blinkT < 1 ? Math.sin(this._blinkT * Math.PI) : 0;
    const sitDrowsy = !forced && a.sit > 0.95 && this.expression === 'neutral' ? 0.35 : 0;
    if (time) u.uTime.value = time;
    u.uBlink.value = forced ? 0 : Math.max(blink, sitDrowsy, this._asleep);
    u.uSquint.value = this._squintT > 0 ? 1 : 0;
    u.uMouth.value = forced ? 0 : a.jawOpen * 2;
    u.uLook.value.set(clamp(a.lookYaw * 1.5, -1, 1), clamp(-a.lookPitch * 1.5, -1, 1));
    for (const [key, uniform] of Object.entries(CHANNELS)) u[uniform].value = this._weights[key];
  }

  dispose() {
    for (const off of this._unsubs) off();
  }
}
