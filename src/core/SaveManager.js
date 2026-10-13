import { SAVE } from '../config/config.js';
import { Events } from './EventBus.js';

/**
 * Default progress section, used for new players and after "Reset Progress".
 * Later systems add their own sub-objects here (and a migration if they
 * change the shape of existing data).
 */
export function defaultProgress() {
  return {
    stats: {
      /** Seconds of active play. */
      playTime: 0,
      /** Metres walked/run. */
      distance: 0,
      jumps: 0,
      barks: 0,
      photos: 0,
      /** Times each emote was performed, by emote id. */
      emotes: {},
    },
  };
}

/**
 * Schema migrations: `MIGRATIONS[n]` upgrades a document from version n to
 * n + 1. Version 0 is the layout used before the SaveManager existed: a
 * settings-only object under `SAVE.legacySettingsKey`.
 */
const MIGRATIONS = [(doc) => ({ version: 1, settings: doc.settings, progress: defaultProgress() })];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Normalise untrusted stored data against a default shape: keys keep the
 * stored value when its type matches the default, missing or mistyped keys
 * fall back to the default, numbers must be finite and non-negative, and an
 * empty default object acts as a map of non-negative numbers (e.g. counters
 * keyed by id). Unknown keys from newer builds are preserved.
 * @param {any} shape Default value.
 * @param {any} value Stored value.
 */
function conform(shape, value) {
  if (isPlainObject(shape)) {
    const out = isPlainObject(value) ? { ...value } : {};
    const keys = Object.keys(shape);
    if (keys.length === 0) {
      for (const [k, v] of Object.entries(out)) {
        if (!(typeof v === 'number' && Number.isFinite(v) && v >= 0)) delete out[k];
      }
      return out;
    }
    for (const key of keys) out[key] = conform(shape[key], out[key]);
    return out;
  }
  if (typeof shape === 'number') {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : shape;
  }
  return typeof value === typeof shape ? value : shape;
}

/**
 * One versioned save document in localStorage holding every persistent
 * piece of state: `{ version, settings, progress }`.
 *
 * - Loads the document (or the legacy settings key), runs every migration
 *   up to {@link SAVE.version} and writes the upgraded document back.
 * - Validates stored data against the default shapes, so a hand-edited or
 *   corrupt save can never break the game; a document from a newer build is
 *   read as-is and its unknown fields are kept on write.
 * - Writes are coalesced (at most one per `SAVE.flushDelay`) and flushed
 *   immediately when the page is hidden or closed.
 * - Falls back to memory when storage is unavailable (private mode, blocked
 *   cookies); the game still works, progress just isn't kept.
 *
 * Settings are owned by SettingsStore (which validates them); progress
 * sections are owned by the systems that use them, which mutate
 * {@link SaveManager#progress} and call {@link SaveManager#markDirty}.
 */
export class SaveManager {
  /** @param {import('./EventBus.js').EventBus} bus */
  constructor(bus) {
    this.bus = bus;
    /** False when localStorage is unavailable. */
    this.persistent = true;
    /** Version the document was loaded at (before migration). */
    this.loadedVersion = SAVE.version;
    this._timer = 0;
    this._doc = this._load();
    this._onHide = () => {
      if (document.visibilityState === 'hidden') this.flush();
    };
    this._onPageHide = () => this.flush();
    document.addEventListener('visibilitychange', this._onHide);
    window.addEventListener('pagehide', this._onPageHide);
  }

  /** Raw settings object (validated and owned by SettingsStore). */
  get settings() {
    return this._doc.settings;
  }

  /** Progress object; owners mutate it and call markDirty(). */
  get progress() {
    return this._doc.progress;
  }

  /** Schedule a write (coalesced). */
  markDirty() {
    if (this._timer) return;
    this._timer = window.setTimeout(() => this.flush(), SAVE.flushDelay * 1000);
  }

  /** Write the document now. */
  flush() {
    if (this._timer) {
      window.clearTimeout(this._timer);
      this._timer = 0;
    }
    if (!this.persistent) return;
    this._doc.savedAt = Date.now();
    try {
      window.localStorage.setItem(SAVE.key, JSON.stringify(this._doc));
    } catch {
      // Quota exceeded or storage revoked mid-session: keep playing from memory.
      this.persistent = false;
    }
  }

  /** Erase progress (settings are kept) and notify every system. */
  resetProgress() {
    this._doc.progress = defaultProgress();
    this.flush();
    this.bus.emit(Events.SAVE_PROGRESS_RESET);
  }

  _read(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      this.persistent = false;
      return null;
    }
  }

  _load() {
    let doc = null;
    const raw = this._read(SAVE.key);
    if (raw) doc = parse(raw);
    if (!doc && this.persistent) {
      const legacy = this._read(SAVE.legacySettingsKey);
      if (legacy) doc = { version: 0, settings: parse(legacy) || {} };
    }
    const fresh = !doc;
    if (!doc || typeof doc.version !== 'number' || doc.version < 0) {
      doc = { version: SAVE.version, settings: {}, progress: defaultProgress() };
    }
    this.loadedVersion = doc.version;
    let migrated = false;
    while (doc.version < SAVE.version) {
      doc = MIGRATIONS[doc.version](doc);
      migrated = true;
    }
    doc.settings = isPlainObject(doc.settings) ? doc.settings : {};
    doc.progress = conform(defaultProgress(), doc.progress);
    if (migrated || fresh) {
      this._doc = doc;
      this.flush();
      if (migrated && this.persistent) {
        try {
          window.localStorage.removeItem(SAVE.legacySettingsKey);
        } catch {
          // Leaving the legacy key behind is harmless.
        }
      }
    }
    return doc;
  }

  dispose() {
    this.flush();
    document.removeEventListener('visibilitychange', this._onHide);
    window.removeEventListener('pagehide', this._onPageHide);
  }
}

function parse(raw) {
  try {
    const value = JSON.parse(raw);
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}
