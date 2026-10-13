import { CAMERA, PHOTO, RENDER } from '../config/config.js';
import { Events } from '../core/EventBus.js';
import { PhotoPanel } from '../ui/PhotoPanel.js';
import { PhotoCamera } from './PhotoCamera.js';

/** Local timestamp for file names: 2026-10-13_14-25-30. */
function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

/**
 * Small "RoboPup · Shelter Day" mark in the bottom-right corner, drawn with
 * canvas primitives (paw badge + wordmark), scaled with the image height.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 */
function drawWatermark(ctx, w, h) {
  const s = Math.max(0.5, h / 1080);
  const pad = 28 * s;
  const font = `ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif`;
  ctx.save();
  ctx.font = `900 ${32 * s}px ${font}`;
  const robo = ctx.measureText('Robo').width;
  const pup = ctx.measureText('Pup').width;
  const r = 24 * s;
  const textX = w - pad - robo - pup;
  const cx = textX - 12 * s - r;
  const cy = h - pad - r;
  ctx.globalAlpha = 0.88;
  ctx.shadowColor = 'rgba(10, 14, 30, 0.45)';
  ctx.shadowBlur = 10 * s;
  ctx.fillStyle = '#2bb3a8';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff6e5';
  const paw = [
    [0, 0.28, 0.42, 0.34],
    [-0.4, -0.12, 0.16, 0.22],
    [-0.14, -0.42, 0.16, 0.22],
    [0.14, -0.42, 0.16, 0.22],
    [0.4, -0.12, 0.16, 0.22],
  ];
  for (const [x, y, rx, ry] of paw) {
    ctx.beginPath();
    ctx.ellipse(cx + x * r, cy + y * r, rx * r, ry * r, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 10 * s;
  ctx.textBaseline = 'alphabetic';
  const base = cy + 4 * s;
  ctx.fillStyle = '#fff6e5';
  ctx.fillText(PHOTO.watermarkText.slice(0, 4), textX, base);
  ctx.fillStyle = '#ffcf4a';
  ctx.fillText(PHOTO.watermarkText.slice(4), textX + robo, base);
  ctx.font = `800 ${12 * s}px ${font}`;
  ctx.fillStyle = '#b9f5ec';
  ctx.fillText(
    PHOTO.watermarkSubtitle.toUpperCase().split('').join(String.fromCharCode(8202)),
    textX,
    base + 18 * s,
  );
  ctx.restore();
}

/**
 * Photo mode: freezes the simulation (the Engine stops stepping physics,
 * animation and world effects), detaches a free-fly camera, drives the
 * photo post-processing (depth of field, exposure, filters) and saves PNG
 * captures with an optional watermark.
 */
export class PhotoMode {
  /**
   * @param {object} deps
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {HTMLElement} deps.uiRoot
   * @param {import('three').PerspectiveCamera} deps.camera
   * @param {import('../physics/PhysicsWorld.js').PhysicsWorld} deps.physics
   * @param {import('../render/PostFX.js').PostFX} deps.postfx
   * @param {import('../render/Renderer.js').Renderer} deps.renderer
   * @param {import('../player/RobotDog.js').RobotDog} deps.dog
   * @param {import('../player/FaceController.js').FaceController} deps.face
   * @param {import('../core/SettingsStore.js').SettingsStore} deps.settings
   * @param {() => import('three').Vector3} deps.focusPoint Point to focus on (the pup's head).
   * @param {() => void} deps.renderFrame Renders one frame immediately.
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.active = false;
    this.uiHidden = false;
    this.freeCam = new PhotoCamera({ camera: deps.camera, physics: deps.physics });
    this.params = {
      fov: CAMERA.fovDefault,
      roll: 0,
      dof: true,
      focus: 3,
      fStop: PHOTO.defaultFStop,
      exposure: 0,
      filter: 'none',
      strength: 1,
      showPup: true,
      expression: 'auto',
      watermark: deps.settings.get('photoWatermark'),
    };
    this.panel = new PhotoPanel({
      root: deps.uiRoot,
      bus: deps.bus,
      params: this.params,
      onChange: (key) => this._onChange(key),
      actions: {
        capture: () => this.capture(),
        hideUi: () => this.setUiHidden(true),
        exit: () => this.bus.emit(Events.INPUT_PAUSE_TOGGLE, 'photo-panel'),
        focusPup: () => this.focusOnPup(),
      },
    });
    this.flash = document.createElement('div');
    this.flash.className = 'photo-flash';
    deps.uiRoot.append(this.flash);
    this._capturePayload = { name: '', width: 0, height: 0 };
    this._tap = null;
    this._onPointerDown = (e) => {
      if (this.uiHidden) this._tap = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    this._onPointerUp = (e) => {
      const tap = this._tap;
      this._tap = null;
      if (!tap || !this.uiHidden) return;
      const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y);
      if (moved < 8 && performance.now() - tap.t < 300) this.setUiHidden(false);
    };
  }

  /** Enter from gameplay (the Engine has already frozen the simulation). */
  enter() {
    if (this.active) return;
    this.active = true;
    this.freeCam.begin();
    const p = this.params;
    p.fov = Math.round(this.camera.fov);
    p.roll = 0;
    p.focus = Math.min(
      PHOTO.focusMax,
      Math.max(PHOTO.focusMin, this.freeCam.distanceTo(this.focusPoint())),
    );
    p.showPup = true;
    p.expression = 'auto';
    p.watermark = this.settings.get('photoWatermark');
    this.postfx.setPhotoMode(true);
    for (const key of Object.keys(p)) this._onChange(key);
    this.setUiHidden(false);
    this.panel.setVisible(true);
    window.addEventListener('pointerdown', this._onPointerDown, true);
    window.addEventListener('pointerup', this._onPointerUp, true);
    this.bus.emit(Events.PHOTO_ENTER);
  }

  /** Restore everything photo mode changed. */
  exit() {
    if (!this.active) return;
    this.active = false;
    this.setUiHidden(false);
    this.panel.setVisible(false);
    window.removeEventListener('pointerdown', this._onPointerDown, true);
    window.removeEventListener('pointerup', this._onPointerUp, true);
    this.postfx.setPhotoMode(false);
    this.renderer.three.toneMappingExposure = RENDER.toneMappingExposure;
    this.camera.fov = this.settings.get('fov');
    this.camera.updateProjectionMatrix();
    this.dog.object.visible = true;
    this.face.force('auto');
    this.bus.emit(Events.PHOTO_EXIT);
  }

  _onChange(key) {
    const p = this.params;
    switch (key) {
      case 'fov':
        this.freeCam.fov = p.fov;
        break;
      case 'roll':
        this.freeCam.roll = p.roll;
        break;
      case 'exposure':
        this.renderer.three.toneMappingExposure = RENDER.toneMappingExposure * 2 ** p.exposure;
        break;
      case 'showPup':
        this.dog.object.visible = p.showPup;
        break;
      case 'expression':
        this.face.force(p.expression);
        break;
      case 'watermark':
        this.settings.set('photoWatermark', p.watermark);
        break;
      default:
        this.postfx.setPhotoParams({
          dof: p.dof,
          focus: p.focus,
          fStop: p.fStop,
          filter: p.filter,
          strength: p.strength,
        });
    }
  }

  focusOnPup() {
    const p = this.params;
    p.focus = Math.min(
      PHOTO.focusMax,
      Math.max(PHOTO.focusMin, this.freeCam.distanceTo(this.focusPoint())),
    );
    p.dof = true;
    this._onChange('focus');
    this.panel.sync();
  }

  /** @param {boolean} hidden Hide every UI layer to frame the shot. */
  setUiHidden(hidden) {
    this.uiHidden = hidden;
    this.uiRoot.classList.toggle('photo-ui-hidden', hidden);
    if (!hidden && this.active && document.body.classList.contains('gamepad-nav')) {
      this.panel.focusFirst();
    }
  }

  /**
   * @param {number} dt Real frame time.
   * @param {import('../core/Input.js').Input['state']} input
   */
  update(dt, input) {
    const fov = this.freeCam.fov;
    this.freeCam.update(dt, input);
    if (this.freeCam.fov !== fov) {
      this.params.fov = this.freeCam.fov;
      this.panel.sync();
    }
    if (input.capture) this.capture();
    if (input.hideUi) this.setUiHidden(!this.uiHidden);
    if (input.focusPup) this.focusOnPup();
  }

  /** Render a fresh frame and save it as a PNG. */
  capture() {
    const src = this.renderer.three.domElement;
    // The drawing buffer is only guaranteed to hold the frame within the task
    // that rendered it, so render and copy synchronously.
    this.renderFrame();
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(src, 0, 0);
    if (this.params.watermark) drawWatermark(ctx, out.width, out.height);
    const name = `${PHOTO.filePrefix}_${stamp()}.png`;
    this.flash.classList.remove('is-flashing');
    void this.flash.offsetWidth;
    this.flash.classList.add('is-flashing');
    out.toBlob((blob) => {
      if (!blob) {
        this.bus.emit(Events.UI_TOAST, { message: 'Could not save the photo' });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      const payload = this._capturePayload;
      payload.name = name;
      payload.width = out.width;
      payload.height = out.height;
      this.bus.emit(Events.PHOTO_CAPTURED, payload);
      this.bus.emit(Events.UI_TOAST, { message: `Saved ${name}` });
    }, 'image/png');
  }

  dispose() {
    this.exit();
    this.panel.dispose();
    this.flash.remove();
  }
}
