import { PHYSICS } from '../config/config.js';

/**
 * Frame timing. Converts the high-resolution timestamp handed to the animation
 * loop into a clamped delta and keeps the fixed-step interpolation factor.
 */
export class Time {
  constructor() {
    /** Clamped seconds since the previous frame. */
    this.delta = 0;
    /** Unclamped seconds since the previous frame (used for FPS measurement). */
    this.rawDelta = 0;
    /** Seconds of simulated (clamped) time since start. */
    this.elapsed = 0;
    /** Rendered frame counter. */
    this.frame = 0;
    /** Interpolation factor in [0, 1] between the last two fixed physics states. */
    this.alpha = 1;
    this._last = -1;
  }

  /**
   * Advance the clock.
   * @param {number} nowMs Timestamp in milliseconds (from requestAnimationFrame).
   */
  tick(nowMs) {
    const now = nowMs / 1000;
    if (this._last < 0) this._last = now;
    const d = now - this._last;
    this._last = now;
    this.rawDelta = d > 0 ? d : 0;
    this.delta = Math.min(this.rawDelta, PHYSICS.maxFrameDelta);
    this.elapsed += this.delta;
    this.frame++;
  }

  /** Forget the previous timestamp so the next frame starts with a zero delta. */
  resetDelta() {
    this._last = -1;
  }
}
