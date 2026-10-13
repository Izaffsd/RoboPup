import { CAMERA, DEFAULT_SETTINGS, QUALITY_ORDER } from '../config/config.js';
import { Events } from './EventBus.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Validators normalise untrusted values (from storage or UI) into safe ones. */
const VALIDATORS = {
  quality: (v) => (v === 'auto' || QUALITY_ORDER.includes(v) ? v : DEFAULT_SETTINGS.quality),
  fov: (v) => clamp(Number(v) || DEFAULT_SETTINGS.fov, CAMERA.fovMin, CAMERA.fovMax),
  mouseSensitivity: (v) => clamp(Number(v) || DEFAULT_SETTINGS.mouseSensitivity, 0.2, 3),
  invertY: (v) => v === true,
  masterVolume: (v) => clamp(Number.isFinite(Number(v)) ? Number(v) : 0.8, 0, 1),
  sfxVolume: (v) => clamp(Number.isFinite(Number(v)) ? Number(v) : 0.8, 0, 1),
  ambienceVolume: (v) => clamp(Number.isFinite(Number(v)) ? Number(v) : 0.6, 0, 1),
  showFps: (v) => v === true,
  pointerLockOnDrag: (v) => v !== false,
  photoWatermark: (v) => v !== false,
};

/**
 * User settings: a validated view onto the `settings` section of the save
 * document. Values are checked on load and on every change, persisted
 * through the SaveManager and broadcast as {@link Events.SETTINGS_CHANGED}.
 */
export class SettingsStore {
  /**
   * @param {import('./EventBus.js').EventBus} bus
   * @param {import('./SaveManager.js').SaveManager} save
   */
  constructor(bus, save) {
    this._bus = bus;
    this._save = save;
    const stored = save.settings;
    /** The save document's settings object itself (validated in place). */
    this._values = stored;
    for (const key of Object.keys(VALIDATORS)) {
      stored[key] = key in stored ? VALIDATORS[key](stored[key]) : DEFAULT_SETTINGS[key];
    }
    this._payload = { key: '', value: null, settings: this._values };
  }

  /**
   * @param {string} key
   * @returns {any}
   */
  get(key) {
    return this._values[key];
  }

  /** @returns {Readonly<Record<string, any>>} Snapshot of every setting. */
  getAll() {
    return { ...this._values };
  }

  /**
   * Update a setting, persist it and notify listeners.
   * @param {string} key
   * @param {any} value
   */
  set(key, value) {
    const validate = VALIDATORS[key];
    if (!validate) return;
    const next = validate(value);
    if (this._values[key] === next) return;
    this._values[key] = next;
    this._save.markDirty();
    this._payload.key = key;
    this._payload.value = next;
    this._bus.emit(Events.SETTINGS_CHANGED, this._payload);
  }

  /** Restore every default and notify listeners for each key. */
  resetToDefaults() {
    for (const key of Object.keys(VALIDATORS)) this.set(key, DEFAULT_SETTINGS[key]);
  }
}
