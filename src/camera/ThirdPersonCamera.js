import { MathUtils, Vector3 } from 'three';
import { CAMERA, PLAYER } from '../config/config.js';
import { Events } from '../core/EventBus.js';

const { damp, clamp } = MathUtils;
const _dir = new Vector3();
const _goal = new Vector3();

/**
 * MMORPG-style third-person orbit camera.
 *
 * - Orbit (yaw/pitch) from mouse drag, right stick or touch drag, with
 *   damped smoothing; multiplicative wheel/trigger zoom.
 * - Smooth follow of a point above the dog.
 * - Obstacle avoidance: a sphere (larger than the near-plane footprint) is
 *   swept from the follow point toward the desired camera position against
 *   the physics world. The camera snaps in instantly when something blocks
 *   the view and eases back out, so it never clips through walls or props.
 * - Fades the dog out when the camera is pushed very close to it.
 * - Slow cinematic orbit while menus are open.
 */
export class ThirdPersonCamera {
  /**
   * @param {object} deps
   * @param {import('three').PerspectiveCamera} deps.camera
   * @param {import('../physics/PhysicsWorld.js').PhysicsWorld} deps.physics
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {import('../core/SettingsStore.js').SettingsStore} deps.settings
   * @param {any} deps.excludeCollider The dog's collider.
   */
  constructor({ camera, physics, bus, settings, excludeCollider }) {
    this.camera = camera;
    this.physics = physics;
    this.exclude = excludeCollider;
    this.flags = physics.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    this.flagsStatic = this.flags | physics.RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC;
    this.targetYaw = PLAYER.spawn.yaw + Math.PI;
    this.yaw = this.targetYaw;
    this.targetPitch = CAMERA.pitchDefault;
    this.pitch = this.targetPitch;
    this.targetDistance = CAMERA.distanceDefault;
    this.distance = this.targetDistance;
    this.collisionDistance = this.distance;
    this.focus = new Vector3();
    this._initialised = false;
    /** Current dog opacity requested by the camera (0..1). */
    this.dogOpacity = 1;

    this._applyFov(settings.get('fov'));
    this._unsubs = [
      bus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
        if (key === 'fov') this._applyFov(value);
      }),
    ];
  }

  _applyFov(fov) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Place the camera behind a heading instantly.
   * @param {number} dogYaw
   */
  recenter(dogYaw) {
    this.targetYaw = dogYaw + Math.PI;
    // Keep the unwrapped angle continuous.
    const d = Math.atan2(Math.sin(this.targetYaw - this.yaw), Math.cos(this.targetYaw - this.yaw));
    this.targetYaw = this.yaw + d;
    this.targetPitch = CAMERA.pitchDefault;
  }

  /**
   * @param {number} dt
   * @param {Vector3} followPoint Dog feet position.
   * @param {{lookX:number, lookY:number, zoom:number}|null} look Player input (null in menus).
   */
  update(dt, followPoint, look) {
    if (look) {
      this.targetYaw -= look.lookX;
      this.targetPitch = clamp(this.targetPitch + look.lookY, CAMERA.pitchMin, CAMERA.pitchMax);
      if (look.zoom !== 0) {
        this.targetDistance = clamp(
          this.targetDistance * Math.exp(look.zoom * CAMERA.zoomStep),
          CAMERA.distanceMin,
          CAMERA.distanceMax,
        );
      }
    } else {
      // Menu backdrop: gentle cinematic orbit.
      this.targetYaw += CAMERA.menuOrbitSpeed * dt;
      this.targetPitch = damp(this.targetPitch, 0.22, 1.5, dt);
      this.targetDistance = damp(this.targetDistance, 4.6, 1.5, dt);
    }
    this.yaw = damp(this.yaw, this.targetYaw, CAMERA.rotationDamping, dt);
    this.pitch = damp(this.pitch, this.targetPitch, CAMERA.rotationDamping, dt);
    this.distance = damp(this.distance, this.targetDistance, CAMERA.zoomDamping, dt);

    _goal.set(followPoint.x, followPoint.y + CAMERA.targetHeight, followPoint.z);
    if (!this._initialised) {
      this.focus.copy(_goal);
      this._initialised = true;
    } else {
      this.focus.x = damp(this.focus.x, _goal.x, CAMERA.followDamping, dt);
      this.focus.z = damp(this.focus.z, _goal.z, CAMERA.followDamping, dt);
      this.focus.y = damp(this.focus.y, _goal.y, CAMERA.followDamping * 0.6, dt);
    }

    const cp = Math.cos(this.pitch);
    _dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);

    let hit = this.physics.castSphere(
      this.focus.x,
      this.focus.y,
      this.focus.z,
      _dir.x,
      _dir.y,
      _dir.z,
      this.distance,
      CAMERA.collisionRadius,
      this.flags,
      this.exclude,
    );
    if (hit === 0) {
      // The sweep starts inside something (a toy pressed against the dog):
      // ignore dynamic bodies rather than collapsing onto the follow point.
      hit = this.physics.castSphere(
        this.focus.x,
        this.focus.y,
        this.focus.z,
        _dir.x,
        _dir.y,
        _dir.z,
        this.distance,
        CAMERA.collisionRadius,
        this.flagsStatic,
        this.exclude,
      );
    }
    const allowed = hit < 0 ? this.distance : Math.max(0.05, hit - CAMERA.collisionMargin);
    if (allowed < this.collisionDistance) this.collisionDistance = allowed;
    else
      this.collisionDistance = damp(
        this.collisionDistance,
        allowed,
        CAMERA.collisionRecoverRate,
        dt,
      );

    const cam = this.camera;
    cam.position.copy(this.focus).addScaledVector(_dir, this.collisionDistance);
    cam.lookAt(this.focus);
    this.dogOpacity = clamp(
      (this.collisionDistance - 0.35) / (CAMERA.dogFadeDistance - 0.35),
      0,
      1,
    );
  }

  dispose() {
    for (const u of this._unsubs) u();
  }
}
