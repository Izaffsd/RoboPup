import { BufferAttribute, BufferGeometry, Group, Mesh, Points, Vector3 } from 'three';
import { SUN_DIRECTION } from '../config/config.js';
import { createDustMaterial } from '../render/shaders/DustMaterial.js';
import { createLightShaftMaterial } from '../render/shaders/LightShaftMaterial.js';
import { rng } from './props/shapes.js';
import { BOUNDS, OUTER_WALLS, PLATFORMS } from './layout.js';

const MAX_DUST = 1400;
const FRAME = 0.08;

/** Height of the walkable surface under (x, z) — floor or the nook deck. */
function floorHeight(x, z) {
  for (const p of PLATFORMS) {
    if (Math.abs(x - p.x) <= p.sx / 2 && Math.abs(z - p.z) <= p.sz / 2) return p.height;
  }
  return 0;
}

/**
 * God-ray volumes and sun-lit dust for the south windows that receive direct
 * sun (same openings and sun direction as the lightmap bake, so the beams
 * land exactly on the baked floor patches).
 */
export class LightShafts {
  constructor() {
    this.group = new Group();
    this.group.name = 'LightShafts';
    this.sun = new Vector3(...SUN_DIRECTION).normalize();
    /** One beam per sun-facing window (inside its frame). */
    this.panes = [];
    for (const o of OUTER_WALLS.south) {
      if (!o.sun) continue;
      this.panes.push({
        x0: o.center - o.width / 2 + FRAME,
        x1: o.center + o.width / 2 - FRAME,
        y0: o.bottom,
        y1: o.top - FRAME,
        z: BOUNDS.maxZ + 0.15,
      });
    }

    this.material = createLightShaftMaterial();
    this.mesh = new Mesh(this._buildSheets(), this.material);
    this.mesh.name = 'GodRays';
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    this.dustMaterial = createDustMaterial();
    this.dust = new Points(this._buildDust(), this.dustMaterial);
    this.dust.name = 'SunDust';
    this.dust.renderOrder = 4;
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
    this.setDustCount(0);
  }

  /** Point inside a pane's beam: (u, v) across the pane, w along the beam. */
  _point(pane, u, v, w, out) {
    const x = pane.x0 + (pane.x1 - pane.x0) * u;
    const y = pane.y0 + (pane.y1 - pane.y0) * v;
    const z = pane.z;
    const L = this.sun;
    let t = (y - 0) / -L.y;
    const hx = x + L.x * t;
    const hz = z + L.z * t;
    const floor = floorHeight(hx, hz);
    if (floor > 0) t = (y - floor) / -L.y;
    return out.set(x + L.x * t * w, y + L.y * t * w, z + L.z * t * w);
  }

  _buildSheets() {
    const pos = [];
    const shaft = [];
    const p = new Vector3();
    const quad = (pane, corners) => {
      for (const idx of [0, 1, 2, 0, 2, 3]) {
        const [u, v, w] = corners[idx];
        this._point(pane, u, v, w, p);
        pos.push(p.x, p.y, p.z);
        shaft.push(u, v, w);
      }
    };
    for (const pane of this.panes) {
      for (const u of [0.3, 0.7]) {
        quad(pane, [
          [u, 0, 0],
          [u, 1, 0],
          [u, 1, 1],
          [u, 0, 1],
        ]);
      }
      for (const v of [0.5]) {
        quad(pane, [
          [0, v, 0],
          [1, v, 0],
          [1, v, 1],
          [0, v, 1],
        ]);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('aShaft', new BufferAttribute(new Float32Array(shaft), 3));
    g.computeVertexNormals();
    return g;
  }

  _buildDust() {
    const rand = rng(404);
    const pos = new Float32Array(MAX_DUST * 3);
    const seed = new Float32Array(MAX_DUST);
    const p = new Vector3();
    for (let i = 0; i < MAX_DUST; i++) {
      const pane = this.panes[Math.floor(rand() * this.panes.length)];
      this._point(pane, 0.15 + rand() * 0.7, 0.15 + rand() * 0.7, 0.05 + rand() * 0.85, p);
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      seed[i] = rand();
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new BufferAttribute(seed, 1));
    return g;
  }

  /**
   * Number of dust motes to draw (quality preset). Uses the draw range, so
   * no buffers are reallocated on preset changes.
   * @param {number} count
   */
  setDustCount(count) {
    const n = Math.max(0, Math.min(MAX_DUST, count));
    this.dust.geometry.setDrawRange(0, n);
    this.dust.visible = n > 0;
  }

  /**
   * @param {number} time Seconds.
   * @param {number} pixelRatio
   */
  update(time, pixelRatio) {
    this.material.uniforms.uTime.value = time;
    this.dustMaterial.uniforms.uTime.value = time;
    this.dustMaterial.uniforms.uPixelRatio.value = pixelRatio;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.dust.geometry.dispose();
    this.dustMaterial.dispose();
  }
}
