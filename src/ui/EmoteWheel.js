import { EMOTES } from '../config/config.js';
import { Events } from '../core/EventBus.js';
import { el } from './dom.js';

const RADIUS = 118;

/**
 * Radial emote menu.
 *
 * - Keyboard/mouse: hold Q, move the mouse towards an emote, release Q to
 *   perform it. A quick tap of Q leaves the wheel open so an emote can be
 *   clicked; number keys 1–7 pick directly.
 * - Gamepad: hold Y, point either stick, release Y (or press A in the open
 *   wheel); B closes.
 * - Touch: the emote button opens the wheel; tap an emote (or outside to close).
 *
 * The wheel only emits EMOTE_REQUEST; EmoteSystem decides what happens.
 */
export class EmoteWheel {
  /**
   * @param {object} deps
   * @param {HTMLElement} deps.root
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   */
  constructor({ root, bus }) {
    this.bus = bus;
    this.isOpen = false;
    this.selected = -1;
    this._holding = false;
    this._openTime = 0;
    this._vx = 0;
    this._vy = 0;
    this._device = 'keyboard';
    this._payload = { open: false };

    const step = (Math.PI * 2) / EMOTES.list.length;
    this.slots = EMOTES.list.map((emote, i) => {
      const a = -Math.PI / 2 + i * step;
      const slot = el(
        'button',
        {
          class: 'wheel-slot',
          type: 'button',
          'data-emote': emote.id,
          style: `--x: ${(Math.cos(a) * RADIUS).toFixed(1)}px; --y: ${(Math.sin(a) * RADIUS).toFixed(1)}px`,
          onpointerenter: (e) => {
            if (e.pointerType === 'mouse') this._select(i);
          },
          onclick: () => this._perform(i),
        },
        [el('kbd', { text: String(i + 1) }), el('span', { text: emote.label })],
      );
      return slot;
    });
    this.pointer = el('div', { class: 'wheel-pointer' });
    this.label = el('strong', { text: 'Emotes' });
    this.hint = el('small');
    this.disc = el('div', { class: 'wheel-disc' }, [
      this.pointer,
      el('div', { class: 'wheel-center' }, [this.label, this.hint]),
      ...this.slots,
    ]);
    this.root = el(
      'div',
      {
        class: 'emote-wheel',
        hidden: true,
        role: 'dialog',
        'aria-label': 'Emotes',
        onpointerdown: (e) => {
          // Tapping outside the disc closes a sticky wheel.
          if (!this.disc.contains(/** @type {Node} */ (e.target))) this.close();
        },
      },
      [this.disc],
    );
    root.append(this.root);
    this._unsub = bus.on(Events.INPUT_DEVICE_CHANGED, ({ device }) => {
      this._device = device;
      if (this.isOpen) this._renderHint();
    });
  }

  /**
   * @param {boolean} holding Opened by holding a key/button (release performs).
   */
  open(holding) {
    if (this.isOpen) return;
    this.isOpen = true;
    this._holding = holding;
    this._openTime = performance.now();
    this._vx = 0;
    this._vy = 0;
    this._select(-1);
    this.root.hidden = false;
    this._renderHint();
    this.bus.emit(Events.UI_SOUND, 'hover');
    this._payload.open = true;
    this.bus.emit(Events.EMOTE_WHEEL, this._payload);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.hidden = true;
    this._payload.open = false;
    this.bus.emit(Events.EMOTE_WHEEL, this._payload);
  }

  _renderHint() {
    const d = this._device;
    if (d === 'touch') this.hint.textContent = 'Tap an emote';
    else if (d === 'gamepad')
      this.hint.textContent = this._holding ? 'Point & release Y' : 'Point & press A';
    else this.hint.textContent = this._holding ? 'Point & release Q' : 'Click or press 1–7';
  }

  _select(i) {
    if (i === this.selected) return;
    this.selected = i;
    this.slots.forEach((s, k) => s.classList.toggle('is-selected', k === i));
    this.label.textContent = i >= 0 ? EMOTES.list[i].label : 'Emotes';
    this.pointer.hidden = i < 0;
    if (i >= 0) {
      const deg = -90 + (i * 360) / EMOTES.list.length;
      this.pointer.style.transform = `rotate(${deg}deg)`;
      this.bus.emit(Events.UI_SOUND, 'hover');
    }
  }

  _perform(i) {
    const emote = EMOTES.list[i];
    if (!emote) return;
    this.close();
    this.bus.emit(Events.UI_SOUND, 'click');
    this.bus.emit(Events.EMOTE_REQUEST, emote.id);
  }

  /** Slot index for a direction (screen space, +y down). */
  _sector(x, y) {
    const n = EMOTES.list.length;
    const a = Math.atan2(y, x) + Math.PI / 2;
    return ((Math.round(a / ((Math.PI * 2) / n)) % n) + n) % n;
  }

  /**
   * Per-frame input handling while playing.
   * @param {import('../core/Input.js').Input['state']} input
   */
  update(input) {
    if (input.emoteDigit) {
      this._perform(input.emoteDigit - 1);
      return;
    }
    if (!this.isOpen) {
      if (input.emotePressed) this.open(true);
      else if (input.emoteToggle) this.open(false);
      return;
    }
    if (input.emoteToggle || (input.emotePressed && !this._holding) || input.padBack) {
      this.close();
      return;
    }

    // Mouse: a virtual cursor from raw movement (works with or without pointer lock).
    this._vx += input.pointerDX;
    this._vy += input.pointerDY;
    const len = Math.hypot(this._vx, this._vy);
    if (len > 90) {
      this._vx *= 90 / len;
      this._vy *= 90 / len;
    }
    if (len > EMOTES.wheelMouseThreshold) this._select(this._sector(this._vx, this._vy));
    // Sticks.
    const rs = Math.hypot(input.stickRX, input.stickRY);
    const ls = Math.hypot(input.stickLX, input.stickLY);
    if (Math.max(rs, ls) > EMOTES.wheelStickThreshold) {
      if (rs >= ls) this._select(this._sector(input.stickRX, input.stickRY));
      else this._select(this._sector(input.stickLX, input.stickLY));
    }

    if (input.padAccept && this.selected >= 0) {
      this._perform(this.selected);
      return;
    }
    if (input.emoteReleased && this._holding) {
      if (this.selected >= 0) this._perform(this.selected);
      else if ((performance.now() - this._openTime) / 1000 < EMOTES.wheelTapTime) {
        this._holding = false;
        this._renderHint();
      } else this.close();
    }
  }

  dispose() {
    this._unsub();
    this.root.remove();
  }
}
