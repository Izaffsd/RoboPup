import { CircleGeometry, Color, Group, Mesh, RingGeometry, SphereGeometry, Vector3 } from 'three';
import { SUN_DIRECTION } from '../config/config.js';
import { createSkyMaterial } from '../render/shaders/SkyMaterial.js';
import { BOUNDS } from './layout.js';
import { PartBuilder } from './props/PartBuilder.js';
import { blob, rng, vary } from './props/shapes.js';

const _alt = new Color();

/**
 * The world outside the windows: stylised sky dome, grassy grounds with a
 * path to the entrance, rolling hills on the horizon and placements for
 * instanced trees and bushes (rendered through the PropInstancer with LOD).
 */
export class Outdoor {
  /** @param {import('./MaterialLibrary.js').MaterialLibrary} materials */
  constructor(materials) {
    this.group = new Group();
    this.group.name = 'Outdoor';

    this.skyMaterial = createSkyMaterial(new Vector3(...SUN_DIRECTION));
    this.sky = new Mesh(new SphereGeometry(160, 32, 16), this.skyMaterial);
    this.sky.name = 'Sky';
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.group.add(this.sky);

    const ground = new PartBuilder({ groundAO: 0 });
    const rand = rng(8);
    // Ringed disc so vertex colours can carry large, soft grass-tone variation.
    const disc = new RingGeometry(0, 170, 72, 30);
    disc.rotateX(-Math.PI / 2);
    ground.add('matte', disc, {
      color: (x, _y, z, out) => {
        const n =
          Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2.0) * Math.cos(z * 0.09 + Math.sin(x * 0.05));
        out.set(0x86c06a).lerp(_alt.set(0x6fae58), 0.5 + 0.5 * n);
      },
      position: [0, -0.03, 0],
      noAO: true,
    });
    // Concrete apron around the building and a path from the entrance.
    const apron = new CircleGeometry(1, 4, Math.PI / 4);
    apron.rotateX(-Math.PI / 2);
    ground.add('matte', apron, {
      color: 0xd9d2c4,
      position: [0, -0.02, 0],
      scale: [(BOUNDS.maxX + 3) * Math.SQRT2, 1, (BOUNDS.maxZ + 3) * Math.SQRT2],
      noAO: true,
    });
    for (let z = BOUNDS.maxZ + 3; z < 60; z += 1.2) {
      const g = new CircleGeometry(0.75, 6);
      g.rotateX(-Math.PI / 2);
      ground.add('matte', g, {
        color: vary(0xe6dccb, rand, 0.04),
        position: [-14 + Math.sin(z * 0.15) * 1.2, -0.018, z],
        scale: [1.6, 1, 1],
        noAO: true,
      });
    }
    // Hills on the horizon.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rand() * 0.2;
      const r = 120 + rand() * 25;
      ground.add('matte', blob(22 + rand() * 18, 2), {
        color: vary(i % 2 ? 0x6faa5a : 0x7fb866, rand, 0.05),
        position: [Math.cos(a) * r, -6, Math.sin(a) * r],
        scale: [1.6, 0.55, 1.2],
        noAO: true,
      });
    }
    for (const [slot, geometry] of Object.entries(ground.build({ keepUV: () => false }))) {
      const mesh = new Mesh(geometry, materials.get(slot));
      mesh.name = 'Grounds';
      mesh.matrixAutoUpdate = false;
      mesh.receiveShadow = false;
      this.group.add(mesh);
    }

    /** Tree / bush placements for the PropInstancer. */
    this.placements = [];
    const add = (type, x, z, s) =>
      this.placements.push({ type, x, y: -0.03, z, rotY: rand() * Math.PI * 2, scale: s });
    const outside = (x, z) => Math.abs(x) > BOUNDS.maxX + 5 || Math.abs(z) > BOUNDS.maxZ + 5;
    for (let i = 0; i < 70; i++) {
      const a = rand() * Math.PI * 2;
      const r = 30 + rand() * 50;
      const x = Math.cos(a) * r * 1.2;
      const z = Math.sin(a) * r;
      if (!outside(x, z) || (Math.abs(x + 14) < 4 && z > 0)) continue;
      add('tree', x, z, 0.85 + rand() * 0.6);
    }
    for (let x = BOUNDS.minX + 1.5; x < BOUNDS.maxX; x += 2.2 + rand() * 1.4) {
      if (Math.abs(x + 14) < 2.2) continue;
      add('bush', x, BOUNDS.maxZ + 1.6 + rand() * 0.6, 0.65 + rand() * 0.35);
    }
    for (let z = BOUNDS.minZ + 1.5; z < BOUNDS.maxZ; z += 2.6 + rand() * 1.6) {
      if (Math.abs(z + 6.5) < 2) continue;
      add('bush', BOUNDS.maxX + 1.6 + rand() * 0.6, z, 0.6 + rand() * 0.4);
      add('bush', BOUNDS.minX - 1.6 - rand() * 0.6, z, 0.6 + rand() * 0.4);
    }
  }

  /** @param {number} time */
  update(time) {
    this.skyMaterial.uniforms.uTime.value = time;
  }

  dispose() {
    this.sky.geometry.dispose();
    this.skyMaterial.dispose();
    this.group.traverse((o) => {
      if (o.isMesh && o !== this.sky) o.geometry.dispose();
    });
  }
}
