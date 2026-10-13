/**
 * Measures GPU time per frame with EXT_disjoint_timer_query_webgl2 where the
 * browser exposes it (Chromium on most desktop GPUs; Firefox and Safari hide
 * it). Results arrive a few frames late and are averaged; frames where the
 * GPU reported a disjoint (clock change, context switch) are discarded.
 */
export class GpuTimer {
  /** @param {WebGL2RenderingContext} gl */
  constructor(gl) {
    this.gl = gl;
    this.ext = null;
    this.enabled = false;
    this._probed = false;
    /** @type {WebGLQuery[]} */
    this._pending = [];
    /** @type {WebGLQuery[]} */
    this._free = [];
    this._active = null;
    this._sum = 0;
    this._count = 0;
    /** Average GPU milliseconds over the last read() window, or null. */
    this.ms = null;
  }

  /** True when timer queries are available (probed lazily on first enable). */
  get supported() {
    return this.ext !== null;
  }

  /** @param {boolean} on */
  setEnabled(on) {
    if (on && !this._probed) {
      this._probed = true;
      // Firefox only offers this extension behind a privileged pref and
      // logs a warning when asked for it; skip the request there.
      if (!/firefox/i.test(navigator.userAgent)) {
        this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
      }
    }
    this.enabled = on && this.ext !== null;
  }

  begin() {
    if (!this.enabled || this._active) return;
    const gl = this.gl;
    const q = this._free.pop() || gl.createQuery();
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this._active = q;
  }

  end() {
    if (!this._active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this._pending.push(this._active);
    this._active = null;
    this._collect();
  }

  _collect() {
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this._pending.length) {
      const q = this._pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this._pending.shift();
      if (!disjoint) {
        this._sum += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        this._count++;
      }
      this._free.push(q);
    }
    // Never let a stalled driver grow the queue unbounded.
    if (this._pending.length > 8) this._free.push(...this._pending.splice(0, 4));
  }

  /** Close the averaging window and return the mean GPU time (ms) or null. */
  read() {
    if (this._count > 0) this.ms = this._sum / this._count;
    else if (!this.enabled) this.ms = null;
    this._sum = 0;
    this._count = 0;
    return this.ms;
  }

  dispose() {
    const gl = this.gl;
    for (const q of [...this._pending, ...this._free]) gl.deleteQuery(q);
    this._pending.length = 0;
    this._free.length = 0;
  }
}
