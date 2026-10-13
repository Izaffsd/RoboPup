import { Euler, MathUtils, Vector3 } from 'three';
import { PHOTO } from '../config/config.js';
import { BOUNDS } from '../world/layout.js';

const { clamp, degToRad } = MathUtils;
const _euler = new Euler(0, 0, 0, 'YXZ');
const _fwd = new Vector3();
const _right = new Vector3();
const _move = new Vector3();

/**
 * Free-fly camera for photo mode.
 *
 * - Fly with WASD / left stick / touch joystick (Shift = faster), E/Space and
 *   Q (RT/LT, ▲/▼) for up and down; look by dragging / right stick.
 * - Collides with the shelter (walls, furniture, the pup) using one swept
 *   sphere per axis, so it slides along surfaces instead of stopping dead,
 *   and is clamped inside the shelter's outer walls and below the ceiling.
 * - Field of view and roll come from the photo panel.
 */
export class PhotoCamera {
  /**
   * @param {object} deps
   * @param {import('three').PerspectiveCamera} deps.camera
   * @param {import('../physics/PhysicsWorld.js').PhysicsWorld} deps.physics
   */
  constructor({ camera, physics }) {
    this.camera = camera;
    this.physics = physics;
    this.flags =
      physics.RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC |
      physics.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    this.position = new Vector3();
    this.yaw = 0;
    this.pitch = 0;
    /** Degrees. */
    this.roll = 0;
    this.fov = 60;
  }

  /** Start from the current gameplay camera pose. */
  begin() {
    const cam = this.camera;
    this.position.copy(cam.position);
    _euler.setFromQuaternion(cam.quaternion, 'YXZ');
    this.yaw = _euler.y;
    this.pitch = _euler.x;
    this.roll = 0;
    this.fov = cam.fov;
    this._apply();
  }

  /**
   * @param {number} dt Real frame time (the simulation is frozen).
   * @param {import('../core/Input.js').Input['state']} input
   */
  update(dt, input) {
    this.yaw -= input.lookX;
    this.pitch = clamp(this.pitch - input.lookY, -PHOTO.pitchLimit, PHOTO.pitchLimit);
    if (input.zoom !== 0) {
      this.fov = clamp(this.fov + input.zoom * PHOTO.wheelFovStep, PHOTO.fovMin, PHOTO.fovMax);
    }

    const speed = PHOTO.moveSpeed * (input.sprint ? PHOTO.fastMultiplier : 1);
    _fwd.set(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    _move
      .copy(_fwd)
      .multiplyScalar(input.moveY * speed)
      .addScaledVector(_right, input.moveX * speed);
    _move.y +=
      (input.up - input.down) * PHOTO.verticalSpeed * (input.sprint ? PHOTO.fastMultiplier : 1);
    _move.multiplyScalar(Math.min(dt, 0.1));
    if (_move.lengthSq() > 1e-10) {
      this._moveAxis(0, _move.x);
      this._moveAxis(2, _move.z);
      this._moveAxis(1, _move.y);
    }
    this._apply();
  }

  /** Sweep the collision sphere along one axis and stop just before contact. */
  _moveAxis(axis, delta) {
    if (Math.abs(delta) < 1e-6) return;
    const p = this.position;
    const dir = Math.sign(delta);
    const hit = this.physics.castSphere(
      p.x,
      p.y,
      p.z,
      axis === 0 ? dir : 0,
      axis === 1 ? dir : 0,
      axis === 2 ? dir : 0,
      Math.abs(delta),
      PHOTO.collisionRadius,
      this.flags,
    );
    // hit === 0 means we start inside something: let the camera move out.
    const travel = hit > 0 ? Math.max(0, hit - 0.01) * dir : delta;
    const m = PHOTO.boundsMargin;
    if (axis === 0) p.x = clamp(p.x + travel, BOUNDS.minX + m, BOUNDS.maxX - m);
    else if (axis === 2) p.z = clamp(p.z + travel, BOUNDS.minZ + m, BOUNDS.maxZ - m);
    else p.y = clamp(p.y + travel, PHOTO.minHeight, BOUNDS.ceiling - PHOTO.ceilingMargin);
  }

  _apply() {
    const cam = this.camera;
    cam.position.copy(this.position);
    _euler.set(this.pitch, this.yaw, degToRad(this.roll), 'YXZ');
    cam.quaternion.setFromEuler(_euler);
    if (cam.fov !== this.fov) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  /**
   * Distance from the camera to a point (for "focus on the pup").
   * @param {Vector3} point
   */
  distanceTo(point) {
    return this.position.distanceTo(point);
  }
}
