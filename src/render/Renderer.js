import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace, WebGLRenderer } from 'three';
import { RENDER } from '../config/config.js';
import { Events } from '../core/EventBus.js';

/**
 * Owns the WebGL2 renderer: colour management, ACES Filmic tone mapping,
 * shadow configuration, resolution (device pixel ratio × dynamic render
 * scale) and context-loss reporting.
 */
export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../core/EventBus.js').EventBus} bus
   */
  constructor(canvas, bus) {
    this.bus = bus;
    this.canvas = canvas;
    /** Anti-aliasing is done in post (SMAA), so the default framebuffer stays single-sampled. */
    this.three = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    const r = this.three;
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = RENDER.toneMappingExposure;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFShadowMap;
    // We reset the counters ourselves once per frame so multi-pass frames are summed.
    r.info.autoReset = false;
    // Shader validation (getProgramInfoLog) stalls the pipeline and echoes
    // driver-level notes (e.g. ANGLE/D3D constant-folding remarks on three's
    // own packing constants). Keep it for development, skip it in production.
    r.debug.checkShaderErrors = import.meta.env.DEV;

    /** Upper bound for devicePixelRatio (set by the quality preset). */
    this.pixelRatioCap = 1;
    /** Extra scale applied on top (dynamic resolution at the lowest preset). */
    this.renderScale = 1;
    this.width = 1;
    this.height = 1;

    this._onLost = (e) => {
      e.preventDefault();
      bus.emit(Events.CONTEXT_LOST);
    };
    this._onRestored = () => bus.emit(Events.CONTEXT_RESTORED);
    canvas.addEventListener('webglcontextlost', this._onLost);
    canvas.addEventListener('webglcontextrestored', this._onRestored);
  }

  /** Effective pixel ratio after cap and render scale. */
  get pixelRatio() {
    return Math.max(
      0.5,
      Math.min(window.devicePixelRatio || 1, this.pixelRatioCap) * this.renderScale,
    );
  }

  /**
   * Resize the drawing buffer to the canvas' CSS size.
   * @param {number} width CSS pixels
   * @param {number} height CSS pixels
   */
  setSize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.three.setPixelRatio(this.pixelRatio);
    this.three.setSize(this.width, this.height, false);
  }

  /** Re-apply size after a pixel-ratio change. */
  refreshPixelRatio() {
    this.setSize(this.width, this.height);
  }

  /** Reset per-frame statistics. */
  resetInfo() {
    this.three.info.reset();
  }

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this._onLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onRestored);
    this.three.dispose();
  }
}
