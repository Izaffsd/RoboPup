import { DEBUG } from '../config/config.js';
import { Events } from '../core/EventBus.js';
import { el } from './dom.js';

const SOFTWARE = /swiftshader|llvmpipe|software|basic render|microsoft basic/i;

/**
 * F3 performance overlay. Everything is measured live in the page:
 *
 * - FPS and frame time from requestAnimationFrame timestamps (average and
 *   worst frame of each 0.5 s window);
 * - CPU: JavaScript time per frame for game logic (physics steps + update)
 *   and for draw submission. When the GPU is the bottleneck, the browser
 *   blocks inside WebGL calls, so "draw" grows towards the GPU time — that
 *   is waiting, not JavaScript work;
 * - GPU: GPU time per frame from timer queries where the browser exposes
 *   them (otherwise "n/a");
 * - draw calls and triangles summed over every render pass of the frame
 *   (shadow map, scene, post-processing);
 * - physics: awake / total rigid bodies;
 * - the GPU / renderer string, flagged when it is a software rasteriser.
 */
export class DebugOverlay {
  /**
   * @param {object} deps
   * @param {HTMLElement} deps.root
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {import('../core/SettingsStore.js').SettingsStore} deps.settings
   * @param {string} deps.gpu Renderer string.
   */
  constructor({ root, bus, settings, gpu }) {
    this.settings = settings;
    this._rows = {};
    const row = (key, label) => {
      const value = el('dd', { text: '–' });
      this._rows[key] = value;
      return [el('dt', { text: label }), value];
    };
    const software = SOFTWARE.test(gpu);
    this.root = el('aside', { class: 'debug-overlay', 'aria-label': 'Performance overlay' }, [
      el('dl', {}, [
        ...row('fps', 'FPS'),
        ...row('frame', 'Frame'),
        ...row('cpu', 'CPU logic'),
        ...row('draw', 'CPU draw'),
        ...row('gpu', 'GPU'),
        ...row('calls', 'Draw calls'),
        ...row('tris', 'Triangles'),
        ...row('physics', 'Physics'),
        ...row('memory', 'GPU memory'),
        ...row('quality', 'Quality'),
      ]),
      el('p', {
        class: `debug-gpu${software ? ' is-software' : ''}`,
        title: gpu,
        text: software ? `Software renderer: ${gpu}` : gpu || 'Unknown GPU',
      }),
    ]);
    root.append(this.root);

    this._timer = 0;
    this._frames = 0;
    this._time = 0;
    this._worst = 0;
    this._logic = 0;
    this._physics = 0;
    this._draw = 0;
    /** Called with the new visibility (the engine toggles the GPU timer). */
    this.onToggle = null;
    this._apply();
    this._unsubs = [
      bus.on(Events.INPUT_TOGGLE_FPS, () => settings.set('showFps', !settings.get('showFps'))),
      bus.on(Events.SETTINGS_CHANGED, ({ key }) => {
        if (key === 'showFps') this._apply();
      }),
    ];
  }

  get visible() {
    return !this.root.hidden;
  }

  _apply() {
    this.root.hidden = !this.settings.get('showFps');
    this._timer = 0;
    this._frames = 0;
    this._time = 0;
    this._worst = 0;
    this._logic = 0;
    this._physics = 0;
    this._draw = 0;
    if (this.onToggle) this.onToggle(this.visible);
  }

  /** Hide temporarily (photo mode "hide UI") without changing the setting. */
  setSuppressed(suppressed) {
    this.root.classList.toggle('is-suppressed', suppressed);
  }

  /**
   * @param {number} rawDelta Unclamped frame time (s).
   * @param {object} s
   * @param {number} s.logicMs JS game logic of the last frame (physics + update).
   * @param {number} s.physicsMs Of which fixed physics steps.
   * @param {number} s.drawMs Draw submission (includes GPU back-pressure).
   * @param {() => object} s.sample Returns the slower-changing stats (called per refresh).
   */
  update(rawDelta, s) {
    if (!this.visible) return;
    this._frames++;
    this._time += rawDelta;
    this._worst = Math.max(this._worst, rawDelta);
    this._logic += s.logicMs;
    this._physics += s.physicsMs;
    this._draw += s.drawMs;
    this._timer -= rawDelta;
    if (this._timer > 0) return;
    this._timer = DEBUG.overlayInterval;
    const n = Math.max(1, this._frames);
    const fps = this._frames / Math.max(1e-3, this._time);
    const d = s.sample();
    const r = this._rows;
    r.fps.textContent = fps.toFixed(0);
    r.frame.textContent = `${((this._time / n) * 1000).toFixed(1)} ms avg · ${(this._worst * 1000).toFixed(1)} ms worst`;
    r.cpu.textContent = `${(this._logic / n).toFixed(2)} ms (physics ${(this._physics / n).toFixed(2)})`;
    r.draw.textContent = `${(this._draw / n).toFixed(2)} ms`;
    r.gpu.textContent = d.gpuMs === null ? d.gpuNote : `${d.gpuMs.toFixed(2)} ms`;
    r.calls.textContent = String(d.calls);
    r.tris.textContent =
      d.triangles >= 1e4 ? `${(d.triangles / 1000).toFixed(0)}k` : String(d.triangles);
    r.physics.textContent = `${d.bodiesAwake} awake / ${d.bodies} bodies`;
    r.memory.textContent = `${d.geometries} geo · ${d.textures} tex · ${d.programs} shaders`;
    r.quality.textContent = `${d.preset} · ${d.width}×${d.height}px${d.scale < 1 ? ` (×${d.scale.toFixed(1)})` : ''}`;
    this._frames = 0;
    this._time = 0;
    this._worst = 0;
    this._logic = 0;
    this._physics = 0;
    this._draw = 0;
  }

  dispose() {
    for (const u of this._unsubs) u();
    this.root.remove();
  }
}
