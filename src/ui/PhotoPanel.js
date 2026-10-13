import { PHOTO } from '../config/config.js';
import { Events } from '../core/EventBus.js';
import { el } from './dom.js';

const EXPRESSION_OPTIONS = [
  ['auto', 'Auto'],
  ['neutral', 'Neutral'],
  ['happy', 'Happy'],
  ['curious', 'Curious'],
  ['sleepy', 'Sleepy'],
  ['excited', 'Excited'],
  ['lowBattery', 'Low battery'],
];

const HINTS = {
  keyboard:
    'WASD fly · E/Q up/down · Shift fast · drag to look · wheel FOV · F focus · C capture · H hide UI · Esc exit',
  gamepad:
    'L-stick fly · R-stick look · RT/LT up/down · RB/LB FOV · D-pad + A panel · X capture · Y hide UI · B exit',
  touch: 'Left: fly · Right: look · ▲/▼ up/down · tap the screen to bring the UI back',
};

/** Focus slider position (0..1000) ↔ distance (log scale). */
const focusToSlider = (d) =>
  Math.round((Math.log(d / PHOTO.focusMin) / Math.log(PHOTO.focusMax / PHOTO.focusMin)) * 1000);
const sliderToFocus = (v) => PHOTO.focusMin * (PHOTO.focusMax / PHOTO.focusMin) ** (v / 1000);

/**
 * Photo mode side panel: camera (FOV, roll), depth of field (on/off, focus
 * distance, aperture, focus on the pup), look (exposure, filter, strength),
 * pup (show/hide, expression), watermark, and Capture / Hide UI / Exit.
 * Works with mouse, touch, keyboard (Tab) and gamepad (D-pad + A).
 */
export class PhotoPanel {
  /**
   * @param {object} deps
   * @param {HTMLElement} deps.root
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {object} deps.params Photo parameters (mutated by the controls).
   * @param {(key: string) => void} deps.onChange
   * @param {{capture: () => void, hideUi: () => void, exit: () => void, focusPup: () => void}} deps.actions
   */
  constructor({ root, bus, params, onChange, actions }) {
    this.params = params;
    this.bus = bus;
    this._sync = [];

    const set = (key, value) => {
      params[key] = value;
      onChange(key);
    };
    const row = (id, label, control, out) =>
      el('div', { class: 'setting-row' }, [
        el('label', { for: id, text: label }),
        el('div', { class: 'setting-control' }, [control, out || null]),
      ]);
    const range = (
      key,
      label,
      min,
      max,
      step,
      format,
      toSlider = (v) => v,
      fromSlider = (v) => v,
    ) => {
      const id = `photo-${key}`;
      const input = el('input', { id, type: 'range', min, max, step });
      const out = el('output', { for: id, class: 'setting-value' });
      const sync = () => {
        const v = toSlider(params[key]);
        input.value = String(v);
        out.textContent = format(params[key]);
        input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
      };
      input.addEventListener('input', () => {
        set(key, fromSlider(Number(input.value)));
        sync();
      });
      this._sync.push(sync);
      sync();
      return row(id, label, input, out);
    };
    const toggle = (key, label) => {
      const id = `photo-${key}`;
      const input = el('input', { id, type: 'checkbox', class: 'toggle', role: 'switch' });
      const sync = () => {
        input.checked = Boolean(params[key]);
        input.setAttribute('aria-checked', String(input.checked));
      };
      input.addEventListener('change', () => {
        set(key, input.checked);
        bus.emit(Events.UI_SOUND, 'click');
        sync();
      });
      this._sync.push(sync);
      sync();
      return row(id, label, input);
    };

    const fStops = PHOTO.fStops;
    const focusButton = el('button', {
      class: 'btn btn-ghost btn-small',
      type: 'button',
      text: 'Focus on pup',
      onclick: () => {
        actions.focusPup();
        bus.emit(Events.UI_SOUND, 'click');
      },
    });

    const chips = PHOTO.filters.map((f) =>
      el('button', {
        class: 'chip',
        type: 'button',
        text: f.label,
        'data-filter': f.id,
        'aria-pressed': 'false',
        onclick: () => {
          set('filter', f.id);
          bus.emit(Events.UI_SOUND, 'click');
          syncChips();
        },
      }),
    );
    const syncChips = () => {
      for (const c of chips) {
        const on = c.dataset.filter === params.filter;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-pressed', String(on));
      }
    };
    this._sync.push(syncChips);
    syncChips();

    const expression = el(
      'select',
      { id: 'photo-expression' },
      EXPRESSION_OPTIONS.map(([v, label]) => el('option', { value: v, text: label })),
    );
    expression.addEventListener('change', () => set('expression', expression.value));
    this._sync.push(() => {
      expression.value = params.expression;
    });

    this.hint = el('p', { class: 'photo-hint' });
    this.captureButton = el('button', {
      class: 'btn btn-primary',
      type: 'button',
      text: 'Capture',
      onclick: () => actions.capture(),
    });

    this.root = el(
      'section',
      {
        class: 'panel photo-panel',
        hidden: true,
        role: 'dialog',
        'aria-labelledby': 'photo-title',
      },
      [
        el('header', { class: 'photo-header' }, [
          el('h2', { id: 'photo-title', text: 'Photo mode' }),
          el('button', {
            class: 'photo-close',
            type: 'button',
            'aria-label': 'Exit photo mode',
            text: '✕',
            onclick: () => actions.exit(),
          }),
        ]),
        el('div', { class: 'settings-grid' }, [
          el('fieldset', {}, [
            el('legend', { text: 'Camera' }),
            range(
              'fov',
              'Field of view',
              PHOTO.fovMin,
              PHOTO.fovMax,
              1,
              (v) => `${Math.round(v)}°`,
            ),
            range('roll', 'Roll', -PHOTO.rollMax, PHOTO.rollMax, 1, (v) => `${Math.round(v)}°`),
          ]),
          el('fieldset', {}, [
            el('legend', { text: 'Depth of field' }),
            toggle('dof', 'Depth of field'),
            range(
              'focus',
              'Focus distance',
              0,
              1000,
              1,
              (v) => (v < 10 ? `${v.toFixed(1)} m` : `${Math.round(v)} m`),
              focusToSlider,
              sliderToFocus,
            ),
            range(
              'fStop',
              'Aperture',
              0,
              fStops.length - 1,
              1,
              (v) => `f/${v}`,
              (v) => Math.max(0, fStops.indexOf(v)),
              (i) => fStops[i],
            ),
            el('div', { class: 'photo-inline' }, [focusButton]),
          ]),
          el('fieldset', {}, [
            el('legend', { text: 'Look' }),
            range(
              'exposure',
              'Exposure',
              PHOTO.exposureMin,
              PHOTO.exposureMax,
              0.1,
              (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} EV`,
            ),
            el(
              'div',
              { class: 'chip-row', 'data-nav-group': '', role: 'group', 'aria-label': 'Filter' },
              chips,
            ),
            range('strength', 'Filter strength', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
          ]),
          el('fieldset', {}, [
            el('legend', { text: 'Pup & photo' }),
            toggle('showPup', 'Show pup'),
            row('photo-expression', 'Expression', expression),
            toggle('watermark', 'Watermark'),
          ]),
        ]),
        el('div', { class: 'panel-actions' }, [
          el('button', {
            class: 'btn btn-ghost',
            type: 'button',
            text: 'Exit',
            onclick: () => actions.exit(),
          }),
          el('button', {
            class: 'btn btn-secondary',
            type: 'button',
            text: 'Hide UI',
            onclick: () => actions.hideUi(),
          }),
          this.captureButton,
        ]),
        this.hint,
      ],
    );
    root.append(this.root);
    this._unsub = bus.on(Events.INPUT_DEVICE_CHANGED, ({ device }) => this.setDevice(device));
    this.setDevice('keyboard');
  }

  /** @param {string} device */
  setDevice(device) {
    this.hint.textContent = HINTS[device] || HINTS.keyboard;
  }

  /** Refresh every control from the parameters. */
  sync() {
    for (const s of this._sync) s();
  }

  /** @param {boolean} visible */
  setVisible(visible) {
    this.root.hidden = !visible;
    if (visible) this.sync();
  }

  /** Focus the first control (gamepad users start navigating right away). */
  focusFirst() {
    this.captureButton.focus({ preventScroll: true });
  }

  dispose() {
    this._unsub();
    this.root.remove();
  }
}
