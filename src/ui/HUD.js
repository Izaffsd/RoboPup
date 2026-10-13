import { Events } from '../core/EventBus.js';
import { el } from './dom.js';

const HINTS = {
  keyboard: [
    ['WASD', 'move'],
    ['Shift', 'sprint'],
    ['Space', 'jump'],
    ['E', 'bark'],
    ['Q', 'emotes'],
    ['P', 'photo'],
    ['Drag', 'orbit'],
    ['Esc', 'pause'],
  ],
  gamepad: [
    ['L', 'move'],
    ['RT', 'sprint'],
    ['A', 'jump'],
    ['X', 'bark'],
    ['Y', 'emotes'],
    ['View', 'photo'],
    ['R', 'orbit'],
    ['Start', 'pause'],
  ],
  touch: [
    ['Left', 'move'],
    ['Right', 'orbit'],
    ['⤒', 'jump'],
    ['🐾', 'bark'],
    ['☺', 'emotes'],
  ],
};

/**
 * Minimal HUD: control hints that fade after a few seconds, a zone name
 * banner and short toasts. (The F3 performance overlay is DebugOverlay.)
 */
export class HUD {
  /**
   * @param {object} deps
   * @param {HTMLElement} deps.root
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   */
  constructor({ root, bus }) {
    this.bus = bus;
    this.device = 'keyboard';
    /** 'hidden' | 'play' | 'photo' */
    this.mode = 'hidden';
    this.hints = el('div', { class: 'hud-hints', 'aria-hidden': 'true' });
    this.zone = el('div', { class: 'hud-zone', role: 'status' });
    this.toast = el('div', { class: 'hud-toast', role: 'status' });
    this.root = el('div', { class: 'hud', hidden: true }, [this.hints, this.zone, this.toast]);
    root.append(this.root);

    this._hintTimer = 0;
    this._zoneTimer = 0;
    this._toastTimer = 0;
    this._renderHints();

    this._unsubs = [
      bus.on(Events.INPUT_DEVICE_CHANGED, ({ device }) => {
        if (device === this.device) return;
        this.device = device;
        this._renderHints();
        if (this.mode === 'play') this.showHints(4);
      }),
      bus.on(Events.PLAYER_ZONE, ({ name }) => {
        if (this.mode !== 'play') return;
        this.zone.textContent = name;
        this.zone.classList.add('is-visible');
        this._zoneTimer = 2.4;
      }),
      bus.on(Events.INPUT_GAMEPAD, ({ connected }) =>
        this.showToast(connected ? 'Gamepad connected' : 'Gamepad disconnected'),
      ),
      bus.on(Events.UI_TOAST, ({ message, seconds }) => this.showToast(message, seconds)),
      bus.on(Events.CONTEXT_LOST, () => this.showToast('Graphics context lost — restoring…', 30)),
      bus.on(Events.CONTEXT_RESTORED, () => this.showToast('Graphics restored')),
    ];
  }

  /** @param {'hidden'|'play'|'photo'} mode */
  setMode(mode) {
    this.mode = mode;
    this.root.hidden = mode === 'hidden';
    this.root.classList.toggle('is-playing', mode === 'play');
    if (mode !== 'play') {
      this.hints.classList.remove('is-visible');
      this.zone.classList.remove('is-visible');
      this._hintTimer = 0;
      this._zoneTimer = 0;
    }
  }

  /** Show the control hints, fading after `seconds`. */
  showHints(seconds = 6) {
    this.hints.classList.add('is-visible');
    this._hintTimer = seconds;
  }

  /** @param {string} message @param {number} [seconds] */
  showToast(message, seconds = 2.5) {
    this.toast.textContent = message;
    this.toast.classList.add('is-visible');
    this._toastTimer = seconds;
  }

  _renderHints() {
    const list = HINTS[this.device] || HINTS.keyboard;
    this.hints.replaceChildren(
      ...list.map(([k, label]) =>
        el('span', { class: 'hint' }, [el('kbd', { text: k }), el('span', { text: label })]),
      ),
    );
  }

  /** @param {number} rawDelta Unclamped frame time. */
  update(rawDelta) {
    if (this._hintTimer > 0) {
      this._hintTimer -= rawDelta;
      if (this._hintTimer <= 0) this.hints.classList.remove('is-visible');
    }
    if (this._zoneTimer > 0) {
      this._zoneTimer -= rawDelta;
      if (this._zoneTimer <= 0) this.zone.classList.remove('is-visible');
    }
    if (this._toastTimer > 0) {
      this._toastTimer -= rawDelta;
      if (this._toastTimer <= 0) this.toast.classList.remove('is-visible');
    }
  }

  dispose() {
    for (const u of this._unsubs) u();
    this.root.remove();
  }
}
