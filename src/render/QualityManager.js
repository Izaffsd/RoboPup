import { QUALITY_AUTO, QUALITY_ORDER, QUALITY_PRESETS } from '../config/config.js';
import { Events } from '../core/EventBus.js';

/** @returns {boolean} */
export function isMobileDevice() {
  const uaData = /** @type {any} */ (navigator).userAgentData;
  if (uaData && typeof uaData.mobile === 'boolean' && uaData.mobile) return true;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return Boolean(coarse && Math.min(window.screen.width, window.screen.height) < 900);
}

/**
 * Best-effort GPU name. Firefox deprecates WEBGL_debug_renderer_info (and
 * warns when it is requested) but returns a sanitised name from RENDERER,
 * so it is only queried on other browsers.
 * @param {WebGL2RenderingContext} gl
 */
export function readGPU(gl) {
  let name = '';
  try {
    if (!/firefox/i.test(navigator.userAgent)) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) name = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '';
    }
    if (!name) name = gl.getParameter(gl.RENDERER) || '';
  } catch {
    name = '';
  }
  return String(name);
}

/**
 * Heuristic starting tier: software rasteriser / mobile / small GPUs → Low,
 * integrated → Medium, discrete → High.
 * @param {WebGL2RenderingContext} gl
 * @param {string} [gpu] GPU name (read from `gl` when omitted).
 * @returns {'low'|'medium'|'high'}
 */
export function detectPresetKey(gl, gpu = readGPU(gl)) {
  const g = gpu.toLowerCase();
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(g)) return 'low';
  if (isMobileDevice()) return 'low';
  if (maxTex < 8192) return 'low';
  if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|arc\(tm\) a|arc a\d/.test(g))
    return 'high';
  if (/apple m\d (pro|max|ultra)/.test(g)) return 'high';
  return 'medium';
}

/**
 * Picks and applies graphics presets.
 *
 * Auto mode: an initial tier is chosen from GPU heuristics (software
 * rasteriser / mobile → Low, integrated → Medium, discrete → High). The
 * measured frame rate is then monitored; if it stays below target the preset
 * steps down, and at Low the render scale shrinks (dynamic resolution).
 * Manual selections disable the monitor.
 */
export class QualityManager {
  /**
   * @param {object} deps
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {import('./Renderer.js').Renderer} deps.renderer
   * @param {import('../core/SettingsStore.js').SettingsStore} deps.settings
   */
  constructor({ bus, renderer, settings }) {
    this.bus = bus;
    this.renderer = renderer;
    this.settings = settings;
    this.mobile = isMobileDevice();
    this.gpu = readGPU(renderer.three.getContext());
    this.detectedKey = detectPresetKey(renderer.three.getContext(), this.gpu);
    /** Currently applied preset key. */
    this.current = '';
    this.auto = true;
    this._frames = 0;
    this._time = 0;
    this._warm = QUALITY_AUTO.warmup;
    this._payload = { key: '', preset: null, auto: true, gpu: this.gpu };
    this._unsub = bus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
      if (key === 'quality') this.setMode(value);
    });
  }

  /** Apply the stored setting (call once after construction). */
  start() {
    this.setMode(this.settings.get('quality'));
  }

  /**
   * @param {string} mode 'auto' or a preset key.
   */
  setMode(mode) {
    this.auto = mode === 'auto';
    this.renderer.renderScale = 1;
    this.apply(this.auto ? this.detectedKey : mode, true);
  }

  /**
   * Apply a preset and notify listeners.
   * @param {string} key
   * @param {boolean} [force]
   */
  apply(key, force = false) {
    if (!QUALITY_PRESETS[key]) return;
    if (!force && key === this.current) return;
    this.current = key;
    const preset = QUALITY_PRESETS[key];
    this.renderer.pixelRatioCap = preset.pixelRatioCap;
    this.renderer.refreshPixelRatio();
    this._payload.key = key;
    this._payload.preset = preset;
    this._payload.auto = this.auto;
    this.bus.emit(Events.QUALITY_APPLIED, this._payload);
    this._resetMonitor();
  }

  /**
   * Feed the frame-rate monitor.
   * @param {number} rawDelta Unclamped frame time in seconds.
   */
  update(rawDelta) {
    if (!this.auto || rawDelta <= 0 || rawDelta > 0.5) return;
    if (this._warm > 0) {
      this._warm -= rawDelta;
      return;
    }
    this._frames++;
    this._time += rawDelta;
    if (this._time < QUALITY_AUTO.window) return;
    const fps = this._frames / this._time;
    this._frames = 0;
    this._time = 0;
    const target = this.mobile ? QUALITY_AUTO.targetFpsMobile : QUALITY_AUTO.targetFpsDesktop;
    if (fps >= target) return;
    const idx = QUALITY_ORDER.indexOf(this.current);
    if (idx > 0) {
      this.apply(QUALITY_ORDER[idx - 1]);
    } else if (this.renderer.renderScale > QUALITY_AUTO.minRenderScale + 1e-3) {
      this.renderer.renderScale = Math.max(
        QUALITY_AUTO.minRenderScale,
        this.renderer.renderScale - 0.1,
      );
      this.apply(this.current, true);
    }
  }

  _resetMonitor() {
    this._frames = 0;
    this._time = 0;
    this._warm = QUALITY_AUTO.warmup;
  }

  dispose() {
    this._unsub();
  }
}
