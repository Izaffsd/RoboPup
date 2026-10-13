/**
 * Event names used across modules. Systems talk to each other exclusively
 * through these events (plus explicit constructor dependencies), never through
 * shared globals.
 */
export const Events = Object.freeze({
  LOAD_PROGRESS: 'load:progress',
  LOAD_COMPLETE: 'load:complete',
  LOAD_FAILED: 'load:failed',

  GAME_START: 'game:start',
  GAME_PAUSE: 'game:pause',
  GAME_RESUME: 'game:resume',
  GAME_QUIT: 'game:quit',

  SETTINGS_CHANGED: 'settings:changed',
  QUALITY_APPLIED: 'quality:applied',

  INPUT_PAUSE_TOGGLE: 'input:pause-toggle',
  INPUT_TOGGLE_FPS: 'input:toggle-fps',
  INPUT_DEVICE_CHANGED: 'input:device-changed',
  INPUT_GAMEPAD: 'input:gamepad',
  INPUT_RECENTER_CAMERA: 'input:recenter-camera',
  /** Gamepad menu navigation: payload 'up' | 'down' | 'left' | 'right'. */
  INPUT_UI_NAV: 'input:ui-nav',
  /** Gamepad A on a focused menu control. */
  INPUT_UI_ACCEPT: 'input:ui-accept',
  USER_GESTURE: 'input:user-gesture',

  PLAYER_FOOTSTEP: 'player:footstep',
  PLAYER_JUMP: 'player:jump',
  PLAYER_LAND: 'player:land',
  PLAYER_BARK: 'player:bark',
  PLAYER_ZONE: 'player:zone',

  /** Ask for an emote: payload is the emote id (see EMOTES.list). */
  EMOTE_REQUEST: 'emote:request',
  /** Payload {id, x, y, z}. */
  EMOTE_START: 'emote:start',
  /** Payload {id, reason: 'done' | 'cancelled'}. */
  EMOTE_END: 'emote:end',
  /** Emote wheel opened / closed: payload {open}. */
  EMOTE_WHEEL: 'emote:wheel',

  PHOTO_ENTER: 'photo:enter',
  PHOTO_EXIT: 'photo:exit',
  /** Payload {name, width, height}. */
  PHOTO_CAPTURED: 'photo:captured',

  TOY_IMPACT: 'toy:impact',

  /** Progress was erased from Settings (settings themselves are kept). */
  SAVE_PROGRESS_RESET: 'save:progress-reset',

  UI_REQUEST_PLAY: 'ui:request-play',
  UI_REQUEST_RESUME: 'ui:request-resume',
  UI_REQUEST_QUIT: 'ui:request-quit',
  UI_REQUEST_PHOTO: 'ui:request-photo',
  UI_SOUND: 'ui:sound',
  /** Payload {message, seconds?}: short HUD notification. */
  UI_TOAST: 'ui:toast',

  CONTEXT_LOST: 'render:context-lost',
  CONTEXT_RESTORED: 'render:context-restored',
});

/**
 * Minimal synchronous publish/subscribe bus.
 *
 * Emitting does not allocate: payload objects are owned by the emitter and may
 * be reused between emissions, so listeners must copy anything they keep.
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} type Event name (see {@link Events}).
   * @param {(payload: any) => void} listener
   * @returns {() => void} Unsubscribe function.
   */
  on(type, listener) {
    let set = this._listeners.get(type);
    if (!set) {
      set = new Set();
      this._listeners.set(type, set);
    }
    set.add(listener);
    return () => this.off(type, listener);
  }

  /**
   * Subscribe for a single emission.
   * @param {string} type
   * @param {(payload: any) => void} listener
   * @returns {() => void} Unsubscribe function.
   */
  once(type, listener) {
    const wrapped = (payload) => {
      this.off(type, wrapped);
      listener(payload);
    };
    return this.on(type, wrapped);
  }

  /**
   * Remove a listener.
   * @param {string} type
   * @param {Function} listener
   */
  off(type, listener) {
    const set = this._listeners.get(type);
    if (set) set.delete(listener);
  }

  /**
   * Synchronously notify every listener of `type`.
   * @param {string} type
   * @param {any} [payload]
   */
  emit(type, payload) {
    const set = this._listeners.get(type);
    if (!set || set.size === 0) return;
    for (const listener of set) listener(payload);
  }

  /** Remove every listener (used on teardown). */
  clear() {
    this._listeners.clear();
  }
}
