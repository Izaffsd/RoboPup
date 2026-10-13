import { Events } from '../core/EventBus.js';

const TIPS = [
  'Tip: hold SHIFT (or RT) to gallop.',
  'Tip: press E to bark — nearby toys get a little nudge!',
  'Tip: drag with the mouse to orbit the camera, scroll to zoom.',
  'Tip: the Sunny Nook is the warmest spot in the shelter.',
  'Tip: try the ramps, stairs and tunnels in the Play Zone.',
  'Tip: press F3 for performance stats.',
];

/**
 * Branded loading screen. The markup lives in index.html so it paints before
 * any JavaScript runs. It is shown twice: while game files download (byte
 * progress) and while the engine boots after Play (THREE.LoadingManager
 * progress via {@link Events.LOAD_PROGRESS}). Never driven by a timer.
 */
export class LoadingScreen {
  /** @param {import('../core/EventBus.js').EventBus} bus */
  constructor(bus) {
    this.root = document.getElementById('loading');
    this.bar = this.root.querySelector('.progress-bar');
    this.track = this.root.querySelector('.progress');
    this.label = this.root.querySelector('.loading-label');
    this.percent = this.root.querySelector('.loading-percent');
    this.tip = this.root.querySelector('.loading-tip');
    this._lastLabel = '';
    this._hideTimer = 0;
    this._nextTip();
    bus.on(Events.LOAD_PROGRESS, ({ progress, label }) => this.setProgress(progress, label));
    bus.on(Events.LOAD_FAILED, ({ url }) =>
      this.showError(`Could not load ${url}. Check your connection and reload.`),
    );
  }

  _nextTip() {
    this.tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  }

  /**
   * @param {number} value 0..1
   * @param {string} label
   */
  setProgress(value, label) {
    const pct = Math.round(value * 100);
    this.bar.style.transform = `scaleX(${value.toFixed(4)})`;
    this.percent.textContent = `${pct}%`;
    this.track.setAttribute('aria-valuenow', String(pct));
    if (label && label !== this._lastLabel) {
      this._lastLabel = label;
      this.label.textContent = `${label}…`;
    }
  }

  /**
   * Show again (from 0%) with a new label.
   * @param {string} label
   */
  show(label) {
    window.clearTimeout(this._hideTimer);
    this.root.style.display = '';
    this.root.removeAttribute('aria-hidden');
    this.root.classList.remove('is-error');
    this.bar.style.transition = 'none';
    this.setProgress(0, label);
    // Force a style flush so the bar restarts from zero without animating back.
    void this.bar.offsetWidth;
    this.bar.style.transition = '';
    this._nextTip();
    this.root.classList.remove('is-hidden');
  }

  /** @param {string} message */
  showError(message) {
    this.root.classList.add('is-error');
    this.label.textContent = message;
  }

  /** Fade out and remove from the accessibility tree. */
  hide() {
    this.root.classList.add('is-hidden');
    this.root.setAttribute('aria-hidden', 'true');
    window.clearTimeout(this._hideTimer);
    this._hideTimer = window.setTimeout(() => {
      this.root.style.display = 'none';
    }, 650);
  }

  /** Remove instantly (fatal error screens). */
  hideImmediately() {
    window.clearTimeout(this._hideTimer);
    this.root.classList.add('is-hidden');
    this.root.style.display = 'none';
  }
}
