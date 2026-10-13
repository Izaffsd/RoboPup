import { INPUT } from '../config/config.js';
import { Events } from '../core/EventBus.js';
import { cameraIcon, el, pawIcon, smileIcon } from './dom.js';

/** Pointer capture is a convenience; a pointer that already ended must not throw. */
function capture(element, pointerId) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // The pointer is no longer active (released before the handler ran).
  }
}

/** @returns {boolean} */
export function isTouchDevice() {
  return 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
}

/**
 * Mobile controls: a floating virtual joystick on the left half of the
 * screen (push to the edge to sprint), drag-to-orbit on the right half, and
 * Jump / Bark / Emote / Photo / Pause buttons. Multi-touch is tracked per
 * pointer id. In photo mode the joystick flies the camera, Jump and Bark
 * become hold-to-rise / hold-to-sink (moved beside the photo panel), and
 * the panel's close button replaces Pause.
 */
export class TouchControls {
  /**
   * @param {object} deps
   * @param {HTMLElement} deps.root
   * @param {import('../core/Input.js').Input} deps.input
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   */
  constructor({ root, input, bus }) {
    this.input = input;
    this.bus = bus;
    this.enabled = isTouchDevice();
    this._stickId = -1;
    this._lookId = -1;
    this._origin = { x: 0, y: 0 };
    this._last = { x: 0, y: 0 };
    this.mode = 'play';

    this.knob = el('div', { class: 'stick-knob' });
    this.base = el('div', { class: 'stick-base' }, [this.knob]);
    this.jump = el('button', {
      class: 'touch-btn touch-jump',
      type: 'button',
      'aria-label': 'Jump',
      text: '⤒',
    });
    this.bark = el(
      'button',
      { class: 'touch-btn touch-bark', type: 'button', 'aria-label': 'Bark' },
      [pawIcon('touch-paw')],
    );
    this.pause = el('button', {
      class: 'touch-btn touch-pause',
      type: 'button',
      'aria-label': 'Pause',
      text: 'II',
    });
    this.emote = el(
      'button',
      { class: 'touch-btn touch-emote', type: 'button', 'aria-label': 'Emotes' },
      [smileIcon('touch-icon')],
    );
    this.photo = el(
      'button',
      { class: 'touch-btn touch-photo', type: 'button', 'aria-label': 'Photo mode' },
      [cameraIcon('touch-icon')],
    );
    this.surface = el('div', { class: 'touch-surface' });
    this.root = el('div', { class: 'touch-layer', hidden: true }, [
      this.surface,
      this.base,
      this.jump,
      this.bark,
      this.emote,
      this.photo,
      this.pause,
    ]);
    root.append(this.root);

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this.surface.addEventListener('pointerdown', this._onDown);
    this.surface.addEventListener('pointermove', this._onMove);
    this.surface.addEventListener('pointerup', this._onUp);
    this.surface.addEventListener('pointercancel', this._onUp);

    const hold = (btn, down, up) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        capture(btn, e.pointerId);
        btn.classList.add('is-down');
        down();
      });
      const release = () => {
        btn.classList.remove('is-down');
        if (up) up();
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
    };
    hold(
      this.jump,
      () => (this.mode === 'photo' ? input.setTouchVertical(1) : input.setTouchJump(true)),
      () => (this.mode === 'photo' ? input.setTouchVertical(0) : input.setTouchJump(false)),
    );
    hold(
      this.bark,
      () => (this.mode === 'photo' ? input.setTouchVertical(-1) : input.touchBark()),
      () => {
        if (this.mode === 'photo') input.setTouchVertical(0);
      },
    );
    hold(this.emote, () => input.touchEmote());
    hold(this.photo, () => input.touchPhoto());
    this.pause.addEventListener('click', () => bus.emit(Events.INPUT_PAUSE_TOGGLE, 'touch'));
  }

  /** @param {boolean} visible */
  setVisible(visible) {
    this.root.hidden = !(visible && this.enabled);
    if (this.root.hidden) this._reset();
  }

  /**
   * Switch between gameplay and photo-mode layouts.
   * @param {'play'|'photo'} mode
   */
  setMode(mode) {
    if (mode === this.mode) return;
    this._reset();
    this.mode = mode;
    const photo = mode === 'photo';
    this.root.classList.toggle('is-photo', photo);
    this.jump.textContent = photo ? '▲' : '⤒';
    this.jump.setAttribute('aria-label', photo ? 'Rise' : 'Jump');
    this.bark.replaceChildren(photo ? '▼' : pawIcon('touch-paw'));
    this.bark.setAttribute('aria-label', photo ? 'Sink' : 'Bark');
    // The photo panel has its own close button (and covers this corner).
    this.pause.hidden = photo;
    this.emote.hidden = photo;
    this.photo.hidden = photo;
  }

  _reset() {
    this._stickId = -1;
    this._lookId = -1;
    this.base.classList.remove('is-active');
    this.input.clearTouchMove();
    this.input.setTouchJump(false);
    this.input.setTouchVertical(0);
  }

  _onDown(e) {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    capture(this.surface, e.pointerId);
    const leftHalf = e.clientX < window.innerWidth * 0.45;
    if (leftHalf && this._stickId < 0) {
      this._stickId = e.pointerId;
      this._origin.x = e.clientX;
      this._origin.y = e.clientY;
      this.base.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.knob.style.transform = 'translate(-50%, -50%)';
      this.base.classList.add('is-active');
    } else if (this._lookId < 0) {
      this._lookId = e.pointerId;
      this._last.x = e.clientX;
      this._last.y = e.clientY;
    }
  }

  _onMove(e) {
    if (e.pointerId === this._stickId) {
      const R = INPUT.touchJoystickRadius;
      let dx = e.clientX - this._origin.x;
      let dy = e.clientY - this._origin.y;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const mag = Math.min(1, len / R);
      this.input.setTouchMove(dx / R, -dy / R, mag >= INPUT.touchSprintThreshold);
    } else if (e.pointerId === this._lookId) {
      this.input.addTouchLook(e.clientX - this._last.x, e.clientY - this._last.y);
      this._last.x = e.clientX;
      this._last.y = e.clientY;
    }
  }

  _onUp(e) {
    if (e.pointerId === this._stickId) {
      this._stickId = -1;
      this.base.classList.remove('is-active');
      this.input.clearTouchMove();
    } else if (e.pointerId === this._lookId) {
      this._lookId = -1;
    }
  }

  dispose() {
    this.root.remove();
  }
}
