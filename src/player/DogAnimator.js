import { MathUtils, Matrix4, Vector3 } from 'three';
import { ANIMATION, EMOTES, PLAYER } from '../config/config.js';
import { Events } from '../core/EventBus.js';
import { createPose, EMOTE_DEFS, resetPose } from './emotePoses.js';
import { solveLeg } from './LegIK.js';

const TAU = Math.PI * 2;
const { damp, clamp, lerp, smoothstep } = MathUtils;

/** Phase offsets per leg for [walk, trot, gallop]. */
const GAIT_OFFSETS = Object.freeze({
  FL: [0.25, 0.0, 0.5],
  FR: [0.75, 0.5, 0.62],
  RL: [0.0, 0.5, 0.0],
  RR: [0.5, 0.0, 0.12],
});

const _v = new Vector3();
const _v2 = new Vector3();
const _hipW = new Vector3();
const _inv = new Matrix4();
const _ik = { hipPitch: 0, hipRoll: 0, kneePitch: 0, reach: 0 };

const ease = (t) => t * t * (3 - 2 * t);

/** Damped spring for secondary motion. */
class Spring {
  constructor(stiffness, damping) {
    this.k = stiffness;
    this.c = damping;
    this.x = 0;
    this.v = 0;
  }
  step(target, force, dt) {
    const steps = 2;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = this.k * (target - this.x) - this.c * this.v + force;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

/**
 * Procedural quadruped animation.
 *
 * - Gait cycle synced to ground speed: stride length grows with speed and the
 *   cycle frequency is speed / stride, so planted feet never slide. Phase
 *   offsets blend continuously from a lateral-sequence walk to a trot to a
 *   rotary gallop.
 * - World-space foot planting with swing arcs; swing targets are predicted
 *   from velocity and ray-cast onto the physics world, so feet land on ramps,
 *   steps and domes (IK foot placement on uneven ground). Idle feet re-step
 *   when the body turns in place.
 * - Body height/pitch/roll follow the planted feet, plus gait bob, lean into
 *   acceleration and turns, idle breathing, a sit pose after idling, jump
 *   tuck/stretch and a spring-driven landing crouch.
 * - Analytic 2-bone IK per leg, paws kept level with the ground.
 * - Secondary motion: tail wag tied to speed/state, spring-driven ears and
 *   antenna, head look-around and bark animation.
 * - Emotes (see emotePoses.js): a pose layer blended over everything above
 *   with its own weight — body offsets and roll, body-space paw targets that
 *   take over from the planted feet, head, ear and tail overrides.
 *
 * Every blend weight is exponentially damped, so state changes never pop.
 * The LED face is driven separately by FaceController.
 */
export class DogAnimator {
  /**
   * @param {import('./RobotDog.js').RobotDog} dog
   * @param {import('../physics/PhysicsWorld.js').PhysicsWorld} physics
   * @param {import('../core/EventBus.js').EventBus} bus
   * @param {any} excludeCollider The character's collider (ignored by foot rays).
   */
  constructor(dog, physics, bus, excludeCollider) {
    this.dog = dog;
    this.physics = physics;
    this.bus = bus;
    this.exclude = excludeCollider;
    this.rayFlags =
      physics.RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC |
      physics.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    const bones = dog.bones;

    this.legs = bones.legs.map((b) => {
      const hip = b.hip.position.clone();
      return {
        ...b,
        hipLocal: hip,
        rest: new Vector3(hip.x * 1.08, 0, hip.z + (b.front ? 0.015 : -0.01)),
        offset: GAIT_OFFSETS[b.name][0],
        planted: new Vector3(),
        swingFrom: new Vector3(),
        target: new Vector3(),
        footPos: new Vector3(),
        groundY: 0,
        inSwing: false,
        swingT: 0,
        kneeSign: b.front ? ANIMATION.kneeDirectionFront : ANIMATION.kneeDirectionRear,
      };
    });

    this.phase = 0;
    this.freq = 0;
    this.speed = 0;
    this.speedNorm = 0;
    this.gaitTrot = 0;
    this.gaitGallop = 0;
    this.duty = ANIMATION.dutyWalk;
    this.air = 0;
    this.sit = 0;
    this.idleTime = 0;
    this.bodyY = 0;
    this.bodyPitch = 0;
    this.bodyRoll = 0;
    this.bodySway = 0;
    this.terrainPitch = 0;
    this.terrainRoll = 0;
    this.landT = 1;
    this.landImpact = 0;
    this.barkT = 1;
    this.wagPhase = 0;
    this.tailAmp = ANIMATION.tailIdle.amp;
    this.tailFreq = ANIMATION.tailIdle.freq;
    this.tailLift = ANIMATION.tailIdle.lift;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.headTilt = 0;
    this.lookTargetYaw = 0;
    this.lookTargetPitch = 0;
    this.tiltTarget = 0;
    this.lookTimer = 2;
    /** Jaw opening from the bark animation (read by the face). */
    this.jawOpen = 0;
    this.prevBodyWorldY = 0;
    this.bodyVelY = 0;
    this.prevSpeed = 0;
    this.accelSmoothed = 0;
    this.earL = new Spring(ANIMATION.earStiffness, ANIMATION.earDamping);
    this.earR = new Spring(ANIMATION.earStiffness, ANIMATION.earDamping);
    this.earSideL = new Spring(ANIMATION.earStiffness * 0.8, ANIMATION.earDamping);
    this.earSideR = new Spring(ANIMATION.earStiffness * 0.8, ANIMATION.earDamping);
    this.antennaX = new Spring(60, 4);
    this.antennaZ = new Spring(60, 4);
    this._initialised = false;
    this._footstep = { leg: 0, intensity: 0, x: 0, y: 0, z: 0 };

    /** Current emote definition (kept while blending out), its id, time and weight. */
    this.emote = null;
    this.emoteId = '';
    this.emoteT = 0;
    this.emoteW = 0;
    this._emoteActive = false;
    this.pose = createPose();
    this.frontShift = 0;
    this.rearShift = 0;
  }

  /**
   * Start an emote's pose layer (see EmoteSystem for the gameplay side).
   * @param {string} id Key of EMOTE_DEFS.
   */
  playEmote(id) {
    const def = EMOTE_DEFS[id];
    if (!def) return;
    this.emote = def;
    this.emoteId = id;
    this.emoteT = 0;
    this._emoteActive = true;
    this.idleTime = 0;
  }

  /** Blend the current emote out (its pose freezes while it fades). */
  stopEmote() {
    this._emoteActive = false;
  }

  /** Snap all feet under the body (spawn / teleport). */
  resetPose(rootPos, yaw) {
    for (const leg of this.legs) {
      this._restWorld(leg, rootPos, yaw, leg.planted);
      leg.planted.y = this._groundAt(leg.planted.x, rootPos.y + 0.6, leg.planted.z, rootPos.y);
      leg.footPos.copy(leg.planted);
      leg.target.copy(leg.planted);
      leg.inSwing = false;
    }
    this._initialised = true;
  }

  /** Start the bark head/jaw/ear animation. */
  triggerBark() {
    this.barkT = 0;
    this.idleTime = 0;
  }

  /**
   * Landing reaction.
   * @param {number} impactSpeed Downward speed at touchdown (m/s).
   * @param {import('three').Vector3} rootPos
   */
  onLand(impactSpeed, rootPos) {
    this.landT = 0;
    this.landImpact = clamp(impactSpeed / 8, 0.15, 1);
    for (const leg of this.legs) {
      // Plant each paw right where it touched down.
      leg.planted.copy(leg.footPos);
      leg.planted.y = this._groundAt(leg.planted.x, rootPos.y + 0.6, leg.planted.z, rootPos.y);
      leg.inSwing = false;
    }
    this.idleTime = 0;
  }

  _restWorld(leg, rootPos, yaw, out) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const rx = leg.rest.x;
    const rz = leg.rest.z + (leg.front ? this.frontShift : this.sit * 0.12 + this.rearShift);
    out.set(rootPos.x + rx * c + rz * s, rootPos.y, rootPos.z - rx * s + rz * c);
    return out;
  }

  _groundAt(x, fromY, z, fallback) {
    const t = this.physics.castRay(x, fromY, z, 0, -1, 0, 1.4, this.rayFlags, this.exclude);
    return t < 0 ? fallback : fromY - t;
  }

  /**
   * Advance the animation.
   * @param {number} dt
   * @param {object} s Character state.
   * @param {Vector3} s.rootPos Interpolated feet position (world).
   * @param {number} s.yaw Facing yaw.
   * @param {Vector3} s.velocity Smoothed world velocity.
   * @param {boolean} s.grounded
   * @param {number} s.turnRate Yaw rate (rad/s).
   * @param {number} s.time Elapsed seconds.
   * @param {Vector3} [s.lookAt] Optional point of interest (camera) for idle looks.
   */
  update(dt, s) {
    if (!this._initialised) this.resetPose(s.rootPos, s.yaw);
    // Emote timing uses the real frame time (like EmoteSystem's timer) so a
    // one-shot emote plays in full even at very low frame rates; everything
    // else integrates with a clamped step for stability.
    const frameDt = dt;
    dt = Math.min(dt, 1 / 20);
    const A = ANIMATION;
    const dog = this.dog;
    const bones = dog.bones;

    // ------------------------------------------------------------ emote layer
    const P = this.pose;
    if (this.emote) {
      if (this._emoteActive) this.emoteT += frameDt;
      this.emoteW = damp(
        this.emoteW,
        this._emoteActive ? 1 : 0,
        this._emoteActive ? EMOTES.blendIn : EMOTES.blendOut,
        frameDt,
      );
      resetPose(P);
      this.emote.pose(this.emoteT, P, A.rideHeight);
      if (!this._emoteActive && this.emoteW < 0.002) {
        this.emote = null;
        this.emoteId = '';
        this.emoteW = 0;
        resetPose(P);
      }
    }
    const w = this.emote ? this.emoteW : 0;
    this.frontShift = w * P.frontShift;
    this.rearShift = w * P.rearShift;

    // ------------------------------------------------------------ blend params
    const hSpeed = Math.hypot(s.velocity.x, s.velocity.z);
    this.speed = damp(this.speed, s.grounded ? hSpeed : this.speed, A.blendRate, dt);
    this.speedNorm = clamp(this.speed / PLAYER.runSpeed, 0, 1);
    this.air = damp(this.air, s.grounded ? 0 : 1, s.grounded ? 14 : 8, dt);
    const moving = this.speed > PLAYER.idleSpeedThreshold;
    this.idleTime = moving || !s.grounded ? 0 : this.idleTime + dt;
    const idleSit = this.idleTime > A.sitDelay ? 1 : 0;
    const sitTarget = lerp(idleSit, P.sit, w);
    this.sit = damp(this.sit, sitTarget, sitTarget > this.sit ? (w > 0.5 ? 5 : 1.8) : 7, dt);
    const accel = (this.speed - this.prevSpeed) / Math.max(dt, 1e-3);
    this.prevSpeed = this.speed;
    this.accelSmoothed = damp(this.accelSmoothed, clamp(accel, -12, 12), 6, dt);

    this.gaitTrot = damp(
      this.gaitTrot,
      smoothstep(this.speed, A.gaitTrotSpeed - 0.6, A.gaitTrotSpeed),
      A.gaitOffsetRate,
      dt,
    );
    this.gaitGallop = damp(
      this.gaitGallop,
      smoothstep(this.speed, A.gaitGallopSpeed - 0.6, A.gaitGallopSpeed + 0.4),
      A.gaitOffsetRate,
      dt,
    );
    this.duty = lerp(lerp(A.dutyWalk, A.dutyTrot, this.gaitTrot), A.dutyGallop, this.gaitGallop);
    const swingFrac = 1 - this.duty;

    // ------------------------------------------------------------ gait clock
    let needStep = false;
    let swinging = false;
    for (const leg of this.legs) {
      this._restWorld(leg, s.rootPos, s.yaw, _v);
      const dx = leg.planted.x - _v.x;
      const dz = leg.planted.z - _v.z;
      if (dx * dx + dz * dz > A.restStepThreshold * A.restStepThreshold) needStep = true;
      if (leg.inSwing) swinging = true;
    }
    if (s.grounded && moving) {
      const stride = clamp(A.strideBase + this.speed * A.strideScale, A.strideBase, A.strideMax);
      this.freq = this.speed / stride;
    } else if (s.grounded && (needStep || swinging || Math.abs(s.turnRate) > 0.6)) {
      this.freq = A.idleStepFrequency;
    } else {
      this.freq = 0;
    }
    this.phase = (this.phase + this.freq * dt) % 1;

    // ------------------------------------------------------------ feet
    const stance = this.freq > 0 ? this.duty / this.freq : 0;
    const stepHeight = lerp(A.stepHeightWalk, A.stepHeightRun, this.speedNorm);
    let frontY = 0;
    let rearY = 0;
    let leftY = 0;
    let rightY = 0;
    for (let li = 0; li < this.legs.length; li++) {
      const leg = this.legs[li];
      if (w * P.legW[li] > 0.5) {
        // The emote owns this paw: keep its planted spot under the body so
        // the blend-out lands it there without stepping (or footstep sounds).
        this._restWorld(leg, s.rootPos, s.yaw, leg.planted);
        leg.footPos.copy(leg.planted);
        leg.target.copy(leg.planted);
        leg.inSwing = false;
        if (leg.front) frontY += s.rootPos.y * 0.5;
        else rearY += s.rootPos.y * 0.5;
        if (leg.left) leftY += s.rootPos.y * 0.5;
        else rightY += s.rootPos.y * 0.5;
        continue;
      }
      const o = GAIT_OFFSETS[leg.name];
      const targetOffset = lerp(lerp(o[0], o[1], this.gaitTrot), o[2], this.gaitGallop);
      leg.offset = damp(leg.offset, targetOffset, A.gaitOffsetRate, dt);
      const legPhase = (this.phase + leg.offset + 1) % 1;
      const wantSwing = s.grounded && this.freq > 0 && legPhase < swingFrac;

      if (wantSwing) {
        if (!leg.inSwing) {
          leg.inSwing = true;
          leg.swingFrom.copy(leg.footPos);
        }
        leg.swingT = legPhase / swingFrac;
        this._restWorld(leg, s.rootPos, s.yaw, leg.target);
        if (moving) leg.target.addScaledVector(s.velocity, stance * 0.5).setY(s.rootPos.y);
        leg.target.y = this._groundAt(leg.target.x, s.rootPos.y + 0.6, leg.target.z, s.rootPos.y);
        const t = ease(leg.swingT);
        leg.footPos.lerpVectors(leg.swingFrom, leg.target, t);
        const climb = Math.max(0, leg.target.y - leg.swingFrom.y);
        leg.footPos.y += Math.sin(Math.PI * leg.swingT) * (stepHeight + climb * 0.6);
      } else {
        if (leg.inSwing) {
          leg.inSwing = false;
          leg.planted.copy(leg.target);
          if (s.grounded) this._emitFootstep(li, leg);
        }
        if (s.grounded) leg.footPos.copy(leg.planted);
      }

      // Airborne pose: tuck while rising, reach while falling.
      if (this.air > 0.001) {
        const vy = s.velocity.y;
        const rising = smoothstep(vy, -1, 2);
        const lx = leg.hipLocal.x * 1.05;
        let ly =
          leg.hipLocal.y +
          A.rideHeight -
          (leg.front ? lerp(0.3, 0.2, rising) : lerp(0.28, 0.21, rising));
        const lz =
          leg.hipLocal.z + (leg.front ? lerp(0.11, 0.13, rising) : lerp(-0.14, -0.04, rising));
        ly -= 0.02;
        const c = Math.cos(s.yaw);
        const sn = Math.sin(s.yaw);
        _v2.set(s.rootPos.x + lx * c + lz * sn, s.rootPos.y + ly, s.rootPos.z - lx * sn + lz * c);
        if (!s.grounded) {
          leg.footPos.lerp(_v2, clamp(this.air * 1.2, 0, 1));
        }
      }

      const gy = leg.inSwing ? leg.target.y : leg.planted.y;
      if (leg.front) frontY += gy * 0.5;
      else rearY += gy * 0.5;
      if (leg.left) leftY += gy * 0.5;
      else rightY += gy * 0.5;
    }

    // ------------------------------------------------------------ body
    const groundAvg = (frontY + rearY) * 0.5;
    const groundOffset = s.grounded ? clamp(groundAvg - s.rootPos.y, -0.25, 0.25) : 0;
    this.terrainPitch = damp(
      this.terrainPitch,
      s.grounded ? -Math.atan2(frontY - rearY, 0.4) : 0,
      A.bodyTiltRate,
      dt,
    );
    this.terrainRoll = damp(
      this.terrainRoll,
      s.grounded ? Math.atan2(leftY - rightY, 0.27) * 0.6 : 0,
      A.bodyTiltRate,
      dt,
    );

    const trotBob =
      (0.5 + 0.5 * Math.cos(this.phase * TAU * 2)) *
      (0.006 + 0.014 * this.speedNorm) *
      (1 - this.gaitGallop);
    const gallopBob = (0.5 + 0.5 * Math.cos(this.phase * TAU)) * 0.03 * this.gaitGallop;
    const gallopPitch = Math.sin(this.phase * TAU) * 0.07 * this.gaitGallop;
    const breathe = Math.sin(s.time * 2.1) * 0.004 * (1 - this.speedNorm);
    this.landT = Math.min(1, this.landT + dt / A.landDuration);
    const land =
      this.landT < 1
        ? Math.sin(this.landT * Math.PI) * (1 - this.landT * 0.4) * this.landImpact
        : 0;

    const targetY =
      groundOffset * 0.7 -
      trotBob -
      gallopBob +
      breathe -
      land * 0.09 -
      this.sit * 0.1 +
      w * P.bodyY;
    this.bodyY = damp(this.bodyY, targetY, A.bodyHeightRate, dt);
    const lean = clamp(this.accelSmoothed * A.accelPitch * 0.1, -A.maxLean, A.maxLean);
    const airPitch = this.air * clamp(-s.velocity.y * 0.06, -0.3, 0.25);
    const pitchTarget =
      this.terrainPitch * (1 - this.air) +
      gallopPitch +
      lean +
      airPitch +
      land * 0.12 -
      this.sit * 0.42 +
      w * P.pitch;
    const rollTarget =
      clamp(-s.turnRate * this.speed * A.turnRoll, -A.maxLean, A.maxLean) + this.terrainRoll;
    this.bodyPitch = damp(this.bodyPitch, pitchTarget, A.bodyTiltRate, dt);
    this.bodyRoll = damp(this.bodyRoll, rollTarget, A.bodyTiltRate, dt);
    this.bodySway = damp(
      this.bodySway,
      Math.sin(this.phase * TAU) * 0.01 * (1 - this.gaitGallop) * this.speedNorm,
      10,
      dt,
    );

    dog.object.position.copy(s.rootPos);
    dog.object.rotation.set(0, s.yaw, 0);
    bones.body.position.set(
      this.bodySway + w * P.shiftX,
      A.rideHeight + this.bodyY,
      -this.sit * 0.04 + w * P.shiftZ,
    );
    bones.body.rotation.set(this.bodyPitch, w * P.yaw, this.bodyRoll + w * P.roll);
    dog.object.updateMatrixWorld(true);

    // Body vertical velocity drives ear/antenna springs.
    bones.body.getWorldPosition(_v);
    const bodyVelY = (_v.y - this.prevBodyWorldY) / Math.max(dt, 1e-3);
    const bodyAccY = clamp((bodyVelY - this.bodyVelY) / Math.max(dt, 1e-3), -60, 60);
    this.bodyVelY = bodyVelY;
    this.prevBodyWorldY = _v.y;

    // ------------------------------------------------------------ leg IK
    _inv.copy(bones.body.matrixWorld).invert();
    const L1 = A.upperLegLength;
    const L2 = A.lowerLegLength;
    for (let li = 0; li < this.legs.length; li++) {
      const leg = this.legs[li];
      _v.copy(leg.footPos);
      _v.y += A.footRadius;
      _v.applyMatrix4(_inv);
      _hipW.copy(leg.hipLocal);
      const lw = w * P.legW[li];
      if (lw > 0) _v.lerp(_v2.copy(_hipW).add(P.leg[li]), lw);
      solveLeg(_v.x - _hipW.x, _v.y - _hipW.y, _v.z - _hipW.z, L1, L2, leg.kneeSign, _ik);
      leg.hip.rotation.set(_ik.hipPitch, 0, _ik.hipRoll);
      leg.knee.rotation.set(_ik.kneePitch, 0, 0);
      const level =
        -(_ik.hipPitch + _ik.kneePitch) - this.bodyPitch * (1 - this.air) + this.terrainPitch * 0.6;
      leg.foot.rotation.set(
        (level + this.air * 0.35 * (leg.front ? -1 : 1)) * (1 - lw),
        0,
        (-_ik.hipRoll - this.bodyRoll * 0.5) * (1 - lw),
      );
    }

    // ------------------------------------------------------------ head & bark
    this.barkT = Math.min(1, this.barkT + dt / A.barkDuration);
    const bt = this.barkT;
    const barkPitch =
      bt < 1
        ? (bt < 0.25 ? -0.35 * ease(bt / 0.25) : -0.35 + 0.55 * ease((bt - 0.25) / 0.75)) * (1 - bt)
        : 0;
    const jawOpen = bt < 1 ? Math.sin(Math.min(1, bt / 0.6) * Math.PI) * 0.5 : 0;
    this.jawOpen = jawOpen;
    const lookW = w * P.lookW;

    this.lookTimer -= dt;
    if (this.lookTimer <= 0) {
      this.lookTimer = 1.6 + Math.random() * 3;
      if (!moving && s.lookAt && Math.random() < 0.45) {
        _v.copy(s.lookAt).sub(s.rootPos);
        const local = Math.atan2(_v.x, _v.z) - s.yaw;
        const yaw = Math.atan2(Math.sin(local), Math.cos(local));
        this.lookTargetYaw = Math.abs(yaw) < 1.6 ? clamp(yaw, -0.7, 0.7) : 0;
        this.lookTargetPitch = -0.15;
      } else {
        this.lookTargetYaw = moving ? 0 : (Math.random() - 0.5) * 1.1;
        this.lookTargetPitch = moving ? 0 : (Math.random() - 0.5) * 0.4;
      }
      this.tiltTarget = !moving && Math.random() < 0.3 ? (Math.random() < 0.5 ? -0.28 : 0.28) : 0;
    }
    const moveYaw = clamp(s.turnRate * 0.14, -0.45, 0.45);
    const yawTarget = (moving ? moveYaw : this.lookTargetYaw) * (1 - lookW);
    const pitchTargetHead =
      ((moving ? -this.speedNorm * 0.1 : this.lookTargetPitch) -
        this.terrainPitch * 0.4 +
        this.sit * 0.35 +
        this.air * 0.12) *
      (1 - lookW);
    this.lookYaw = damp(this.lookYaw, yawTarget, 5, dt);
    this.lookPitch = damp(this.lookPitch, pitchTargetHead, 5, dt);
    this.headTilt = damp(this.headTilt, moving ? 0 : this.tiltTarget * (1 - lookW), 3, dt);
    bones.neck.rotation.set(
      this.lookPitch * 0.6 - this.bodyPitch * 0.5 + w * P.neck,
      this.lookYaw * 0.6,
      0,
    );
    bones.head.rotation.set(
      this.lookPitch * 0.4 + barkPitch + w * P.head,
      this.lookYaw * 0.4 + w * P.headYaw,
      this.headTilt + w * P.tilt,
    );
    const pant = moving ? Math.max(0, Math.sin(s.time * 9)) * 0.06 * this.speedNorm : 0;
    bones.jaw.rotation.x = jawOpen + pant + w * P.jaw;

    // ------------------------------------------------------------ ears & antenna
    const barkFlick = bt < 0.4 ? -1.2 * Math.sin((bt / 0.4) * Math.PI) : 0;
    const earBase = -0.05 - this.speedNorm * 0.45 + this.sit * 0.1 + w * P.earX;
    const earForce = -bodyAccY * 0.06 + barkFlick * 40;
    bones.earL.rotation.x = this.earL.step(earBase, earForce, dt);
    bones.earR.rotation.x = this.earR.step(earBase, earForce * 0.92, dt);
    const sideForce = -s.turnRate * this.speed * 1.4 + bodyAccY * 0.02;
    const droop = w * P.earZ;
    bones.earL.rotation.z = this.earSideL.step(
      -0.05 - this.speedNorm * 0.15 - droop,
      sideForce,
      dt,
    );
    bones.earR.rotation.z = this.earSideR.step(0.05 + this.speedNorm * 0.15 + droop, sideForce, dt);
    bones.antenna.rotation.x = this.antennaX.step(
      -this.speedNorm * 0.4,
      -bodyAccY * 0.08 - this.accelSmoothed * 0.6,
      dt,
    );
    bones.antenna.rotation.z = this.antennaZ.step(0, -s.turnRate * this.speed * 2, dt);

    // ------------------------------------------------------------ tail
    const st = this._tailState(moving, bt < 1);
    const tw = w * P.tailW;
    this.tailAmp = damp(this.tailAmp, lerp(st.amp, P.tailAmp, tw), 4, dt);
    this.tailFreq = damp(this.tailFreq, lerp(st.freq, P.tailFreq, tw), 4, dt);
    this.tailLift = damp(this.tailLift, lerp(st.lift - this.sit * 0.7, P.tailLift, tw), 4, dt);
    this.wagPhase = (this.wagPhase + this.tailFreq * dt * TAU) % (TAU * 1000);
    for (let k = 0; k < bones.tail.length; k++) {
      const seg = bones.tail[k];
      seg.rotation.x =
        this.tailLift * (k === 0 ? 1 : 0.35) +
        (k > 0 ? Math.sin(this.phase * TAU * 2) * 0.05 * this.speedNorm : 0);
      seg.rotation.y = Math.sin(this.wagPhase - k * 0.8) * this.tailAmp * (0.7 + k * 0.35);
    }
  }

  _tailState(moving, barking) {
    const A = ANIMATION;
    if (barking) return A.tailBark;
    if (this.air > 0.5) return A.tailAir;
    if (!moving) return A.tailIdle;
    return this.speedNorm > 0.6 ? A.tailRun : A.tailWalk;
  }

  _emitFootstep(li, leg) {
    const p = this._footstep;
    p.leg = li;
    p.intensity = this.speed > PLAYER.idleSpeedThreshold ? 0.35 + this.speedNorm * 0.65 : 0.25;
    p.x = leg.planted.x;
    p.y = leg.planted.y;
    p.z = leg.planted.z;
    this.bus.emit(Events.PLAYER_FOOTSTEP, p);
  }
}
