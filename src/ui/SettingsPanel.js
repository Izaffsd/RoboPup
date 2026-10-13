import { CAMERA, QUALITY_ORDER, QUALITY_PRESETS } from '../config/config.js';
import { Events } from '../core/EventBus.js';
import { describeStats } from '../core/StatsTracker.js';
import { el } from './dom.js';

/** Seconds the Reset Progress button waits for its confirming second press. */
const CONFIRM_WINDOW = 4;

/**
 * Settings modal: graphics preset, FOV, performance overlay, mouse
 * sensitivity, invert Y, cursor lock, the three volume sliders, and a
 * Progress section with lifetime stats and "Reset Progress". Every control
 * writes straight into the SettingsStore (validated + persisted) and
 * reflects changes made elsewhere (e.g. F3 toggling the overlay).
 */
export class SettingsPanel {
  /**
   * @param {object} deps
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {import('../core/SettingsStore.js').SettingsStore} deps.settings
   * @param {import('../core/SaveManager.js').SaveManager} deps.save
   * @param {() => string} deps.detectedQuality Label of the auto-detected preset.
   * @param {() => void} deps.onBack
   */
  constructor({ bus, settings, save, detectedQuality, onBack }) {
    this.settings = settings;
    this.save = save;
    this.bus = bus;
    this.inputs = {};

    const row = (id, label, control, value) =>
      el('div', { class: 'setting-row' }, [
        el('label', { for: id, text: label }),
        el('div', { class: 'setting-control' }, [control, value || null]),
      ]);

    const range = (key, min, max, step, format) => {
      const id = `set-${key}`;
      const input = el('input', { id, type: 'range', min, max, step });
      const out = el('output', { for: id, class: 'setting-value' });
      const sync = () => {
        input.value = String(settings.get(key));
        out.textContent = format(settings.get(key));
        input.style.setProperty('--fill', `${((settings.get(key) - min) / (max - min)) * 100}%`);
      };
      input.addEventListener('input', () => {
        settings.set(key, Number(input.value));
        sync();
      });
      this.inputs[key] = sync;
      sync();
      return { input, out, id };
    };

    const toggle = (key) => {
      const id = `set-${key}`;
      const input = el('input', { id, type: 'checkbox', class: 'toggle', role: 'switch' });
      const sync = () => {
        input.checked = Boolean(settings.get(key));
        input.setAttribute('aria-checked', String(input.checked));
      };
      input.addEventListener('change', () => {
        settings.set(key, input.checked);
        bus.emit(Events.UI_SOUND, 'click');
        sync();
      });
      this.inputs[key] = sync;
      sync();
      return { input, id };
    };

    const quality = el('select', { id: 'set-quality' });
    // The detected tier is only resolved once the panel is actually opened
    // (it needs a WebGL context), never during page load.
    let showDetected = false;
    const qualitySync = () => {
      const auto = showDetected ? `Auto (${detectedQuality()})` : 'Auto';
      quality.replaceChildren(
        el('option', { value: 'auto', text: auto }),
        ...QUALITY_ORDER.map((k) => el('option', { value: k, text: QUALITY_PRESETS[k].label })),
      );
      quality.value = settings.get('quality');
    };
    this._enableDetection = () => {
      showDetected = true;
    };
    quality.addEventListener('change', () => {
      settings.set('quality', quality.value);
      bus.emit(Events.UI_SOUND, 'click');
    });
    this.inputs.quality = qualitySync;
    qualitySync();

    const pct = (v) => `${Math.round(v * 100)}%`;
    const fov = range('fov', CAMERA.fovMin, CAMERA.fovMax, 1, (v) => `${Math.round(v)}°`);
    const sens = range('mouseSensitivity', 0.2, 3, 0.05, (v) => `${v.toFixed(2)}×`);
    const master = range('masterVolume', 0, 1, 0.01, pct);
    const sfx = range('sfxVolume', 0, 1, 0.01, pct);
    const amb = range('ambienceVolume', 0, 1, 0.01, pct);
    const invert = toggle('invertY');
    const lock = toggle('pointerLockOnDrag');
    const fps = toggle('showFps');

    this.root = el(
      'section',
      {
        class: 'panel panel-settings',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'settings-title',
      },
      [
        el('h2', { id: 'settings-title', text: 'Settings' }),
        el('div', { class: 'settings-grid' }, [
          el('fieldset', {}, [
            el('legend', { text: 'Graphics' }),
            row('set-quality', 'Quality preset', quality),
            row(fov.id, 'Field of view', fov.input, fov.out),
            row(fps.id, 'Performance overlay (F3)', fps.input),
          ]),
          el('fieldset', {}, [
            el('legend', { text: 'Controls' }),
            row(sens.id, 'Camera sensitivity', sens.input, sens.out),
            row(invert.id, 'Invert camera Y', invert.input),
            row(lock.id, 'Hide cursor while orbiting', lock.input),
          ]),
          el('fieldset', {}, [
            el('legend', { text: 'Audio' }),
            row(master.id, 'Master volume', master.input, master.out),
            row(sfx.id, 'Effects volume', sfx.input, sfx.out),
            row(amb.id, 'Ambience volume', amb.input, amb.out),
          ]),
          this._progressSection(),
        ]),
        el('div', { class: 'panel-actions' }, [
          el('button', {
            class: 'btn btn-ghost',
            type: 'button',
            text: 'Reset to defaults',
            onclick: () => {
              settings.resetToDefaults();
              bus.emit(Events.UI_SOUND, 'click');
            },
          }),
          el('button', { class: 'btn btn-primary', type: 'button', text: 'Back', onclick: onBack }),
        ]),
      ],
    );

    this._unsubs = [
      bus.on(Events.SETTINGS_CHANGED, ({ key }) => {
        const sync = this.inputs[key];
        if (sync) sync();
      }),
      bus.on(Events.SAVE_PROGRESS_RESET, () => this._renderStats()),
    ];
  }

  _progressSection() {
    this.stats = el('dl', { class: 'stats-list' });
    this.resetButton = el('button', {
      class: 'btn btn-ghost btn-danger',
      type: 'button',
      text: 'Reset progress',
      onclick: () => this._onReset(),
    });
    this.storageNote = el('p', {
      class: 'setting-note',
      text: 'Browser storage is unavailable, so progress will not be kept after this session.',
    });
    this._confirmUntil = 0;
    return el('fieldset', {}, [
      el('legend', { text: 'Progress' }),
      this.stats,
      this.storageNote,
      el('div', { class: 'setting-row' }, [
        el('span', {
          class: 'setting-note',
          text: 'Erases stats and progress; settings are kept.',
        }),
        el('div', { class: 'setting-control' }, [this.resetButton]),
      ]),
    ]);
  }

  _renderStats() {
    this.stats.replaceChildren(
      ...describeStats(this.save.progress.stats).map(([label, value]) =>
        el('div', { class: 'stat' }, [el('dt', { text: label }), el('dd', { text: value })]),
      ),
    );
    this.storageNote.hidden = this.save.persistent;
  }

  /** Two-step confirmation that works the same with mouse, touch, keys and gamepad. */
  _onReset() {
    const now = performance.now();
    window.clearTimeout(this._confirmTimer);
    this.bus.emit(Events.UI_SOUND, 'click');
    if (now > this._confirmUntil) {
      this._confirmUntil = now + CONFIRM_WINDOW * 1000;
      this.resetButton.textContent = 'Press again to erase';
      this.resetButton.classList.add('is-armed');
      this._confirmTimer = window.setTimeout(() => this._disarm(), CONFIRM_WINDOW * 1000);
      return;
    }
    this._disarm();
    this.save.resetProgress();
    this.resetButton.textContent = 'Progress erased';
    this._confirmTimer = window.setTimeout(() => this._disarm(), 1800);
  }

  _disarm() {
    this._confirmUntil = 0;
    this.resetButton.textContent = 'Reset progress';
    this.resetButton.classList.remove('is-armed');
  }

  /** Refresh all controls (called when the panel opens). */
  refresh() {
    this._enableDetection();
    for (const sync of Object.values(this.inputs)) sync();
    this._renderStats();
    this._disarm();
  }

  dispose() {
    for (const off of this._unsubs) off();
    window.clearTimeout(this._confirmTimer);
    this.root.remove();
  }
}
