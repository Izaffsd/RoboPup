import { MathUtils, Vector3 } from 'three';
import { EMOTES } from '../config/config.js';

const TAU = Math.PI * 2;
const { smoothstep, lerp } = MathUtils;

/**
 * Pose layer an emote writes every frame. DogAnimator blends it over the
 * procedural locomotion pose with the emote's weight; every field is an
 * offset (or override weight), so an all-zero pose changes nothing.
 * Leg order: FL, FR, RL, RR.
 */
export function createPose() {
  return {
    /** Drives the built-in sit pose (0..1). */
    sit: 0,
    /** Body height offset (m) and pitch offset (rad, + = nose down). */
    bodyY: 0,
    pitch: 0,
    /** Body roll (rad) added after smoothing, so a full roll stays exact. */
    roll: 0,
    /** Hip wiggle (rad). */
    yaw: 0,
    shiftX: 0,
    shiftZ: 0,
    /** Forward offset (m) of the planted front / rear paws. */
    frontShift: 0,
    rearShift: 0,
    /** Per-leg weight of a body-space foot target (relative to the hip). */
    legW: [0, 0, 0, 0],
    leg: [new Vector3(), new Vector3(), new Vector3(), new Vector3()],
    /** Head offsets (rad) and how much idle look-around is suppressed. */
    neck: 0,
    head: 0,
    headYaw: 0,
    tilt: 0,
    lookW: 0,
    jaw: 0,
    /** Ear offsets: x folds back (−) / forward (+), z droops outward. */
    earX: 0,
    earZ: 0,
    /** Tail override (weight, amplitude rad, frequency Hz, lift rad). */
    tailW: 0,
    tailAmp: 0,
    tailFreq: 0,
    tailLift: 0,
  };
}

/** @param {ReturnType<typeof createPose>} p */
export function resetPose(p) {
  p.sit = p.bodyY = p.pitch = p.roll = p.yaw = p.shiftX = p.shiftZ = 0;
  p.frontShift = p.rearShift = 0;
  for (let i = 0; i < 4; i++) {
    p.legW[i] = 0;
    p.leg[i].set(0, 0, 0);
  }
  p.neck = p.head = p.headYaw = p.tilt = p.lookW = p.jaw = 0;
  p.earX = p.earZ = 0;
  p.tailW = p.tailAmp = p.tailFreq = p.tailLift = 0;
}

function tail(p, amp, freq, lift) {
  p.tailW = 1;
  p.tailAmp = amp;
  p.tailFreq = freq;
  p.tailLift = lift;
}

/** Body height offset that puts the torso centre `h` metres above the paws. */
const lieAt = (h, rideHeight) => h - rideHeight;

/**
 * Emote definitions.
 *  - `duration`: seconds for one-shots; `Infinity` holds until cancelled.
 *  - `face`: LED expression while performing.
 *  - `locomotion`: the controller drives movement (zoomies); otherwise the
 *    pup stands still.
 *  - `pose(t, p, rideHeight)`: writes the pose layer at time t.
 */
export const EMOTE_DEFS = Object.freeze({
  sit: {
    duration: Infinity,
    face: 'happy',
    pose(t, p) {
      p.sit = 1;
      p.tilt = 0.14 * Math.sin(t * 0.9);
      tail(p, 0.42, 2.6, 0.1);
    },
  },

  beg: {
    duration: Infinity,
    face: 'curious',
    pose(t, p) {
      // Sitting upright on the haunches, front paws paddling at chest height.
      p.bodyY = -0.064 + 0.006 * Math.sin(t * 3.1);
      p.pitch = -1.0;
      p.shiftZ = -0.06;
      p.rearShift = 0.16;
      for (const li of [0, 1]) {
        const ph = t * 7 + li * Math.PI;
        p.legW[li] = 1;
        p.leg[li].set(
          li === 0 ? -0.012 : 0.012,
          -0.15 + 0.025 * Math.max(0, Math.sin(ph)),
          0.1 + 0.03 * Math.sin(ph),
        );
      }
      p.head = 0.32;
      p.lookW = 1;
      p.tilt = 0.18 * Math.sin(t * 1.4);
      p.earX = 0.2;
      tail(p, 0.6, 4.5, -0.25);
    },
  },

  wag: {
    duration: EMOTES.wagDuration,
    face: 'happy',
    pose(t, p) {
      const ph = t * TAU * 3.2;
      p.yaw = -0.075 * Math.sin(ph);
      p.bodyY = 0.008 * Math.sin(ph * 2);
      p.head = -0.1;
      p.tilt = 0.2 * Math.sin(t * 2.3);
      p.lookW = 0.6;
      p.earZ = 0.12 * Math.sin(ph);
      p.earX = 0.15;
      tail(p, 0.95, 3.2, 0.95);
    },
  },

  zoomies: {
    duration: EMOTES.zoomiesDuration,
    face: 'excited',
    locomotion: true,
    pose(t, p) {
      p.lookW = 0.5;
      p.jaw = 0.18;
      tail(p, 0.45, 6, 0.7);
    },
  },

  rollOver: {
    duration: EMOTES.rollOverDuration,
    face: 'excited',
    pose(t, p, rideHeight) {
      // 0–0.45 s lie down · 0.45–1.0 roll onto the back · 1.0–1.75 paws in
      // the air · 1.75–2.25 finish the roll · then lie until the blend-out.
      const down = smoothstep(t, 0, 0.45);
      let roll = 0;
      if (t < 0.45) roll = 0;
      else if (t < 1.0) roll = Math.PI * smoothstep(t, 0.45, 1.0);
      else if (t < 1.75) roll = Math.PI;
      else if (t < 2.25) roll = Math.PI * (1 + smoothstep(t, 1.75, 2.25));
      // A full turn is the upright pose again; returning exactly 0 keeps the
      // blend-out from unwinding the roll.
      if (t >= 2.25) roll = 0;
      p.roll = roll;
      const side = Math.abs(Math.sin(roll));
      p.bodyY = lerp(0, lieAt(0.15 + 0.05 * side, rideHeight), down);
      p.shiftX = -0.08 * Math.sin(roll);
      const onBack = smoothstep(t, 0.9, 1.05) * (1 - smoothstep(t, 1.7, 1.85));
      for (let li = 0; li < 4; li++) {
        const ph = t * 14 + li * 1.7;
        p.legW[li] = smoothstep(t, 0.05, 0.35);
        p.leg[li].set(
          0,
          lerp(-0.12, -0.17 + 0.035 * Math.sin(ph), onBack),
          lerp(li < 2 ? 0.04 : -0.01, 0.03 * Math.sin(ph + 1), onBack),
        );
      }
      p.neck = 0.15 * down;
      p.tilt = 0.25 * onBack * Math.sin(t * 5);
      p.lookW = 1;
      p.jaw = 0.25 * onBack;
      p.earX = -0.3 * down;
      p.earZ = 0.2 * onBack;
      tail(p, 0.7, 6, 0.2);
    },
  },

  playBow: {
    duration: Infinity,
    face: 'excited',
    pose(t, p) {
      // Chest down, rear up, tail flagging; a little bounce every second.
      const bounce = Math.max(0, Math.sin(t * TAU * 0.9)) ** 4;
      p.pitch = 0.38 - 0.06 * bounce;
      p.bodyY = -0.06 + 0.02 * bounce;
      p.frontShift = 0.14;
      p.yaw = 0.06 * Math.sin(t * TAU * 1.6);
      p.head = -0.25;
      p.tilt = 0.2 * Math.sin(t * 2);
      p.lookW = 1;
      p.jaw = 0.12;
      p.earX = 0.15;
      tail(p, 0.85, 4.2, 1.05);
    },
  },

  sleep: {
    duration: Infinity,
    face: 'sleep',
    pose(t, p, rideHeight) {
      // Lying down "sphinx" style: front paws stretched forward, rear paws
      // tucked, chin lowered, slow breathing.
      p.bodyY = lieAt(0.15, rideHeight) + 0.005 * Math.sin(t * 1.7);
      p.pitch = 0.04;
      p.shiftZ = 0.02;
      for (let li = 0; li < 4; li++) {
        p.legW[li] = 1;
        if (li < 2) p.leg[li].set(0, -0.035, 0.2);
        else p.leg[li].set(li === 2 ? 0.03 : -0.03, -0.035, 0.05);
      }
      p.neck = 0.45;
      p.head = 0.25 + 0.02 * Math.sin(t * 1.7);
      p.tilt = 0.12;
      p.lookW = 1;
      p.earX = -0.5;
      p.earZ = 0.25;
      tail(p, 0.04, 0.6, -0.5);
    },
  },
});
