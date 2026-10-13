import { CylinderGeometry, Shape } from 'three';
import { TUNNEL_PROFILE } from '../layout.js';
import { PartBuilder } from './PartBuilder.js';
import { C } from './palette.js';
import { cyl, extrude, rbox, rng, sphere, torus } from './shapes.js';

/** Banded cylinder along Y with alternating colours (agility poles/bars). */
function bandedCylinder(r, h, bands, colorA, colorB, radial = 12) {
  const g = new CylinderGeometry(r, r, h, radial, bands * 2);
  return {
    geometry: g,
    color: (_x, y, _z, out) => {
      const t = (y + h / 2) / h;
      out.set(Math.floor(t * bands + 1e-4) % 2 ? colorB : colorA);
    },
  };
}

function hurdle(barHeight) {
  const b = new PartBuilder();
  for (const s of [-1, 1]) {
    const post = bandedCylinder(0.035, barHeight + 0.42, 4, C.white, C.blue);
    b.add('paint', post.geometry, {
      color: post.color,
      position: [s * 0.68, (barHeight + 0.42) / 2, 0],
    });
    b.add('paint', rbox(0.08, 0.04, 0.5, 0.015), { color: C.blue, position: [s * 0.68, 0.02, 0] });
    b.add('gloss', sphere(0.045, 12, 8), {
      color: C.yellow,
      position: [s * 0.68, barHeight + 0.44, 0],
    });
    b.add('paint', rbox(0.05, 0.03, 0.06, 0.01), {
      color: C.gunmetal,
      position: [s * 0.64, barHeight - 0.035, 0],
    });
  }
  const bar = bandedCylinder(0.025, 1.3, 5, C.red, C.white);
  b.add('paint', bar.geometry, {
    color: bar.color,
    position: [0, barHeight, 0],
    rotation: [0, 0, Math.PI / 2],
  });
  return b;
}

export const hurdleLow = () => hurdle(0.3);
export const hurdleHigh = () => hurdle(0.5);

/** Weave pole (tinted per instance). */
export function weavePole() {
  const b = new PartBuilder();
  b.add('paint', cyl(0.12, 0.14, 0.04, 16), { color: C.gunmetal, position: [0, 0.02, 0] });
  b.add('tint', cyl(0.024, 0.024, 1.0, 10), { color: C.white, position: [0, 0.52, 0] });
  b.add('gloss', sphere(0.034, 10, 8), { color: C.white, position: [0, 1.03, 0] });
  return b;
}

/** Wire basket full of balls. */
export function ballBasket() {
  const b = new PartBuilder();
  for (let i = 0; i < 4; i++) {
    b.add('metal', torus(0.33 + i * 0.01, 0.01, 6, 32), {
      color: C.chrome,
      position: [0, 0.05 + i * 0.13, 0],
      rotation: [Math.PI / 2, 0, 0],
    });
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.add('metal', cyl(0.007, 0.007, 0.45, 5), {
      color: C.chrome,
      position: [Math.cos(a) * 0.335, 0.23, Math.sin(a) * 0.335],
    });
  }
  b.add('metal', cyl(0.33, 0.33, 0.01, 24), { color: C.gunmetal, position: [0, 0.01, 0] });
  const rand = rng(77);
  for (let i = 0; i < 12; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 0.24;
    b.add('gloss', sphere(0.08 + rand() * 0.03, 14, 10), {
      color: [C.red, C.yellow, C.blue, C.green, C.orange, C.purple][i % 6],
      position: [Math.cos(a) * r, 0.1 + (i / 12) * 0.38, Math.sin(a) * r],
    });
  }
  return b;
}

/** Low, colourful picket fence panel (1 m). */
export function playFence() {
  const b = new PartBuilder();
  for (const y of [0.2, 0.6]) {
    b.add('paint', rbox(1.0, 0.06, 0.035, 0.015), { color: C.white, position: [0, y, -0.02] });
  }
  const colors = [C.coral, C.yellow, C.teal, C.blue, C.purple];
  for (let i = 0; i < 5; i++) {
    const s = new Shape();
    const w = 0.13;
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(w / 2, 0.74);
    s.quadraticCurveTo(w / 2, 0.84, 0, 0.86);
    s.quadraticCurveTo(-w / 2, 0.84, -w / 2, 0.74);
    s.lineTo(-w / 2, 0);
    b.add('paint', extrude(s, 0.03, 0.008, 6), {
      color: colors[i],
      position: [-0.4 + i * 0.2, 0, 0.01],
    });
  }
  return b;
}

/**
 * One 1 m tunnel segment: fabric arch shell (tinted per instance) with ribs.
 */
export function tunnelSegment() {
  const b = new PartBuilder({ groundAO: 0.2, groundAOHeight: 0.3 });
  const { centerY, innerRadius, outerRadius, startAngle, endAngle } = TUNNEL_PROFILE;
  const s = new Shape();
  const steps = 28;
  for (let i = 0; i <= steps; i++) {
    const a = startAngle + ((endAngle - startAngle) * i) / steps;
    const x = Math.cos(a) * outerRadius;
    const y = Math.sin(a) * outerRadius;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i--) {
    const a = startAngle + ((endAngle - startAngle) * i) / steps;
    s.lineTo(Math.cos(a) * innerRadius, Math.sin(a) * innerRadius);
  }
  b.add('fabricTint', extrude(s, 0.98, 0.01, 4), { color: C.white, position: [0, centerY, 0] });
  const ribR = (innerRadius + outerRadius) / 2;
  for (const z of [-0.49, 0.49]) {
    b.add('paint', torus(ribR, 0.045, 8, 40, endAngle - startAngle), {
      color: C.navy,
      position: [0, centerY, z],
      rotation: [0, 0, startAngle],
    });
  }
  return b;
}
