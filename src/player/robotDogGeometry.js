import {
  Bone,
  Group,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
  Skeleton,
  SkinnedMesh,
} from 'three';
import { ANIMATION } from '../config/config.js';
import { PartBuilder } from '../world/props/PartBuilder.js';
import { capsule, cyl, extrude, rbox, sphere, torus } from '../world/props/shapes.js';

/**
 * Procedural model of "Bolt", the robo-pup. Built from rounded primitives,
 * rigidly skinned to a 23-bone skeleton and merged into one SkinnedMesh per
 * material slot (shell, mech, glow, face) — 4 draw calls for the whole dog.
 *
 * Executed offline by scripts/build-assets.mjs, which exports it to a
 * Meshopt-compressed GLB. The runtime only loads the GLB.
 *
 * Bind pose: all bones unrotated, legs straight down, dog facing +Z.
 */

const SHELL = 0xf6f1e7;
const ACCENT = 0x2bb3a8;
const ORANGE = 0xff8a3d;
const MECH = 0x4a505c;
const DARK = 0x2a2c33;
const RUBBER = 0x24252a;
const GLOW = 0x48f0e0;

/** [name, parent, x, y, z] in parent space. Order defines bone indices. */
export const DOG_BONES = Object.freeze([
  ['root', null, 0, 0, 0],
  ['body', 'root', 0, ANIMATION.rideHeight, 0],
  ['neck', 'body', 0, 0.1, 0.24],
  ['head', 'neck', 0, 0.12, 0.07],
  ['jaw', 'head', 0, -0.072, 0.07],
  ['ear_L', 'head', 0.1, 0.105, -0.03],
  ['ear_R', 'head', -0.1, 0.105, -0.03],
  ['antenna', 'head', 0, 0.122, -0.07],
  ['tail_0', 'body', 0, 0.08, -0.29],
  ['tail_1', 'tail_0', 0, 0, -0.1],
  ['tail_2', 'tail_1', 0, 0, -0.09],
  ...['FL', 'FR', 'RL', 'RR'].flatMap((leg) => {
    const x = leg[1] === 'L' ? 0.135 : -0.135;
    const z = leg[0] === 'F' ? 0.2 : -0.2;
    return [
      [`hip_${leg}`, 'body', x, -0.07, z],
      [`knee_${leg}`, `hip_${leg}`, 0, -ANIMATION.upperLegLength, 0],
      [`foot_${leg}`, `knee_${leg}`, 0, -ANIMATION.lowerLegLength, 0],
    ];
  }),
]);

/** Bind-pose position of every bone in model space. */
function bindPositions() {
  const map = new Map();
  for (const [name, parent, x, y, z] of DOG_BONES) {
    const p = parent ? map.get(parent) : [0, 0, 0];
    map.set(name, [p[0] + x, p[1] + y, p[2] + z]);
  }
  return map;
}

/**
 * Build the dog as a Group containing the bone hierarchy and the skinned
 * meshes (materials are named placeholders replaced at runtime).
 * @returns {Group}
 */
export function buildRobotDog() {
  const bind = bindPositions();
  const index = new Map(DOG_BONES.map(([name], i) => [name, i]));
  const b = new PartBuilder({ groundAO: 0, skinned: true });

  /** Add a part expressed in its bone's local space. */
  const part = (slot, geometry, boneName, opts = {}) => {
    const [bx, by, bz] = bind.get(boneName);
    const p = opts.position || [0, 0, 0];
    b.add(slot, geometry, {
      ...opts,
      position: [bx + p[0], by + p[1], bz + p[2]],
      bone: index.get(boneName),
    });
  };

  // ---------------------------------------------------------------- torso
  part('dog_shell', rbox(0.36, 0.26, 0.56, 0.095, 4), 'body', { color: SHELL });
  part('dog_mech', rbox(0.3, 0.05, 0.46, 0.02), 'body', { color: MECH, position: [0, -0.118, 0] });
  for (const s of [-1, 1]) {
    part('dog_shell', rbox(0.022, 0.15, 0.34, 0.01), 'body', {
      color: ACCENT,
      position: [s * 0.18, 0.005, 0],
    });
    for (let i = 0; i < 3; i++) {
      part('dog_mech', rbox(0.008, 0.012, 0.09, 0.004, 1), 'body', {
        color: DARK,
        position: [s * 0.192, -0.035 + i * 0.03, -0.05],
      });
    }
    // Shoulder / hip housings.
    for (const z of [0.2, -0.2]) {
      part('dog_mech', sphere(0.07, 16, 12), 'body', {
        color: MECH,
        position: [s * 0.135, -0.07, z],
      });
      part('dog_shell', sphere(0.062, 16, 12), 'body', {
        color: ACCENT,
        position: [s * 0.19, -0.06, z],
        scale: [0.45, 1, 1],
      });
    }
  }
  part('dog_shell', rbox(0.12, 0.022, 0.42, 0.01), 'body', {
    color: ORANGE,
    position: [0, 0.13, -0.01],
  });
  part('dog_mech', rbox(0.17, 0.016, 0.12, 0.006), 'body', {
    color: DARK,
    position: [0, 0.136, -0.17],
  });
  part('dog_glow', rbox(0.11, 0.008, 0.016, 0.004, 1), 'body', {
    color: GLOW,
    position: [0, 0.145, -0.15],
  });
  part('dog_glow', rbox(0.11, 0.008, 0.016, 0.004, 1), 'body', {
    color: GLOW,
    position: [0, 0.145, -0.19],
  });
  part('dog_mech', torus(0.036, 0.008, 6, 20), 'body', { color: DARK, position: [0, 0.02, 0.279] });
  part('dog_glow', cyl(0.028, 0.028, 0.012, 20), 'body', {
    color: GLOW,
    position: [0, 0.02, 0.281],
    rotation: [Math.PI / 2, 0, 0],
  });
  part('dog_mech', sphere(0.034, 12, 10), 'body', { color: MECH, position: [0, 0.08, -0.282] });

  // ---------------------------------------------------------------- neck + collar
  part('dog_mech', cyl(0.05, 0.056, 0.13, 16), 'neck', { color: MECH, position: [0, 0.02, 0] });
  part('dog_shell', torus(0.062, 0.016, 8, 28), 'neck', {
    color: ACCENT,
    position: [0, -0.015, 0],
    rotation: [Math.PI / 2, 0, 0],
  });
  part('dog_mech', cyl(0.024, 0.024, 0.006, 18), 'neck', {
    color: 0xf1c35b,
    position: [0, -0.05, 0.072],
    rotation: [Math.PI / 2 + 0.25, 0, 0],
  });

  // ---------------------------------------------------------------- head
  part('dog_shell', rbox(0.3, 0.25, 0.27, 0.09, 4), 'head', { color: SHELL });
  part('dog_mech', rbox(0.252, 0.152, 0.03, 0.035), 'head', {
    color: DARK,
    position: [0, 0.018, 0.124],
  });
  // The LED screen sits 1.5 mm in front of the flat visor housing (front
  // face at z = 0.139). A barely-there curve keeps every point in front of
  // it, so the whole screen (both eyes) is visible.
  const face = new PlaneGeometry(0.218, 0.118, 16, 4);
  const fp = face.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    const x = fp.getX(i);
    fp.setZ(i, -0.08 * x * x);
  }
  face.computeVertexNormals();
  part('dog_face', face, 'head', { color: 0xffffff, position: [0, 0.018, 0.1405] });
  part('dog_shell', rbox(0.15, 0.08, 0.1, 0.035), 'head', {
    color: SHELL,
    position: [0, -0.074, 0.128],
  });
  part('dog_mech', sphere(0.022, 14, 10), 'head', {
    color: DARK,
    position: [0, -0.046, 0.18],
    scale: [1.35, 0.9, 1],
  });
  part('dog_shell', rbox(0.1, 0.012, 0.15, 0.005), 'head', {
    color: ORANGE,
    position: [0, 0.126, -0.02],
  });
  for (const s of [-1, 1]) {
    part('dog_glow', sphere(0.02, 10, 8), 'head', {
      color: 0x6a3046,
      position: [s * 0.118, -0.045, 0.118],
      scale: [1, 0.6, 0.35],
    });
    part('dog_mech', cyl(0.03, 0.03, 0.03, 14), 'head', {
      color: MECH,
      position: [s * 0.152, 0.07, -0.03],
      rotation: [0, 0, Math.PI / 2],
    });
  }

  // ---------------------------------------------------------------- jaw
  part('dog_shell', rbox(0.13, 0.034, 0.095, 0.014), 'jaw', {
    color: SHELL,
    position: [0, -0.012, 0.048],
  });
  part('dog_mech', rbox(0.11, 0.008, 0.075, 0.003, 1), 'jaw', {
    color: DARK,
    position: [0, 0.006, 0.046],
  });
  part('dog_shell', rbox(0.06, 0.008, 0.05, 0.004, 1), 'jaw', {
    color: 0xff8fa3,
    position: [0, 0.011, 0.052],
  });

  // ---------------------------------------------------------------- ears
  const earShape = (w, h) => {
    const s = new Shape();
    s.moveTo(-w / 2, 0);
    s.quadraticCurveTo(-w * 0.45, h * 0.75, 0, h);
    s.quadraticCurveTo(w * 0.45, h * 0.75, w / 2, 0);
    s.quadraticCurveTo(0, -0.012, -w / 2, 0);
    return s;
  };
  for (const [boneName, side] of [
    ['ear_L', 1],
    ['ear_R', -1],
  ]) {
    const rot = [-0.18, 0, -side * 0.38];
    part('dog_shell', extrude(earShape(0.1, 0.15), 0.018, 0.006, 12), boneName, {
      color: SHELL,
      rotation: rot,
    });
    const inner = extrude(earShape(0.064, 0.105), 0.008, 0.003, 10);
    inner.translate(0, 0.012, 0.009);
    part('dog_shell', inner, boneName, { color: ORANGE, rotation: rot });
    part('dog_mech', cyl(0.02, 0.02, 0.05, 12), boneName, {
      color: MECH,
      rotation: [0, 0, Math.PI / 2],
    });
  }

  // ---------------------------------------------------------------- antenna
  part('dog_mech', cyl(0.006, 0.008, 0.1, 8), 'antenna', { color: MECH, position: [0, 0.05, 0] });
  part('dog_glow', sphere(0.018, 12, 10), 'antenna', { color: 0xffb347, position: [0, 0.106, 0] });

  // ---------------------------------------------------------------- tail
  for (let k = 0; k < 3; k++) {
    const r = 0.022 - k * 0.0035;
    part('dog_mech', cyl(r * 0.85, r, 0.1, 12), `tail_${k}`, {
      color: MECH,
      position: [0, 0, -0.05],
      rotation: [Math.PI / 2, 0, 0],
    });
    part('dog_shell', torus(r + 0.004, 0.006, 6, 18), `tail_${k}`, {
      color: ACCENT,
      position: [0, 0, -0.006],
    });
  }
  part('dog_glow', sphere(0.028, 14, 10), 'tail_2', { color: GLOW, position: [0, 0, -0.1] });

  // ---------------------------------------------------------------- legs
  for (const leg of ['FL', 'FR', 'RL', 'RR']) {
    const out = leg[1] === 'L' ? 1 : -1;
    part('dog_shell', capsule(0.045, 0.13, 4, 14), `hip_${leg}`, {
      color: SHELL,
      position: [0, -0.1, 0],
    });
    part('dog_shell', rbox(0.026, 0.13, 0.07, 0.012), `hip_${leg}`, {
      color: ACCENT,
      position: [out * 0.046, -0.1, 0],
    });
    part('dog_mech', sphere(0.043, 14, 10), `knee_${leg}`, { color: MECH });
    part('dog_glow', torus(0.045, 0.006, 6, 20), `knee_${leg}`, {
      color: GLOW,
      rotation: [0, Math.PI / 2, 0],
    });
    part('dog_mech', capsule(0.031, 0.15, 4, 12), `knee_${leg}`, {
      color: MECH,
      position: [0, -0.1, 0],
    });
    part('dog_shell', rbox(0.062, 0.11, 0.03, 0.012), `knee_${leg}`, {
      color: SHELL,
      position: [0, -0.095, 0.03],
    });
    part('dog_mech', sphere(0.03, 12, 10), `foot_${leg}`, { color: MECH, position: [0, 0.012, 0] });
    part('dog_mech', rbox(0.086, 0.05, 0.112, 0.022), `foot_${leg}`, {
      color: RUBBER,
      position: [0, -0.02, 0.014],
    });
    part('dog_shell', rbox(0.07, 0.012, 0.03, 0.005, 1), `foot_${leg}`, {
      color: ACCENT,
      position: [0, 0.004, 0.058],
    });
  }

  // ---------------------------------------------------------------- assemble
  const group = new Group();
  group.name = 'RoboDog';
  const bones = [];
  const byName = new Map();
  for (const [name, parent, x, y, z] of DOG_BONES) {
    const bone = new Bone();
    bone.name = name;
    bone.position.set(x, y, z);
    if (parent) byName.get(parent).add(bone);
    byName.set(name, bone);
    bones.push(bone);
  }
  group.add(bones[0]);
  group.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones);
  // Only the face screen samples UVs (its eye shader); drop them elsewhere.
  const geometries = b.build({ keepUV: (slot) => slot === 'dog_face' });
  for (const [slot, geometry] of Object.entries(geometries)) {
    const material = new MeshStandardMaterial({ name: slot, vertexColors: true });
    const mesh = new SkinnedMesh(geometry, material);
    mesh.name = slot;
    group.add(mesh);
    mesh.bind(skeleton);
  }
  return group;
}
