const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Analytic two-bone IK for a quadruped leg with a 2-DOF hip (abduction about
 * the body's forward axis, then flexion about the leg's lateral axis) and a
 * 1-DOF knee.
 *
 * Bones point straight down (−Y) in their rest pose. The resulting angles are
 * meant for Euler order 'ZXY' on the hip (R = Rz(roll) · Rx(pitch)) and an X
 * rotation on the knee. Positive pitch swings the foot backwards (−Z).
 *
 * @param {number} dx Hip→foot target in body space (x: lateral).
 * @param {number} dy Hip→foot target in body space (y: up, usually negative).
 * @param {number} dz Hip→foot target in body space (z: forward).
 * @param {number} upper Upper leg length.
 * @param {number} lower Lower leg length.
 * @param {number} kneeSign +1: knee points backwards, −1: forwards.
 * @param {{hipPitch:number, hipRoll:number, kneePitch:number, reach:number}} out
 * @returns {typeof out}
 */
export function solveLeg(dx, dy, dz, upper, lower, kneeSign, out) {
  out.hipRoll = Math.atan2(dx, Math.max(1e-4, -dy));
  const inPlaneDown = Math.hypot(dx, dy);
  const raw = Math.hypot(inPlaneDown, dz);
  const dist = clamp(raw, 0.05, upper + lower - 1e-4);
  const phi = Math.atan2(dz, inPlaneDown);
  const cosA = clamp((upper * upper + dist * dist - lower * lower) / (2 * upper * dist), -1, 1);
  const cosB = clamp((upper * upper + lower * lower - dist * dist) / (2 * upper * lower), -1, 1);
  const alpha = Math.acos(cosA);
  const beta = Math.acos(cosB);
  out.hipPitch = -phi + kneeSign * alpha;
  out.kneePitch = -kneeSign * (Math.PI - beta);
  out.reach = raw / (upper + lower);
  return out;
}
