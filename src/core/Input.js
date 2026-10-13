import { CAMERA, INPUT } from '../config/config.js';
import { Events } from './EventBus.js';

/** Keys whose default browser action is suppressed while playing. */
const GAME_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'ShiftLeft',
  'ShiftRight',
  'KeyE',
  'KeyQ',
  'KeyP',
  'KeyC',
  'KeyH',
  'KeyF',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
]);

const EDITABLE = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON']);

/** Standard Gamepad API button indices. */
const GP = Object.freeze({
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  R3: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
});

/** Menu navigation auto-repeat (s). */
const NAV_DELAY = 0.38;
const NAV_REPEAT = 0.12;

function applyRadialDeadzone(x, y, deadzone, out) {
  const mag = Math.hypot(x, y);
  if (mag < deadzone) {
    out.x = 0;
    out.y = 0;
    return 0;
  }
  const scaled = Math.min(1, (mag - deadzone) / (1 - deadzone));
  out.x = (x / mag) * scaled;
  out.y = (y / mag) * scaled;
  return scaled;
}

/**
 * Unified input: keyboard, mouse (drag-to-orbit with optional pointer lock),
 * wheel zoom, Gamepad API and virtual touch controls are merged into a single
 * per-frame {@link Input#state} that gameplay code reads.
 *
 * Modes:
 *  - `menu`  no gameplay input; the gamepad navigates menus (D-pad / left
 *            stick, A to activate, B / Start to go back);
 *  - `play`  the pup: move, sprint, jump, bark, emotes, camera orbit/zoom;
 *  - `photo` the free camera: fly, look, up/down, capture; the D-pad
 *            navigates the photo panel.
 */
export class Input {
  /**
   * @param {object} deps
   * @param {import('./EventBus.js').EventBus} deps.bus
   * @param {HTMLCanvasElement} deps.canvas
   * @param {import('./SettingsStore.js').SettingsStore} deps.settings
   */
  constructor({ bus, canvas, settings }) {
    this.bus = bus;
    this.canvas = canvas;
    this.settings = settings;
    /** 'menu' | 'play' | 'photo' */
    this.mode = 'menu';

    /** Merged per-frame state consumed by gameplay systems. */
    this.state = {
      moveX: 0,
      moveY: 0,
      sprint: false,
      jumpHeld: false,
      jumpPressed: false,
      jumpReleased: false,
      barkPressed: false,
      /** Camera orbit / look deltas this frame, in radians (sensitivity and invert applied). */
      lookX: 0,
      lookY: 0,
      /** Zoom delta this frame (positive = zoom out). */
      zoom: 0,
      device: 'keyboard',
      /** Emote wheel key (Q / gamepad Y) held, and its edges this frame. */
      emoteHeld: false,
      emotePressed: false,
      emoteReleased: false,
      /** Touch emote button: toggles the wheel. */
      emoteToggle: false,
      /** 1–7 when a number key was pressed this frame, else 0. */
      emoteDigit: 0,
      /** Photo mode: toggle, capture, hide UI, focus on the pup (edges). */
      photoToggle: false,
      capture: false,
      hideUi: false,
      focusPup: false,
      /** Photo mode vertical flight, 0..1 each. */
      up: 0,
      down: 0,
      /** Raw mouse movement this frame (CSS px), whether dragging or not. */
      pointerDX: 0,
      pointerDY: 0,
      /** Dead-zoned gamepad sticks (+y = down). */
      stickLX: 0,
      stickLY: 0,
      stickRX: 0,
      stickRY: 0,
      /** Gamepad A / B pressed this frame (emote wheel confirm / close). */
      padAccept: false,
      padBack: false,
    };

    this._keys = new Set();
    this._queued = new Set();
    this._queuedJumpRelease = false;
    this._queuedEmoteRelease = false;
    this._mouseDX = 0;
    this._mouseDY = 0;
    this._rawDX = 0;
    this._rawDY = 0;
    this._wheel = 0;
    /** Last mouse positions, for deltas where movementX/Y are unavailable. */
    this._lastPX = NaN;
    this._lastPY = NaN;
    this._dragPX = NaN;
    this._dragPY = NaN;
    this._dragging = false;
    this._dragPointerId = -1;
    this._lockActive = false;
    this._expectUnlock = false;
    this._lastPauseToggle = 0;
    this._gestureSent = false;
    this._navDir = '';
    this._navTimer = 0;

    this._touch = {
      active: false,
      moveX: 0,
      moveY: 0,
      sprint: false,
      lookDX: 0,
      lookDY: 0,
      jumpHeld: false,
      vertical: 0,
    };

    this._gpPrev = new Uint8Array(20);
    this._gpStick = { x: 0, y: 0 };
    this._gpLook = { x: 0, y: 0 };
    this._gpConnected = false;
    this._gpPayload = { connected: false, id: '' };
    this._devicePayload = { device: 'keyboard' };

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onRawPointerMove = this._onRawPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onContextMenu = (e) => e.preventDefault();
    this._onLockChange = this._onLockChange.bind(this);
    this._onLockError = this._onLockError.bind(this);
    this._onGamepadConnected = this._onGamepadConnected.bind(this);
    this._onGamepadDisconnected = this._onGamepadDisconnected.bind(this);
    this._onAnyGesture = this._onAnyGesture.bind(this);

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('pointermove', this._onRawPointerMove);
    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('pointermove', this._onPointerMove);
    canvas.addEventListener('pointerup', this._onPointerUp);
    canvas.addEventListener('pointercancel', this._onPointerUp);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this._onContextMenu);
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('pointerlockerror', this._onLockError);
    window.addEventListener('gamepadconnected', this._onGamepadConnected);
    window.addEventListener('gamepaddisconnected', this._onGamepadDisconnected);
    window.addEventListener('pointerdown', this._onAnyGesture, true);
    window.addEventListener('keydown', this._onAnyGesture, true);
    window.addEventListener('touchend', this._onAnyGesture, true);
  }

  /** True when the pup or the photo camera receives input. */
  get gameplayEnabled() {
    return this.mode !== 'menu';
  }

  /**
   * Switch input mode. Leaving gameplay ends any camera drag, releases
   * pointer lock and drops held keys.
   * @param {'menu'|'play'|'photo'} mode
   */
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this._endDrag();
    this._keys.clear();
    this._queued.clear();
    this._queuedJumpRelease = false;
    this._queuedEmoteRelease = false;
    this._touch.active = false;
    this._touch.jumpHeld = false;
    this._touch.vertical = 0;
    this._navDir = '';
  }

  /** Release pointer lock if we hold it (e.g. when the pause menu opens). */
  releasePointerLock() {
    if (document.pointerLockElement === this.canvas) {
      this._expectUnlock = true;
      document.exitPointerLock();
    }
  }

  // ---------------------------------------------------------------- touch API

  /**
   * Virtual joystick from the touch UI.
   * @param {number} x -1..1 (right positive)
   * @param {number} y -1..1 (forward positive)
   * @param {boolean} sprint
   */
  setTouchMove(x, y, sprint) {
    const t = this._touch;
    t.active = true;
    t.moveX = x;
    t.moveY = y;
    t.sprint = sprint;
    this._setDevice('touch');
  }

  /** Joystick released. */
  clearTouchMove() {
    const t = this._touch;
    t.active = false;
    t.moveX = 0;
    t.moveY = 0;
    t.sprint = false;
  }

  /**
   * Drag-to-orbit delta from the touch look area, in CSS pixels.
   * @param {number} dx
   * @param {number} dy
   */
  addTouchLook(dx, dy) {
    this._touch.lookDX += dx;
    this._touch.lookDY += dy;
    this._setDevice('touch');
  }

  /** @param {boolean} down */
  setTouchJump(down) {
    if (down && !this._touch.jumpHeld) this._queued.add('jump');
    if (!down && this._touch.jumpHeld) this._queuedJumpRelease = true;
    this._touch.jumpHeld = down;
    if (down) this._setDevice('touch');
  }

  /** Photo-mode up (+1) / down (−1) buttons; 0 when released. */
  setTouchVertical(value) {
    this._touch.vertical = value;
    if (value) this._setDevice('touch');
  }

  touchBark() {
    this._queued.add('bark');
    this._setDevice('touch');
  }

  touchEmote() {
    this._queued.add('emoteToggle');
    this._setDevice('touch');
  }

  touchPhoto() {
    this._queued.add('photo');
    this._setDevice('touch');
  }

  // ------------------------------------------------------------------ polling

  /**
   * Merge all devices into {@link Input#state}. Call once per rendered frame.
   * @param {number} dt Frame delta in seconds.
   */
  poll(dt) {
    const s = this.state;
    const keys = this._keys;
    const q = this._queued;
    const mode = this.mode;
    const play = mode === 'play';
    const photo = mode === 'photo';
    const active = play || photo;
    const sens = this.settings.get('mouseSensitivity');
    const invert = this.settings.get('invertY') ? -1 : 1;

    let mx = 0;
    let my = 0;
    let sprint = false;
    let jumpHeld = false;
    let up = 0;
    let down = 0;
    let emoteHeld = false;

    if (active) {
      if (keys.has('KeyW') || keys.has('ArrowUp')) my += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) my -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
      const len = Math.hypot(mx, my);
      if (len > 1) {
        mx /= len;
        my /= len;
      }
      sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
      if (play) {
        jumpHeld = keys.has('Space');
        emoteHeld = keys.has('KeyQ');
      } else {
        if (keys.has('KeyE') || keys.has('Space')) up = 1;
        if (keys.has('KeyQ')) down = 1;
      }
    }

    let lookX = this._mouseDX * CAMERA.mouseSensitivity * sens;
    let lookY = this._mouseDY * CAMERA.mouseSensitivity * sens * invert;
    let zoom = this._wheel;
    let padAccept = false;
    let padBack = false;
    s.stickLX = s.stickLY = s.stickRX = s.stickRY = 0;

    // Gamepad -------------------------------------------------------------
    const pad = this._readGamepad();
    if (pad) {
      const b = pad.buttons;
      const pressed = (i) => (b[i] ? b[i].pressed || b[i].value > 0.5 : false);
      const edge = (i) => pressed(i) && this._gpPrev[i] === 0;
      const value = (i) => (b[i] ? b[i].value : 0);

      const stickMag = applyRadialDeadzone(
        pad.axes[0] || 0,
        pad.axes[1] || 0,
        INPUT.gamepadDeadzone,
        this._gpStick,
      );
      const lookMag = applyRadialDeadzone(
        pad.axes[2] || 0,
        pad.axes[3] || 0,
        INPUT.gamepadDeadzone,
        this._gpLook,
      );
      s.stickLX = this._gpStick.x;
      s.stickLY = this._gpStick.y;
      s.stickRX = this._gpLook.x;
      s.stickRY = this._gpLook.y;

      if (edge(GP.START)) this._emitPauseToggle('gamepad');
      padAccept = edge(GP.A);
      padBack = edge(GP.B);

      if (active) {
        if (stickMag > Math.hypot(mx, my)) {
          mx = this._gpStick.x;
          my = -this._gpStick.y;
        }
        if (lookMag > 0) {
          lookX += this._gpLook.x * CAMERA.gamepadLookSpeed * sens * dt;
          lookY += this._gpLook.y * CAMERA.gamepadLookSpeed * sens * dt * invert;
        }
        if (edge(GP.BACK)) q.add('photo');
      }

      if (play) {
        if (value(GP.RT) > INPUT.gamepadTriggerThreshold || pressed(GP.LB)) sprint = true;
        if (pressed(GP.A)) jumpHeld = true;
        if (edge(GP.A)) q.add('jump');
        if (!pressed(GP.A) && this._gpPrev[GP.A] === 1) this._queuedJumpRelease = true;
        if (edge(GP.X) || edge(GP.B)) q.add('bark');
        if (pressed(GP.Y)) emoteHeld = true;
        if (pressed(GP.DPAD_UP) || pressed(GP.RB)) zoom -= 900 * dt;
        if (pressed(GP.DPAD_DOWN) || pressed(GP.LT)) zoom += 900 * dt;
        if (edge(GP.R3)) this.bus.emit(Events.INPUT_RECENTER_CAMERA);
      } else if (photo) {
        up = Math.max(up, value(GP.RT) > INPUT.gamepadTriggerThreshold ? value(GP.RT) : 0);
        down = Math.max(down, value(GP.LT) > INPUT.gamepadTriggerThreshold ? value(GP.LT) : 0);
        if (pressed(GP.RB)) zoom -= 900 * dt;
        if (pressed(GP.LB)) zoom += 900 * dt;
        if (edge(GP.X)) q.add('capture');
        if (edge(GP.Y)) q.add('hideUi');
        if (edge(GP.R3)) q.add('focusPup');
        if (padAccept) this.bus.emit(Events.INPUT_UI_ACCEPT);
        if (padBack) this._emitPauseToggle('gamepad');
      } else {
        if (padAccept) this.bus.emit(Events.INPUT_UI_ACCEPT);
        if (padBack) this._emitPauseToggle('gamepad');
      }

      if (!play) this._pollNav(pad, pressed, dt, !photo);

      const any =
        stickMag > 0 ||
        lookMag > 0 ||
        edge(GP.A) ||
        edge(GP.B) ||
        edge(GP.X) ||
        edge(GP.Y) ||
        edge(GP.START) ||
        edge(GP.DPAD_UP) ||
        edge(GP.DPAD_DOWN);
      if (any) this._setDevice('gamepad');
      for (let i = 0; i < this._gpPrev.length; i++) this._gpPrev[i] = pressed(i) ? 1 : 0;
    }

    // Touch ---------------------------------------------------------------
    const t = this._touch;
    if (active) {
      if (t.active && Math.hypot(t.moveX, t.moveY) > Math.hypot(mx, my)) {
        mx = t.moveX;
        my = t.moveY;
      }
      if (t.active && t.sprint && play) sprint = true;
      if (t.jumpHeld && play) jumpHeld = true;
      if (photo) {
        if (t.vertical > 0) up = Math.max(up, t.vertical);
        if (t.vertical < 0) down = Math.max(down, -t.vertical);
      }
      lookX += t.lookDX * CAMERA.touchSensitivity * sens;
      lookY += t.lookDY * CAMERA.touchSensitivity * sens * invert;
    }
    t.lookDX = 0;
    t.lookDY = 0;

    s.moveX = mx;
    s.moveY = my;
    s.sprint = sprint;
    s.jumpHeld = jumpHeld;
    s.jumpPressed = play && q.has('jump');
    s.jumpReleased = play && this._queuedJumpRelease;
    s.barkPressed = play && q.has('bark');
    s.lookX = active ? lookX : 0;
    s.lookY = active ? lookY : 0;
    s.zoom = active ? zoom : 0;
    s.device = this._devicePayload.device;
    s.emotePressed = play && emoteHeld && !s.emoteHeld;
    s.emoteReleased = (play && !emoteHeld && s.emoteHeld) || this._queuedEmoteRelease;
    s.emoteHeld = play && emoteHeld;
    s.emoteToggle = play && q.has('emoteToggle');
    s.emoteDigit = 0;
    if (play) {
      for (let d = 1; d <= 7; d++) if (q.has(`Digit${d}`)) s.emoteDigit = d;
    }
    s.photoToggle = active && q.has('photo');
    s.capture = photo && q.has('capture');
    s.hideUi = photo && q.has('hideUi');
    s.focusPup = photo && q.has('focusPup');
    s.up = photo ? up : 0;
    s.down = photo ? down : 0;
    s.pointerDX = this._rawDX;
    s.pointerDY = this._rawDY;
    s.padAccept = play && padAccept;
    s.padBack = play && padBack;

    q.clear();
    this._queuedJumpRelease = false;
    this._queuedEmoteRelease = false;
    this._mouseDX = 0;
    this._mouseDY = 0;
    this._rawDX = 0;
    this._rawDY = 0;
    this._wheel = 0;
  }

  /**
   * Gamepad menu navigation with auto-repeat.
   * @param {Gamepad} pad
   * @param {(i: number) => boolean} pressed
   * @param {number} dt
   * @param {boolean} useStick The left stick also navigates (not in photo mode, where it flies).
   */
  _pollNav(pad, pressed, dt, useStick) {
    let dir = '';
    if (pressed(GP.DPAD_UP)) dir = 'up';
    else if (pressed(GP.DPAD_DOWN)) dir = 'down';
    else if (pressed(GP.DPAD_LEFT)) dir = 'left';
    else if (pressed(GP.DPAD_RIGHT)) dir = 'right';
    else if (useStick) {
      const x = pad.axes[0] || 0;
      const y = pad.axes[1] || 0;
      if (Math.max(Math.abs(x), Math.abs(y)) > 0.6) {
        dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
      }
    }
    if (!dir) {
      this._navDir = '';
      return;
    }
    if (dir !== this._navDir) {
      this._navDir = dir;
      this._navTimer = NAV_DELAY;
      this.bus.emit(Events.INPUT_UI_NAV, dir);
      return;
    }
    this._navTimer -= dt;
    if (this._navTimer <= 0) {
      this._navTimer = NAV_REPEAT;
      this.bus.emit(Events.INPUT_UI_NAV, dir);
    }
  }

  /** Remove every DOM listener. */
  dispose() {
    this._endDrag();
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('pointermove', this._onRawPointerMove);
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this.canvas.removeEventListener('pointerup', this._onPointerUp);
    this.canvas.removeEventListener('pointercancel', this._onPointerUp);
    this.canvas.removeEventListener('wheel', this._onWheel);
    this.canvas.removeEventListener('contextmenu', this._onContextMenu);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('pointerlockerror', this._onLockError);
    window.removeEventListener('gamepadconnected', this._onGamepadConnected);
    window.removeEventListener('gamepaddisconnected', this._onGamepadDisconnected);
    window.removeEventListener('pointerdown', this._onAnyGesture, true);
    window.removeEventListener('keydown', this._onAnyGesture, true);
    window.removeEventListener('touchend', this._onAnyGesture, true);
  }

  // ----------------------------------------------------------------- handlers

  _onAnyGesture() {
    if (this._gestureSent) return;
    this._gestureSent = true;
    this.bus.emit(Events.USER_GESTURE);
  }

  _onKeyDown(e) {
    if (e.code === 'Escape') {
      this._emitPauseToggle('keyboard');
      return;
    }
    if (e.code === 'F3') {
      e.preventDefault();
      if (!e.repeat) this.bus.emit(Events.INPUT_TOGGLE_FPS);
      return;
    }
    const target = /** @type {HTMLElement} */ (e.target);
    if (target && EDITABLE.has(target.tagName) && !this.gameplayEnabled) return;
    if (!GAME_KEYS.has(e.code)) return;
    if (!this.gameplayEnabled) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (e.repeat) return;
    this._keys.add(e.code);
    switch (e.code) {
      case 'Space':
        this._queued.add('jump');
        break;
      case 'KeyE':
        this._queued.add('bark');
        break;
      case 'KeyP':
        this._queued.add('photo');
        break;
      case 'KeyC':
        this._queued.add('capture');
        break;
      case 'KeyH':
        this._queued.add('hideUi');
        break;
      case 'KeyF':
        this._queued.add('focusPup');
        break;
      default:
        if (e.code.startsWith('Digit')) this._queued.add(e.code);
    }
    this._setDevice('keyboard');
  }

  _onKeyUp(e) {
    if (e.code === 'Space' && this._keys.has('Space')) this._queuedJumpRelease = true;
    this._keys.delete(e.code);
  }

  _onBlur() {
    if (this._keys.has('KeyQ')) this._queuedEmoteRelease = true;
    this._keys.clear();
    this._endDrag();
  }

  _onPointerDown(e) {
    if (!this.gameplayEnabled || e.pointerType === 'touch') return;
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    this._dragging = true;
    this._dragPointerId = e.pointerId;
    this._dragPX = e.clientX;
    this._dragPY = e.clientY;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a convenience; dragging still works without it.
    }
    if (this.settings.get('pointerLockOnDrag') && this.canvas.requestPointerLock) {
      this._requestLock();
    }
    this._setDevice('keyboard');
  }

  _requestLock() {
    try {
      const result = this.canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') {
        result.catch(() => {
          // Lock refused (cool-down after Esc, unsupported, iframe sandbox):
          // drag-orbit keeps working with the visible cursor.
        });
      }
    } catch {
      // Older Safari throws synchronously in some sandboxed contexts.
    }
  }

  /**
   * Mouse delta of a move event. Under pointer lock only movementX/Y exist;
   * otherwise the client position difference is used, because WebKit
   * reports zero movement for ordinary (unlocked) mouse moves.
   * @returns {[number, number]}
   */
  _delta(e, lastX, lastY) {
    if (this._lockActive) return [e.movementX || 0, e.movementY || 0];
    if (Number.isNaN(lastX)) return [0, 0];
    return [e.clientX - lastX, e.clientY - lastY];
  }

  _onRawPointerMove(e) {
    if (e.pointerType === 'touch') return;
    const [dx, dy] = this._delta(e, this._lastPX, this._lastPY);
    this._lastPX = e.clientX;
    this._lastPY = e.clientY;
    this._rawDX += dx;
    this._rawDY += dy;
  }

  _onPointerMove(e) {
    if (!this._dragging) return;
    if (!this._lockActive && e.pointerId !== this._dragPointerId) return;
    const [dx, dy] = this._delta(e, this._dragPX, this._dragPY);
    this._dragPX = e.clientX;
    this._dragPY = e.clientY;
    this._mouseDX += dx;
    this._mouseDY += dy;
  }

  _onPointerUp(e) {
    if (!this._dragging) return;
    if (!this._lockActive && e.pointerId !== this._dragPointerId) return;
    this._endDrag();
  }

  _endDrag() {
    if (!this._dragging) return;
    this._dragging = false;
    try {
      if (this._dragPointerId >= 0 && this.canvas.hasPointerCapture(this._dragPointerId)) {
        this.canvas.releasePointerCapture(this._dragPointerId);
      }
    } catch {
      // Pointer already released by the browser.
    }
    this._dragPointerId = -1;
    this.releasePointerLock();
  }

  /** True while the mouse is dragging the camera. */
  get dragging() {
    return this._dragging;
  }

  /** Stop a camera drag (and pointer lock) so the cursor is free, e.g. for the emote wheel. */
  cancelDrag() {
    this._endDrag();
  }

  _onLockChange() {
    if (document.pointerLockElement === this.canvas) {
      this._lockActive = true;
      return;
    }
    if (!this._lockActive) return;
    this._lockActive = false;
    const userEscaped = !this._expectUnlock;
    this._expectUnlock = false;
    if (userEscaped && this._dragging) {
      // The browser consumed Esc to leave pointer lock: treat it as a pause request.
      this._dragging = false;
      this._dragPointerId = -1;
      this._emitPauseToggle('pointerlock');
    }
  }

  _onLockError() {
    this._lockActive = false;
  }

  _onWheel(e) {
    if (!this.gameplayEnabled) return;
    e.preventDefault();
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 120 : 1;
    this._wheel += e.deltaY * scale;
  }

  _onGamepadConnected(e) {
    this._gpConnected = true;
    this._gpPayload.connected = true;
    this._gpPayload.id = e.gamepad ? e.gamepad.id : '';
    this.bus.emit(Events.INPUT_GAMEPAD, this._gpPayload);
  }

  _onGamepadDisconnected(e) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this._gpConnected = Array.prototype.some.call(pads, (p) => p && p.connected);
    this._gpPayload.connected = false;
    this._gpPayload.id = e.gamepad ? e.gamepad.id : '';
    this.bus.emit(Events.INPUT_GAMEPAD, this._gpPayload);
    this._gpPrev.fill(0);
  }

  _readGamepad() {
    if (!this._gpConnected || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected && p.mapping === 'standard') return p;
    }
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected) return p;
    }
    return null;
  }

  _emitPauseToggle(source) {
    const now = performance.now();
    // Firefox can deliver both the Esc keydown and the pointer-lock exit.
    if (now - this._lastPauseToggle < 250) return;
    this._lastPauseToggle = now;
    this.bus.emit(Events.INPUT_PAUSE_TOGGLE, source);
  }

  _setDevice(device) {
    if (this._devicePayload.device === device) return;
    this._devicePayload.device = device;
    this.bus.emit(Events.INPUT_DEVICE_CHANGED, this._devicePayload);
  }
}
