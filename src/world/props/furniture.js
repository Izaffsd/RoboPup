import { CylinderGeometry, PlaneGeometry, RingGeometry, Shape } from 'three';
import { PartBuilder } from './PartBuilder.js';
import { C } from './palette.js';
import {
  blob,
  box,
  cyl,
  extrude,
  lathe,
  pawShapes,
  rbox,
  rng,
  roundedRectShape,
  sphere,
  torus,
  tube,
  vary,
} from './shapes.js';

/*
 * Furniture & shelter fixtures. Every generator returns a PartBuilder whose
 * material slots are resolved at runtime by the MaterialLibrary:
 *   paint, tint (paint tinted per instance), matte, fabric, fabricTint,
 *   gloss, glossTint, metal, wood, leaf, glow, screen.
 * Origin: floor centre of the footprint, front facing +Z.
 */

// ------------------------------------------------------------------ helpers

function bowl(b, r, x, z, y = 0, content = 'water', seed = 1) {
  b.add(
    'metal',
    lathe(
      [
        [0, y + 0.004],
        [r * 0.62, y + 0.004],
        [r * 0.72, y],
        [r * 0.92, y + 0.022],
        [r, y + 0.072],
        [r * 1.03, y + 0.08],
        [r * 0.95, y + 0.082],
        [r * 0.86, y + 0.036],
        [r * 0.6, y + 0.018],
        [0, y + 0.018],
      ],
      24,
    ),
    { color: C.steel, position: [x, 0, z] },
  );
  if (content === 'water') {
    b.add('gloss', new CylinderGeometry(r * 0.86, r * 0.86, 0.004, 24), {
      color: 0x6fc3f2,
      position: [x, y + 0.056, z],
    });
  } else {
    const rand = rng(seed);
    for (let i = 0; i < 11; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * r * 0.62;
      b.add('matte', blob(0.017 + rand() * 0.006, 0), {
        color: vary(0x8b5a2b, rand, 0.18),
        position: [x + Math.cos(a) * d, y + 0.05 + rand() * 0.012, z + Math.sin(a) * d],
        rotation: [rand() * 3, rand() * 3, 0],
      });
    }
  }
}

function legs4(b, slot, w, d, h, r, color, inset = 0.06) {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add(slot, cyl(r * 0.8, r, h, 10), {
        color,
        position: [sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset)],
      });
    }
  }
}

// ------------------------------------------------------------------ kennels

/** Kennel front panel: rails, bars and a frosted lower privacy panel. */
export function kennelFence() {
  const b = new PartBuilder();
  b.add('paint', rbox(1.0, 0.05, 0.05, 0.02), { color: C.tealDark, position: [0, 1.2, 0] });
  b.add('paint', rbox(1.0, 0.045, 0.045, 0.018), { color: C.tealDark, position: [0, 0.42, 0] });
  b.add('paint', rbox(1.0, 0.04, 0.04, 0.015), { color: C.tealDark, position: [0, 0.03, 0] });
  b.add('tint', rbox(0.98, 0.36, 0.025, 0.012), { color: 0xf3f6f5, position: [0, 0.23, 0] });
  for (let i = 0; i < 9; i++) {
    const x = -0.44 + i * 0.11;
    b.add('paint', cyl(0.011, 0.011, 0.76, 8), { color: C.teal, position: [x, 0.81, 0] });
  }
  return b;
}

/** Gate post with a ball cap. */
export function gatePost() {
  const b = new PartBuilder();
  b.add('paint', rbox(0.09, 1.34, 0.09, 0.025), { color: C.tealDark, position: [0, 0.67, 0] });
  b.add('gloss', sphere(0.058, 16, 12), { color: C.orange, position: [0, 1.38, 0] });
  b.add('paint', rbox(0.13, 0.04, 0.13, 0.015), { color: C.tealDark, position: [0, 0.02, 0] });
  return b;
}

/** Gate leaf hinged at x = 0, extending to x = 1 when closed. */
export function gateLeaf() {
  const b = new PartBuilder();
  b.add('paint', rbox(0.05, 1.18, 0.05, 0.02), { color: C.teal, position: [0.06, 0.65, 0] });
  b.add('paint', rbox(0.05, 1.18, 0.05, 0.02), { color: C.teal, position: [0.94, 0.65, 0] });
  for (const y of [0.1, 0.62, 1.2]) {
    b.add('paint', rbox(0.9, 0.045, 0.045, 0.018), { color: C.teal, position: [0.5, y, 0] });
  }
  for (let i = 0; i < 7; i++) {
    const x = 0.17 + i * 0.11;
    b.add('paint', cyl(0.01, 0.01, 1.08, 8), { color: C.tealLight, position: [x, 0.65, 0] });
  }
  b.add('metal', rbox(0.06, 0.1, 0.07, 0.015), { color: C.chrome, position: [0.94, 0.78, 0.02] });
  for (const y of [0.3, 1.0]) {
    b.add('metal', cyl(0.018, 0.018, 0.1, 10), { color: C.gunmetal, position: [0.015, y, 0] });
  }
  return b;
}

/** Pitched-roof dog house with clapboard siding, shingles and a dark interior. */
export function dogHouse(lod = 0) {
  const b = new PartBuilder();
  const W = 1.4;
  const D = 1.5;
  const WALL_H = 1.0;
  const PEAK = 1.45;
  const T = 0.07;

  const front = new Shape();
  front.moveTo(-W / 2, 0);
  front.lineTo(-0.42, 0);
  front.lineTo(-0.42, 0.53);
  front.absarc(0, 0.53, 0.42, Math.PI, 0, true);
  front.lineTo(0.42, 0);
  front.lineTo(W / 2, 0);
  front.lineTo(W / 2, WALL_H);
  front.lineTo(0, PEAK);
  front.lineTo(-W / 2, WALL_H);
  front.lineTo(-W / 2, 0);
  b.add('tint', extrude(front, T, 0.01, 16), { color: C.white, position: [0, 0, D / 2 - T / 2] });

  const back = new Shape();
  back.moveTo(-W / 2, 0);
  back.lineTo(W / 2, 0);
  back.lineTo(W / 2, WALL_H);
  back.lineTo(0, PEAK);
  back.lineTo(-W / 2, WALL_H);
  back.lineTo(-W / 2, 0);
  b.add('tint', extrude(back, T, 0.01), { color: C.white, position: [0, 0, -D / 2 + T / 2] });

  for (const s of [-1, 1]) {
    b.add('tint', rbox(T, WALL_H, D - 0.02, 0.012), {
      color: C.white,
      position: [s * (W / 2 - T / 2), WALL_H / 2, 0],
    });
    if (lod === 0) {
      for (const y of [0.22, 0.47, 0.72, 0.95]) {
        b.add('tint', rbox(0.012, 0.035, D - 0.12, 0.006), {
          color: 0xe6e2da,
          position: [s * (W / 2 + 0.002), y, 0],
        });
      }
    }
    // Corner trims.
    for (const z of [-1, 1]) {
      b.add('paint', rbox(0.07, WALL_H + 0.02, 0.07, 0.02), {
        color: C.white,
        position: [s * (W / 2 - 0.01), WALL_H / 2, z * (D / 2 - 0.01)],
      });
    }
  }

  // Dark interior lining makes the doorway read as a deep, cosy den.
  b.add('matte', box(W - 2 * T - 0.01, WALL_H - 0.02, 0.01), {
    color: 0x2b2540,
    position: [0, WALL_H / 2, -D / 2 + T + 0.006],
    noAO: true,
  });
  b.add('matte', box(W - 2 * T - 0.01, 0.012, D - 2 * T), {
    color: 0x3a3048,
    position: [0, 0.006, 0],
    noAO: true,
  });
  if (lod === 0) {
    for (const s of [-1, 1]) {
      b.add('matte', box(0.01, WALL_H - 0.02, D - 2 * T - 0.02), {
        color: 0x2f2944,
        position: [s * (W / 2 - T - 0.006), WALL_H / 2, 0],
        noAO: true,
      });
    }
  }

  // Door trim.
  const trim = new Shape();
  trim.moveTo(-0.49, 0);
  trim.lineTo(-0.49, 0.53);
  trim.absarc(0, 0.53, 0.49, Math.PI, 0, true);
  trim.lineTo(0.49, 0);
  trim.lineTo(0.42, 0);
  trim.lineTo(0.42, 0.53);
  trim.absarc(0, 0.53, 0.42, 0, Math.PI, false);
  trim.lineTo(-0.42, 0);
  trim.lineTo(-0.49, 0);
  b.add('paint', extrude(trim, 0.035, 0.008, 16), {
    color: C.white,
    position: [0, 0, D / 2 + 0.012],
  });
  b.add('paint', rbox(0.36, 0.11, 0.025, 0.012), {
    color: C.cream,
    position: [0, 1.15, D / 2 + 0.01],
  });
  b.add('gloss', sphere(0.022, 10, 8), { color: C.orange, position: [-0.14, 1.15, D / 2 + 0.025] });
  b.add('gloss', sphere(0.022, 10, 8), { color: C.orange, position: [0.14, 1.15, D / 2 + 0.025] });

  // Roof.
  const rise = PEAK - WALL_H;
  const run = W / 2;
  const a = Math.atan2(rise, run);
  const overhang = 0.16;
  const slope = Math.hypot(rise, run) + overhang;
  const depth = D + 0.26;
  for (const s of [-1, 1]) {
    const dx = s * Math.cos(a);
    const dy = -Math.sin(a);
    const nx = s * Math.sin(a);
    const ny = Math.cos(a);
    const cx = dx * (slope / 2) + nx * 0.035;
    const cy = PEAK + 0.02 + dy * (slope / 2) + ny * 0.035;
    b.add('paint', rbox(slope, 0.07, depth, 0.025), {
      color: 0xa93a35,
      position: [cx, cy, 0],
      rotation: [0, 0, -s * a],
    });
    if (lod === 0) {
      const rows = 4;
      for (let r = 0; r < rows; r++) {
        const t = (r + 0.5) / rows;
        const off = (t - 0.5) * slope;
        const px = cx + dx * off + nx * 0.05;
        const py = cy + dy * off + ny * 0.05;
        b.add('paint', rbox(slope / rows + 0.04, 0.035, depth + 0.02, 0.014), {
          color: r % 2 ? 0xd4544b : 0xc84a42,
          position: [px, py, 0],
          rotation: [0, 0, -s * (a + 0.05)],
        });
      }
    }
  }
  b.add('paint', cyl(0.055, 0.055, depth + 0.04, 12), {
    color: 0x8e2f2b,
    position: [0, PEAK + 0.085, 0],
    rotation: [Math.PI / 2, 0, 0],
  });
  return b;
}

/** Round bolster bed. */
export function dogBed() {
  const b = new PartBuilder({ groundAO: 0.18, groundAOHeight: 0.18 });
  b.add(
    'fabricTint',
    lathe(
      [
        [0.41, 0.06],
        [0.42, 0.03],
        [0.47, 0.012],
        [0.53, 0.04],
        [0.56, 0.1],
        [0.55, 0.165],
        [0.51, 0.205],
        [0.46, 0.21],
        [0.42, 0.18],
        [0.4, 0.12],
        [0.41, 0.06],
      ],
      36,
    ),
    { color: C.white },
  );
  b.add(
    'fabric',
    lathe(
      [
        [0, 0.003],
        [0.47, 0.003],
        [0.48, 0.02],
        [0, 0.02],
      ],
      36,
    ),
    { color: 0x6b6f86 },
  );
  b.add(
    'fabric',
    lathe(
      [
        [0, 0.105],
        [0.24, 0.103],
        [0.36, 0.09],
        [0.415, 0.065],
        [0.41, 0.03],
        [0, 0.03],
      ],
      36,
    ),
    { color: C.cream },
  );
  b.add('fabric', torus(0.5, 0.008, 6, 48), {
    color: 0xf8f4ec,
    position: [0, 0.2, 0],
    rotation: [Math.PI / 2, 0, 0],
  });
  return b;
}

/** Two steel bowls (food + water) on a rubber mat. */
export function bowlPair() {
  const b = new PartBuilder({ groundAO: 0.12, groundAOHeight: 0.08 });
  b.add('matte', rbox(0.68, 0.014, 0.3, 0.007, 2), { color: C.coral, position: [0, 0.007, 0] });
  bowl(b, 0.125, -0.17, 0, 0.014, 'food', 3);
  bowl(b, 0.125, 0.17, 0, 0.014, 'water');
  return b;
}

/** Single bowl (reception visitor bowl). */
export function bowlSingle() {
  const b = new PartBuilder({ groundAO: 0.12, groundAOHeight: 0.08 });
  bowl(b, 0.16, 0, 0, 0, 'water');
  b.add('gloss', sphere(0.012, 8, 6), { color: C.cream, position: [0.13, 0.08, 0.02] });
  return b;
}

/** Raised wooden feeding station with two bowls on a mat. */
export function bowlStation(seed = 7) {
  const b = new PartBuilder();
  b.add('matte', rbox(1.0, 0.012, 0.52, 0.006, 2), { color: 0x5aa6a0, position: [0, 0.006, 0] });
  const topY = 0.2;
  b.add('wood', rbox(0.84, 0.035, 0.07, 0.012), { color: C.woodLight, position: [0, topY, -0.16] });
  b.add('wood', rbox(0.84, 0.035, 0.07, 0.012), { color: C.woodLight, position: [0, topY, 0.16] });
  b.add('wood', rbox(0.07, 0.035, 0.32, 0.012), {
    color: C.woodLight,
    position: [-0.385, topY, 0],
  });
  b.add('wood', rbox(0.07, 0.035, 0.32, 0.012), { color: C.woodLight, position: [0.385, topY, 0] });
  b.add('wood', rbox(0.06, 0.035, 0.32, 0.012), { color: C.woodLight, position: [0, topY, 0] });
  legs4(b, 'wood', 0.84, 0.38, topY, 0.022, C.woodMid, 0.05);
  bowl(b, 0.15, -0.19, 0, topY - 0.06, 'food', seed);
  bowl(b, 0.15, 0.19, 0, topY - 0.06, 'water');
  return b;
}

// ------------------------------------------------------------------ reception

export function receptionDesk() {
  const b = new PartBuilder();
  const W = 2.8;
  b.add('paint', rbox(W, 1.0, 0.1, 0.04), { color: C.teal, position: [0, 0.5, 0.31] });
  b.add('paint', rbox(0.1, 1.0, 0.72, 0.04), { color: C.teal, position: [-W / 2 + 0.05, 0.5, 0] });
  b.add('paint', rbox(0.1, 1.0, 0.72, 0.04), { color: C.teal, position: [W / 2 - 0.05, 0.5, 0] });
  b.add('wood', rbox(W + 0.12, 0.05, 0.86, 0.02), {
    color: C.woodLight,
    position: [0, 1.04, 0.02],
  });
  b.add('wood', rbox(W - 0.2, 0.04, 0.55, 0.015), { color: C.woodMid, position: [0, 0.74, -0.08] });
  b.add('paint', rbox(W - 0.1, 0.06, 0.04, 0.02), { color: C.tealDark, position: [0, 0.06, 0.36] });
  // Front decoration: a big paw print.
  const paws = pawShapes();
  for (const [i, s] of paws.entries()) {
    b.add('gloss', extrude(s, 0.03, 0.008, 10), {
      color: i === 0 ? C.orange : C.yellow,
      position: [0, 0.52, 0.375],
      scale: [0.5, 0.5, 1],
    });
  }
  b.add('paint', rbox(W - 0.3, 0.035, 0.02, 0.01), { color: C.yellow, position: [0, 0.9, 0.365] });
  // Monitor.
  b.add('paint', rbox(0.56, 0.36, 0.035, 0.015), {
    color: C.charcoal,
    position: [-0.45, 1.36, -0.12],
  });
  b.add('screen', box(0.5, 0.3, 0.005), {
    color: 0x7fd6ff,
    position: [-0.45, 1.36, -0.1],
    noAO: true,
  });
  b.add('paint', cyl(0.02, 0.02, 0.14, 8), { color: C.charcoal, position: [-0.45, 1.13, -0.15] });
  b.add('paint', rbox(0.2, 0.015, 0.14, 0.006), {
    color: C.charcoal,
    position: [-0.45, 1.072, -0.15],
  });
  b.add('paint', rbox(0.42, 0.015, 0.14, 0.006), {
    color: C.gunmetal,
    position: [-0.45, 1.072, 0.08],
  });
  // Bell, pen cup, mini plant.
  b.add(
    'metal',
    lathe(
      [
        [0, 1.065],
        [0.05, 1.065],
        [0.05, 1.075],
        [0.035, 1.09],
        [0.02, 1.12],
        [0, 1.125],
      ],
      20,
    ),
    {
      color: C.gold,
      position: [0.55, 0, 0.22],
    },
  );
  b.add('metal', sphere(0.01, 8, 6), { color: C.gold, position: [0.55, 1.13, 0.22] });
  b.add('gloss', cyl(0.035, 0.03, 0.1, 14), { color: C.coral, position: [0.85, 1.115, -0.05] });
  for (let i = 0; i < 3; i++) {
    b.add('paint', cyl(0.004, 0.004, 0.14, 6), {
      color: [C.blue, C.yellow, C.green][i],
      position: [0.84 + i * 0.012, 1.17, -0.05],
      rotation: [0, 0, (i - 1) * 0.15],
    });
  }
  b.add('matte', cyl(0.06, 0.05, 0.1, 14), { color: C.terracotta, position: [1.15, 1.115, 0.05] });
  const rand = rng(11);
  for (let i = 0; i < 6; i++) {
    b.add('leaf', blob(0.05 + rand() * 0.02, 1), {
      color: vary(C.leaf, rand, 0.15),
      position: [1.15 + (rand() - 0.5) * 0.08, 1.2 + rand() * 0.06, 0.05 + (rand() - 0.5) * 0.08],
    });
  }
  return b;
}

export function officeChair() {
  const b = new PartBuilder();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.add('metal', rbox(0.3, 0.03, 0.05, 0.012), {
      color: C.gunmetal,
      position: [Math.cos(a) * 0.15, 0.07, Math.sin(a) * 0.15],
      rotation: [0, -a, 0],
    });
    b.add('matte', sphere(0.03, 10, 8), {
      color: C.rubber,
      position: [Math.cos(a) * 0.29, 0.03, Math.sin(a) * 0.29],
    });
  }
  b.add('metal', cyl(0.025, 0.03, 0.36, 12), { color: C.chrome, position: [0, 0.26, 0] });
  b.add('fabric', rbox(0.5, 0.09, 0.48, 0.04), { color: C.navy, position: [0, 0.48, 0] });
  b.add('fabric', rbox(0.46, 0.5, 0.07, 0.04), {
    color: C.navy,
    position: [0, 0.8, -0.24],
    rotation: [-0.1, 0, 0],
  });
  b.add('metal', rbox(0.05, 0.3, 0.03, 0.01), { color: C.gunmetal, position: [0, 0.6, -0.25] });
  return b;
}

export function sofa() {
  const b = new PartBuilder();
  const color = 0xe7a640;
  b.add('fabric', rbox(2.2, 0.26, 0.86, 0.06), { color: 0xd18f2e, position: [0, 0.2, 0.02] });
  for (const s of [-1, 1]) {
    b.add('fabric', rbox(1.0, 0.16, 0.66, 0.07), { color, position: [s * 0.51, 0.4, 0.09] });
    b.add('fabric', rbox(1.0, 0.46, 0.2, 0.08), {
      color,
      position: [s * 0.51, 0.64, -0.3],
      rotation: [-0.12, 0, 0],
    });
    b.add('fabric', rbox(0.2, 0.5, 0.86, 0.08), {
      color: 0xd18f2e,
      position: [s * 1.0, 0.34, 0.02],
    });
    for (const z of [-1, 1]) {
      b.add('wood', cyl(0.025, 0.02, 0.08, 8), {
        color: C.woodDark,
        position: [s * 0.98, 0.04, z * 0.36],
      });
    }
  }
  b.add('fabric', rbox(0.34, 0.32, 0.12, 0.06), {
    color: C.teal,
    position: [-0.7, 0.62, -0.12],
    rotation: [-0.2, 0.25, 0.12],
  });
  b.add('fabric', rbox(0.3, 0.3, 0.11, 0.06), {
    color: C.coral,
    position: [0.74, 0.6, -0.12],
    rotation: [-0.2, -0.3, -0.1],
  });
  return b;
}

export function coffeeTable() {
  const b = new PartBuilder();
  b.add('wood', rbox(1.0, 0.05, 0.55, 0.02), { color: C.woodLight, position: [0, 0.4, 0] });
  b.add('wood', rbox(0.86, 0.025, 0.42, 0.01), { color: C.woodMid, position: [0, 0.14, 0] });
  legs4(b, 'wood', 1.0, 0.55, 0.38, 0.022, C.woodMid, 0.07);
  b.add('paint', rbox(0.28, 0.02, 0.2, 0.004, 2), {
    color: C.blue,
    position: [-0.22, 0.435, 0.02],
    rotation: [0, 0.2, 0],
  });
  b.add('paint', rbox(0.26, 0.018, 0.19, 0.004, 2), {
    color: C.cream,
    position: [-0.2, 0.454, 0.03],
    rotation: [0, -0.1, 0],
  });
  b.add(
    'gloss',
    lathe(
      [
        [0, 0.425],
        [0.04, 0.425],
        [0.045, 0.43],
        [0.045, 0.52],
        [0.04, 0.52],
        [0.038, 0.435],
        [0, 0.435],
      ],
      18,
    ),
    {
      color: C.coral,
      position: [0.28, 0, -0.05],
    },
  );
  b.add('gloss', torus(0.025, 0.007, 6, 12), { color: C.coral, position: [0.33, 0.47, -0.05] });
  return b;
}

export function noticeBoard() {
  const b = new PartBuilder({ groundAO: 0 });
  b.add('wood', rbox(1.44, 1.04, 0.05, 0.02), { color: C.woodMid, position: [0, 0.52, 0] });
  b.add('matte', box(1.32, 0.92, 0.012), { color: C.cork, position: [0, 0.52, 0.026] });
  const rand = rng(5);
  for (let i = 0; i < 9; i++) {
    b.add('gloss', sphere(0.012, 8, 6), {
      color: [C.red, C.blue, C.yellow, C.green][i % 4],
      position: [-0.55 + rand() * 1.1, 0.15 + rand() * 0.75, 0.045],
    });
  }
  return b;
}

/** Wall shelving with boxes, bins, folded towels and jars. */
export function shelfUnit(seed = 3) {
  const b = new PartBuilder();
  const rand = rng(seed);
  const W = 1.6;
  const D = 0.4;
  const H = 1.8;
  for (const s of [-1, 1]) {
    b.add('paint', rbox(0.04, H, D, 0.012), {
      color: C.white,
      position: [s * (W / 2 - 0.02), H / 2, 0],
    });
  }
  b.add('paint', box(W - 0.06, H - 0.04, 0.015), {
    color: 0xe8e2d6,
    position: [0, H / 2, -D / 2 + 0.01],
  });
  const shelves = [0.05, 0.48, 0.92, 1.36, 1.78];
  for (const y of shelves) {
    b.add('wood', rbox(W - 0.06, 0.035, D - 0.02, 0.01), {
      color: C.woodLight,
      position: [0, y, 0],
    });
  }
  for (let level = 0; level < 4; level++) {
    const y0 = shelves[level] + 0.018;
    let x = -W / 2 + 0.1;
    while (x < W / 2 - 0.2) {
      const kind = Math.floor(rand() * 4);
      if (kind === 0) {
        const w = 0.22 + rand() * 0.12;
        const h = 0.16 + rand() * 0.14;
        b.add('paint', rbox(w, h, 0.28, 0.015), {
          color: vary([C.coral, C.blue, C.yellow, C.mint, C.lilac][Math.floor(rand() * 5)], rand),
          position: [x + w / 2, y0 + h / 2, 0.01],
        });
        x += w + 0.04;
      } else if (kind === 1) {
        for (let t = 0; t < 3; t++) {
          b.add('fabric', rbox(0.3, 0.05, 0.26, 0.02), {
            color: vary([C.tealLight, C.pink, C.cream][t % 3], rand, 0.05),
            position: [x + 0.15, y0 + 0.025 + t * 0.05, 0.02],
          });
        }
        x += 0.36;
      } else if (kind === 2) {
        for (let j = 0; j < 2; j++) {
          b.add('gloss', cyl(0.05, 0.05, 0.16, 14), {
            color: 0xdfeef5,
            position: [x + 0.06 + j * 0.12, y0 + 0.08, 0.02],
          });
          b.add('paint', cyl(0.052, 0.052, 0.03, 14), {
            color: [C.red, C.green][j],
            position: [x + 0.06 + j * 0.12, y0 + 0.175, 0.02],
          });
        }
        x += 0.28;
      } else {
        b.add('matte', rbox(0.32, 0.2, 0.3, 0.03), {
          color: vary(0xc9a77a, rand, 0.08),
          position: [x + 0.16, y0 + 0.1, 0.01],
        });
        x += 0.38;
      }
    }
  }
  return b;
}

/** Rectangular striped rug. */
export function rugRect() {
  const b = new PartBuilder({ groundAO: 0 });
  const g = new PlaneGeometry(3.0, 2.0, 60, 40);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.006, 0);
  b.add('fabric', g, {
    color: (x, _y, z, out) => {
      const bx = 1.5 - Math.abs(x);
      const bz = 1.0 - Math.abs(z);
      const edge = Math.min(bx, bz);
      if (edge < 0.08) out.set(0x2d4a7a);
      else if (edge < 0.16) out.set(0xf4e3c3);
      else if (edge < 0.22) out.set(C.coral);
      else out.set(Math.floor((x + z + 4) * 2.2) % 2 ? 0x3c6aa8 : 0x4f80bf);
    },
  });
  return b;
}

/** Round concentric rug. */
export function rugRound() {
  const b = new PartBuilder({ groundAO: 0 });
  const g = new RingGeometry(0, 2.2, 64, 22);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.006, 0);
  const rings = [0xf2d16b, 0xf5a65b, 0xf2d16b, 0xe8775d, 0xf7ead0, 0x88c9b4, 0xf7ead0, 0x5fa89a];
  b.add('fabric', g, {
    color: (x, _y, z, out) => {
      const r = Math.hypot(x, z);
      out.set(rings[Math.min(rings.length - 1, Math.floor((r / 2.2) * rings.length))]);
    },
  });
  return b;
}

export function doormat() {
  const b = new PartBuilder({ groundAO: 0 });
  const g = new PlaneGeometry(2.0, 0.9, 40, 18);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.007, 0);
  b.add('matte', g, {
    color: (x, _y, z, out) => {
      const edge = Math.min(1.0 - Math.abs(x), 0.45 - Math.abs(z));
      out.set(edge < 0.06 ? 0x3b3a40 : Math.floor((x + 3) * 10) % 2 ? 0x8a6a4a : 0x7a5c3f);
    },
  });
  return b;
}

export function trashCan() {
  const b = new PartBuilder();
  b.add(
    'paint',
    lathe(
      [
        [0, 0.01],
        [0.16, 0.01],
        [0.19, 0.43],
        [0, 0.43],
      ],
      24,
    ),
    { color: C.tealDark },
  );
  b.add('metal', torus(0.19, 0.012, 6, 28), {
    color: C.chrome,
    position: [0, 0.435, 0],
    rotation: [Math.PI / 2, 0, 0],
  });
  b.add(
    'paint',
    lathe(
      [
        [0.0, 0.44],
        [0.2, 0.44],
        [0.17, 0.47],
        [0, 0.48],
      ],
      24,
    ),
    { color: C.teal },
  );
  return b;
}

export function fireExtinguisher() {
  const b = new PartBuilder({ groundAO: 0 });
  b.add('gloss', capsule2(0.075, 0.32), { color: C.red, position: [0, 0.22, 0.02] });
  b.add('metal', cyl(0.03, 0.035, 0.06, 10), { color: C.chrome, position: [0, 0.44, 0.02] });
  b.add('metal', rbox(0.1, 0.02, 0.03, 0.008), { color: C.charcoal, position: [0.03, 0.48, 0.02] });
  b.add(
    'matte',
    tube(
      [
        [0.03, 0.45, 0.04],
        [0.09, 0.42, 0.08],
        [0.1, 0.2, 0.09],
        [0.08, 0.1, 0.08],
      ],
      0.012,
      20,
      6,
    ),
    {
      color: C.charcoal,
    },
  );
  b.add('metal', rbox(0.17, 0.05, 0.03, 0.01), { color: C.gunmetal, position: [0, 0.3, -0.06] });
  return b;
}

function capsule2(r, h) {
  return lathe(
    [
      [0, -h / 2 - r * 0.3],
      [r * 0.8, -h / 2 - r * 0.25],
      [r, -h / 2],
      [r, h / 2],
      [r * 0.7, h / 2 + r * 0.6],
      [r * 0.35, h / 2 + r * 0.85],
      [0, h / 2 + r * 0.9],
    ],
    20,
  );
}

/** Open toy chest overflowing with plushies. */
export function toyChest() {
  const b = new PartBuilder();
  const W = 1.0;
  const D = 0.55;
  const H = 0.5;
  b.add('paint', rbox(W, 0.05, D, 0.02), { color: C.purple, position: [0, 0.03, 0] });
  for (const s of [-1, 1]) {
    b.add('paint', rbox(W, H, 0.05, 0.02), {
      color: C.purple,
      position: [0, H / 2, s * (D / 2 - 0.025)],
    });
    b.add('paint', rbox(0.05, H, D, 0.02), {
      color: C.purple,
      position: [s * (W / 2 - 0.025), H / 2, 0],
    });
  }
  b.add('paint', rbox(W + 0.02, 0.05, 0.08, 0.02), {
    color: C.yellow,
    position: [0, H, D / 2 - 0.02],
  });
  b.add('paint', rbox(W + 0.02, 0.05, 0.08, 0.02), {
    color: C.yellow,
    position: [0, H, -D / 2 + 0.02],
  });
  b.add('paint', rbox(W, 0.06, D, 0.025), {
    color: C.purple,
    position: [0, H + 0.24, -D / 2 - 0.02],
    rotation: [-1.4, 0, 0],
  });
  const rand = rng(21);
  for (let i = 0; i < 9; i++) {
    b.add(i % 3 === 0 ? 'gloss' : 'fabric', sphere(0.08 + rand() * 0.06, 14, 10), {
      color: [C.coral, C.yellow, C.sky, C.mint, C.pink, C.orange][i % 6],
      position: [(rand() - 0.5) * 0.7, H - 0.02 + rand() * 0.08, (rand() - 0.5) * 0.3],
    });
  }
  b.add('gloss', extrude(boneShapeLocal(), 0.06, 0.02), {
    color: C.cream,
    position: [0.15, H + 0.08, 0.05],
    rotation: [0.3, 0.4, 0.5],
  });
  for (const x of [-0.3, 0, 0.3]) {
    b.add('gloss', extrude(starShape(0.07), 0.015, 0.004), {
      color: C.yellow,
      position: [x, 0.26, D / 2 + 0.005],
    });
  }
  return b;
}

function boneShapeLocal() {
  const s = new Shape();
  s.moveTo(-0.12, -0.025);
  s.lineTo(0.12, -0.025);
  s.absarc(0.14, -0.035, 0.035, Math.PI, Math.PI * 2.4, false);
  s.absarc(0.14, 0.035, 0.035, -Math.PI * 0.4, Math.PI, false);
  s.lineTo(-0.12, 0.025);
  s.absarc(-0.14, 0.035, 0.035, 0, Math.PI * 1.4, false);
  s.absarc(-0.14, -0.035, 0.035, Math.PI * 0.6, Math.PI * 2, false);
  return s;
}

function starShape(r) {
  const s = new Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
    const rr = i % 2 ? r * 0.45 : r;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return s;
}

export function floorCushion() {
  const b = new PartBuilder({ groundAO: 0.15, groundAOHeight: 0.15 });
  b.add('fabricTint', rbox(0.75, 0.16, 0.75, 0.07, 4), { color: C.white, position: [0, 0.08, 0] });
  b.add('fabric', cyl(0.03, 0.03, 0.02, 12), { color: C.cream, position: [0, 0.16, 0] });
  return b;
}

export function cubbyShelf(seed = 9) {
  const b = new PartBuilder();
  const rand = rng(seed);
  const W = 1.4;
  const D = 0.4;
  const H = 0.95;
  b.add('paint', rbox(W, 0.04, D, 0.012), { color: C.white, position: [0, 0.03, 0] });
  b.add('paint', rbox(W, 0.04, D, 0.012), { color: C.white, position: [0, H - 0.02, 0] });
  b.add('paint', rbox(W - 0.04, 0.03, D - 0.02, 0.01), { color: C.white, position: [0, H / 2, 0] });
  for (const x of [-W / 2 + 0.02, -W / 6, W / 6, W / 2 - 0.02]) {
    b.add('paint', rbox(0.04, H, D, 0.012), { color: C.white, position: [x, H / 2, 0] });
  }
  b.add('paint', box(W - 0.04, H - 0.04, 0.012), {
    color: 0xe9e3d8,
    position: [0, H / 2, -D / 2 + 0.008],
  });
  const cellW = W / 3 - 0.06;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const cx = -W / 3 + col * (W / 3);
      const cy = row === 0 ? 0.05 : H / 2 + 0.015;
      if ((row + col) % 2 === 0) {
        b.add('fabric', rbox(cellW - 0.03, 0.34, D - 0.08, 0.03), {
          color: vary([C.mustard, C.teal, C.coral][col], rand, 0.05),
          position: [cx, cy + 0.17, 0.01],
        });
      } else {
        let x = cx - cellW / 2 + 0.03;
        while (x < cx + cellW / 2 - 0.06) {
          const t = 0.03 + rand() * 0.03;
          const h = 0.2 + rand() * 0.1;
          b.add('paint', rbox(t, h, 0.22, 0.005, 2), {
            color: vary([C.blue, C.red, C.yellow, C.green, C.purple][Math.floor(rand() * 5)], rand),
            position: [x + t / 2, cy + h / 2, 0.02],
          });
          x += t + 0.004;
        }
      }
    }
  }
  return b;
}

// ------------------------------------------------------------------ feeding corner

/** Kitchen base cabinet (1.4 m wide). `sink` adds a basin and tap. */
export function counterCabinet(sink = false) {
  const b = new PartBuilder();
  const W = 1.4;
  const D = 0.6;
  b.add('paint', rbox(W - 0.02, 0.8, D - 0.04, 0.02), {
    color: C.white,
    position: [0, 0.48, -0.02],
  });
  b.add('paint', rbox(W - 0.06, 0.08, D - 0.1, 0.01), {
    color: C.charcoal,
    position: [0, 0.04, -0.04],
  });
  for (const s of [-1, 1]) {
    b.add('paint', rbox(W / 2 - 0.04, 0.72, 0.03, 0.02), {
      color: C.mint,
      position: [s * (W / 4), 0.48, D / 2 - 0.035],
    });
    b.add('metal', rbox(0.025, 0.16, 0.025, 0.01), {
      color: C.chrome,
      position: [s * 0.08, 0.62, D / 2 - 0.005],
    });
  }
  b.add('wood', rbox(W, 0.045, D + 0.04, 0.012), { color: C.woodLight, position: [0, 0.905, 0] });
  if (sink) {
    b.add('metal', rbox(0.62, 0.012, 0.42, 0.006), { color: C.chrome, position: [0, 0.93, 0] });
    b.add('matte', box(0.54, 0.004, 0.34), {
      color: 0x7d8590,
      position: [0, 0.937, 0],
      noAO: true,
    });
    b.add(
      'metal',
      tube(
        [
          [0, 0.93, -0.25],
          [0, 1.18, -0.25],
          [0, 1.24, -0.16],
          [0, 1.18, -0.06],
        ],
        0.018,
        20,
        8,
      ),
      {
        color: C.chrome,
      },
    );
    b.add('metal', cyl(0.03, 0.03, 0.03, 10), { color: C.chrome, position: [0.12, 0.945, -0.24] });
    b.add('gloss', cyl(0.035, 0.035, 0.18, 12), { color: C.green, position: [-0.45, 1.02, -0.15] });
    b.add('paint', cyl(0.015, 0.015, 0.05, 8), { color: C.white, position: [-0.45, 1.13, -0.15] });
  }
  return b;
}

export function waterDispenser() {
  const b = new PartBuilder();
  b.add('paint', rbox(0.36, 0.95, 0.36, 0.04), { color: C.white, position: [0, 0.475, 0] });
  b.add('paint', rbox(0.3, 0.2, 0.02, 0.01), { color: C.gunmetal, position: [0, 0.72, 0.18] });
  b.add('paint', cyl(0.02, 0.02, 0.05, 8), {
    color: C.red,
    position: [-0.07, 0.68, 0.2],
    rotation: [Math.PI / 2, 0, 0],
  });
  b.add('paint', cyl(0.02, 0.02, 0.05, 8), {
    color: C.blue,
    position: [0.07, 0.68, 0.2],
    rotation: [Math.PI / 2, 0, 0],
  });
  b.add('metal', rbox(0.24, 0.02, 0.1, 0.008), { color: C.chrome, position: [0, 0.52, 0.17] });
  b.add(
    'gloss',
    lathe(
      [
        [0, 0.95],
        [0.07, 0.95],
        [0.08, 0.99],
        [0.15, 1.04],
        [0.16, 1.1],
        [0.16, 1.24],
        [0.14, 1.29],
        [0, 1.3],
      ],
      24,
    ),
    { color: 0x8ccff5 },
  );
  b.add('gloss', torus(0.162, 0.008, 6, 28), {
    color: 0x6fb6e6,
    position: [0, 1.12, 0],
    rotation: [Math.PI / 2, 0, 0],
  });
  return b;
}

export function storageBin() {
  const b = new PartBuilder();
  b.add('glossTint', rbox(0.58, 0.66, 0.48, 0.05), { color: C.white, position: [0, 0.38, 0] });
  b.add('gloss', rbox(0.62, 0.07, 0.52, 0.03), { color: 0x4d5566, position: [0, 0.73, 0] });
  b.add('paint', rbox(0.26, 0.14, 0.01, 0.005), { color: C.cream, position: [0, 0.48, 0.245] });
  for (const s of [-1, 1]) {
    b.add('matte', cyl(0.035, 0.035, 0.03, 12), {
      color: C.rubber,
      position: [s * 0.22, 0.035, 0.18],
      rotation: [0, 0, Math.PI / 2],
    });
  }
  return b;
}

export function foodBags() {
  const b = new PartBuilder();
  const rand = rng(17);
  const colors = [C.orange, C.teal, C.coral, C.blue];
  let y = 0;
  for (let i = 0; i < 3; i++) {
    const h = 0.17;
    const rot = (rand() - 0.5) * 0.25;
    const color = colors[i % colors.length];
    b.add('matte', rbox(0.62, h, 0.42, 0.07, 4), {
      color,
      position: [(rand() - 0.5) * 0.08, y + h / 2, (rand() - 0.5) * 0.06],
      rotation: [0, rot, 0],
    });
    b.add('paint', box(0.24, 0.005, 0.18), {
      color: C.cream,
      position: [(rand() - 0.5) * 0.04, y + h + 0.001, 0],
      rotation: [0, rot, 0],
      noAO: true,
    });
    y += h - 0.01;
  }
  b.add('matte', rbox(0.42, 0.62, 0.22, 0.08, 4), {
    color: C.green,
    position: [0.32, 0.31, -0.12],
    rotation: [0.05, -0.4, -0.1],
  });
  return b;
}

// ------------------------------------------------------------------ misc

export function bench() {
  const b = new PartBuilder();
  for (let i = 0; i < 3; i++) {
    b.add('wood', rbox(1.6, 0.04, 0.12, 0.015), {
      color: C.woodLight,
      position: [0, 0.43, -0.14 + i * 0.14],
    });
  }
  for (const s of [-1, 1]) {
    b.add('metal', rbox(0.05, 0.41, 0.04, 0.012), {
      color: C.gunmetal,
      position: [s * 0.68, 0.205, -0.16],
    });
    b.add('metal', rbox(0.05, 0.41, 0.04, 0.012), {
      color: C.gunmetal,
      position: [s * 0.68, 0.205, 0.16],
    });
    b.add('metal', rbox(0.05, 0.04, 0.36, 0.012), {
      color: C.gunmetal,
      position: [s * 0.68, 0.39, 0],
    });
    b.add('metal', rbox(0.05, 0.03, 0.36, 0.012), {
      color: C.gunmetal,
      position: [s * 0.68, 0.015, 0],
    });
  }
  return b;
}

/** Pendant lamp: origin at the bulb; the cord runs up into the ceiling. */
export function pendantLamp() {
  const b = new PartBuilder({ groundAO: 0 });
  b.add(
    'paint',
    lathe(
      [
        [0.05, 0.22],
        [0.07, 0.2],
        [0.16, 0.08],
        [0.25, -0.04],
        [0.26, -0.06],
        [0.245, -0.06],
        [0.235, -0.04],
        [0.15, 0.07],
        [0.06, 0.18],
        [0.04, 0.2],
      ],
      32,
    ),
    { color: C.mustard },
  );
  b.add('glow', sphere(0.075, 16, 12), { color: 0xffe2a8, position: [0, 0.0, 0] });
  b.add('paint', cyl(0.045, 0.045, 0.06, 12), { color: C.charcoal, position: [0, 0.2, 0] });
  b.add('matte', cyl(0.006, 0.006, 3.0, 6), { color: C.charcoal, position: [0, 1.72, 0] });
  return b;
}

/** Hanging double-sided sign board (text quads are added by Signage). */
export function zoneSignBoard(w, h) {
  const b = new PartBuilder({ groundAO: 0 });
  b.add('paint', rbox(w + 0.08, h + 0.08, 0.05, 0.03), { color: C.navy });
  return b;
}

/** Rounded-rectangle wall plaque used behind text. */
export function plaque(w, h, color) {
  const b = new PartBuilder({ groundAO: 0 });
  b.add('paint', extrude(roundedRectShape(w, h, Math.min(w, h) * 0.2), 0.02, 0.005), { color });
  return b;
}
