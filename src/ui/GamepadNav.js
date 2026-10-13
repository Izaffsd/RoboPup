import { Events } from '../core/EventBus.js';

const FOCUSABLE = 'button, select, input, [tabindex]:not([tabindex="-1"])';

/**
 * Gamepad navigation for DOM menus and panels.
 *
 * Input emits INPUT_UI_NAV (D-pad / left stick with auto-repeat) and
 * INPUT_UI_ACCEPT (A). This moves focus spatially between the visible
 * controls of the active panel, adjusts the focused slider, select or
 * option group with left/right, and activates the focused control with A.
 * Panels register a function that returns their root element while they
 * are open; the first registered root that is open wins.
 */
export class GamepadNav {
  /** @param {{bus: import('../core/EventBus.js').EventBus}} deps */
  constructor({ bus }) {
    this.bus = bus;
    /** @type {(() => HTMLElement|null)[]} */
    this._roots = [];
    this._unsubs = [
      bus.on(Events.INPUT_UI_NAV, (dir) => this.move(dir)),
      bus.on(Events.INPUT_UI_ACCEPT, () => this.accept()),
      bus.on(Events.INPUT_DEVICE_CHANGED, ({ device }) => {
        document.body.classList.toggle('gamepad-nav', device === 'gamepad');
      }),
    ];
  }

  /**
   * @param {() => HTMLElement|null} getRoot Returns the panel root while it is open.
   * @returns {() => void} Unregister.
   */
  addRoot(getRoot) {
    this._roots.push(getRoot);
    return () => {
      this._roots = this._roots.filter((r) => r !== getRoot);
    };
  }

  /** @returns {HTMLElement|null} */
  activeRoot() {
    for (const getRoot of this._roots) {
      const root = getRoot();
      if (root && !root.hidden) return root;
    }
    return null;
  }

  /** @param {HTMLElement} root */
  _items(root) {
    return /** @type {HTMLElement[]} */ ([...root.querySelectorAll(FOCUSABLE)]).filter(
      (el) => !el.disabled && el.offsetParent !== null && el.getClientRects().length > 0,
    );
  }

  /** @param {'up'|'down'|'left'|'right'} dir */
  move(dir) {
    const root = this.activeRoot();
    if (!root) return;
    const items = this._items(root);
    if (items.length === 0) return;
    const current = /** @type {HTMLElement} */ (document.activeElement);
    if (!items.includes(current)) {
      this._focus(items[0]);
      return;
    }
    if ((dir === 'left' || dir === 'right') && this._adjust(current, dir === 'right' ? 1 : -1)) {
      return;
    }
    const next = this._nearest(current, items, dir);
    if (next) this._focus(next);
  }

  accept() {
    const root = this.activeRoot();
    if (!root) return;
    const current = /** @type {HTMLElement} */ (document.activeElement);
    if (!root.contains(current) || current === root) {
      const items = this._items(root);
      if (items[0]) this._focus(items[0]);
      return;
    }
    if (current instanceof HTMLSelectElement) {
      this._adjust(current, 1);
      return;
    }
    if (current instanceof HTMLInputElement && current.type === 'range') return;
    current.click();
  }

  _focus(el) {
    el.focus({ preventScroll: false });
    el.scrollIntoView({ block: 'nearest' });
    this.bus.emit(Events.UI_SOUND, 'hover');
  }

  /**
   * Left/right on a slider, select or option group changes its value.
   * @returns {boolean} true when the control consumed the input.
   */
  _adjust(el, sign) {
    if (el instanceof HTMLInputElement && el.type === 'range') {
      const step = Number(el.step) || 1;
      const min = Number(el.min);
      const max = Number(el.max);
      const span = (max - min) / step;
      // Big ranges move ~5% per press so they stay quick to adjust.
      const k = span > 40 ? Math.round(span / 20) : 1;
      const next = Math.min(max, Math.max(min, Number(el.value) + sign * step * k));
      if (next === Number(el.value)) return true;
      el.value = String(next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (el instanceof HTMLSelectElement) {
      const n = el.options.length;
      el.selectedIndex = (el.selectedIndex + sign + n) % n;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      this.bus.emit(Events.UI_SOUND, 'click');
      return true;
    }
    const group = el.closest('[data-nav-group]');
    if (group) {
      const options = this._items(/** @type {HTMLElement} */ (group));
      const i = options.indexOf(el);
      const next = options[i + sign];
      if (next) {
        this._focus(next);
        next.click();
      }
      return true;
    }
    return false;
  }

  /** Spatially nearest control in a direction (favouring alignment). */
  _nearest(current, items, dir) {
    const a = current.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === current) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2;
      const by = b.top + b.height / 2;
      const dx = bx - ax;
      const dy = by - ay;
      let along;
      let across;
      if (dir === 'up') [along, across] = [-dy, dx];
      else if (dir === 'down') [along, across] = [dy, dx];
      else if (dir === 'left') [along, across] = [-dx, dy];
      else [along, across] = [dx, dy];
      if (along <= 4) continue;
      const score = along + Math.abs(across) * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best || dir === 'left' || dir === 'right') return best;
    // Wrap around vertically.
    const i = items.indexOf(current);
    return dir === 'down'
      ? items[(i + 1) % items.length]
      : items[(i - 1 + items.length) % items.length];
  }

  dispose() {
    for (const u of this._unsubs) u();
  }
}
