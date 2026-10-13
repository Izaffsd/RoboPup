import { PHYSICS } from '../config/config.js';

/**
 * Game loop with a fixed-timestep simulation decoupled from rendering
 * ("Fix Your Timestep"). Physics runs at exactly 60 Hz regardless of the
 * display refresh rate; rendering interpolates between the last two states
 * using {@link Time#alpha}.
 */
export class Loop {
  /**
   * @param {object} options
   * @param {import('./Time.js').Time} options.time
   * @param {(dt: number) => void} options.fixedUpdate Called 0..N times per frame.
   * @param {(time: import('./Time.js').Time) => void} options.update Called once per frame.
   * @param {(time: import('./Time.js').Time) => void} options.render Called once per frame.
   */
  constructor({ time, fixedUpdate, update, render }) {
    this.time = time;
    this.fixedUpdate = fixedUpdate;
    this.update = update;
    this.render = render;
    /** When false the fixed simulation is frozen (pause / menus) but rendering continues. */
    this.simulate = false;
    /**
     * JS time of the last frame (ms), split into fixed physics steps, the
     * per-frame update and draw submission. Draw submission also includes
     * time the browser blocks in WebGL calls while the GPU catches up.
     */
    this.cpuMs = 0;
    this.physicsMs = 0;
    this.updateMs = 0;
    this.renderMs = 0;
    this._accumulator = 0;
    this._renderer = null;
    this._frame = this._frame.bind(this);
  }

  /**
   * Start driving frames through the renderer's animation loop (which
   * transparently handles WebXR/visibility and uses requestAnimationFrame).
   * @param {import('three').WebGLRenderer} renderer
   */
  start(renderer) {
    this._renderer = renderer;
    this.time.resetDelta();
    renderer.setAnimationLoop(this._frame);
  }

  /** Stop the loop. */
  stop() {
    if (this._renderer) this._renderer.setAnimationLoop(null);
  }

  /** Drop accumulated simulation time (e.g. after resuming from pause). */
  resetAccumulator() {
    this._accumulator = 0;
    this.time.alpha = 1;
  }

  /** @param {number} timestamp */
  _frame(timestamp) {
    const t0 = performance.now();
    const time = this.time;
    time.tick(timestamp);

    if (this.simulate) {
      const step = PHYSICS.fixedTimeStep;
      this._accumulator += time.delta;
      let steps = 0;
      while (this._accumulator >= step && steps < PHYSICS.maxStepsPerFrame) {
        this.fixedUpdate(step);
        this._accumulator -= step;
        steps++;
      }
      // If we hit the cap, discard the backlog instead of spiralling.
      if (steps === PHYSICS.maxStepsPerFrame && this._accumulator > step) {
        this._accumulator = step * 0.5;
      }
      time.alpha = this._accumulator / step;
    } else {
      time.alpha = 1;
    }
    const t1 = performance.now();
    this.update(time);
    const t2 = performance.now();
    this.render(time);
    const t3 = performance.now();
    this.physicsMs = t1 - t0;
    this.updateMs = t2 - t1;
    this.renderMs = t3 - t2;
    this.cpuMs = t3 - t0;
  }
}
