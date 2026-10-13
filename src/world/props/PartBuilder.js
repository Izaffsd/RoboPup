import {
  BufferAttribute,
  Color,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();
const _c2 = new Color();
const _v = new Vector3();

const KEEP = new Set(['position', 'normal', 'uv']);

/**
 * Normalise a geometry so it can be merged with any other: indexed, with
 * position/normal/uv only (colour and skin attributes are added later).
 * @param {import('three').BufferGeometry} geometry
 * @returns {import('three').BufferGeometry}
 */
export function normalizeGeometry(geometry) {
  let g = geometry;
  for (const name of Object.keys(g.attributes)) {
    if (!KEEP.has(name)) g.deleteAttribute(name);
  }
  g.morphAttributes = {};
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute(
      'uv',
      new Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2),
    );
  }
  if (!g.index) g = mergeVertices(g, 1e-5);
  g.clearGroups();
  return g;
}

/**
 * Build a transform matrix from a compact options object.
 * @param {{position?: number[], rotation?: number[], scale?: number[]|number, matrix?: Matrix4}} t
 */
export function makeMatrix(t = {}) {
  if (t.matrix) return _m.copy(t.matrix);
  const p = t.position || [0, 0, 0];
  const r = t.rotation || [0, 0, 0];
  const s = t.scale === undefined ? 1 : t.scale;
  _p.set(p[0], p[1], p[2]);
  _e.set(r[0], r[1], r[2], r[3] || 'XYZ');
  _q.setFromEuler(_e);
  if (Array.isArray(s)) _s.set(s[0], s[1], s[2]);
  else _s.set(s, s, s);
  return _m.compose(_p, _q, _s);
}

/**
 * Collects coloured geometry parts per material and merges them into one
 * BufferGeometry per material (one draw call each).
 *
 * Optional "ground AO": vertex colours darken towards the floor, a cheap
 * precomputed occlusion term that grounds props without any runtime cost.
 */
export class PartBuilder {
  /**
   * @param {object} [options]
   * @param {number} [options.groundAO=0.28] Darkening at y = 0 (0 disables).
   * @param {number} [options.groundAOHeight=0.4] Height over which the darkening fades out.
   * @param {boolean} [options.skinned=false] Add skinIndex/skinWeight attributes.
   */
  constructor({ groundAO = 0.28, groundAOHeight = 0.4, skinned = false } = {}) {
    this.groundAO = groundAO;
    this.groundAOHeight = groundAOHeight;
    this.skinned = skinned;
    /** @type {Map<string, import('three').BufferGeometry[]>} */
    this.parts = new Map();
  }

  /**
   * Add a part.
   * @param {string} material Material slot name.
   * @param {import('three').BufferGeometry} geometry Consumed (do not reuse).
   * @param {object} [opts]
   * @param {number|string|((x:number,y:number,z:number,out:Color)=>void)} [opts.color=0xffffff]
   *   Uniform colour or per-vertex colour function (evaluated in builder space).
   * @param {number[]} [opts.position]
   * @param {number[]} [opts.rotation] Euler XYZ radians (4th entry may set order).
   * @param {number[]|number} [opts.scale]
   * @param {Matrix4} [opts.matrix] Overrides position/rotation/scale.
   * @param {number} [opts.bone] Bone index (skinned builders only).
   * @param {boolean} [opts.noAO] Skip ground AO for this part.
   * @returns {this}
   */
  add(material, geometry, opts = {}) {
    const g = normalizeGeometry(geometry);
    const matrix = makeMatrix(opts);
    g.applyMatrix4(matrix);
    // applyMatrix4 handles normals, but negative scales flip winding: fix it.
    if (matrix.determinant() < 0) flipWinding(g);

    const pos = g.attributes.position;
    const count = pos.count;
    const colors = new Float32Array(count * 3);
    const color = opts.color === undefined ? 0xffffff : opts.color;
    const fn = typeof color === 'function' ? color : null;
    // Color.set() interprets hex as sRGB and stores linear values (vertex colours are linear).
    if (!fn) _c.set(color);
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (fn) fn(x, y, z, _c2);
      const src = fn ? _c2 : _c;
      let ao = 1;
      if (this.groundAO > 0 && !opts.noAO) {
        const t = Math.min(1, Math.max(0, y / this.groundAOHeight));
        ao = 1 - this.groundAO * (1 - t * t * (3 - 2 * t));
      }
      colors[i * 3] = src.r * ao;
      colors[i * 3 + 1] = src.g * ao;
      colors[i * 3 + 2] = src.b * ao;
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));

    if (this.skinned) {
      const bone = opts.bone || 0;
      const idx = new Uint16Array(count * 4);
      const wgt = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        idx[i * 4] = bone;
        wgt[i * 4] = 1;
      }
      g.setAttribute('skinIndex', new BufferAttribute(idx, 4));
      g.setAttribute('skinWeight', new BufferAttribute(wgt, 4));
    }

    let list = this.parts.get(material);
    if (!list) {
      list = [];
      this.parts.set(material, list);
    }
    list.push(g);
    return this;
  }

  /**
   * Merge another builder's parts into this one under a transform.
   * @param {PartBuilder} other
   * @param {object} [transform] Same options as {@link makeMatrix}.
   * @returns {this}
   */
  merge(other, transform) {
    const matrix = makeMatrix(transform).clone();
    const flip = matrix.determinant() < 0;
    for (const [material, list] of other.parts) {
      for (const geom of list) {
        const g = geom.clone();
        g.applyMatrix4(matrix);
        if (flip) flipWinding(g);
        let target = this.parts.get(material);
        if (!target) {
          target = [];
          this.parts.set(material, target);
        }
        target.push(g);
      }
    }
    return this;
  }

  /**
   * Merge every part of another builder into a single material slot.
   * @param {PartBuilder} other
   * @param {string} slot Target slot.
   * @param {object} [transform] Same options as {@link makeMatrix}.
   * @returns {this}
   */
  mergeAs(other, slot, transform) {
    const renamed = new PartBuilder();
    renamed.parts.set(slot, [...other.parts.values()].flat());
    return this.merge(renamed, transform);
  }

  /**
   * Merge all parts per material.
   * @param {object} [options]
   * @param {(slot: string) => boolean} [options.keepUV] Return false to drop UVs
   *   for slots that are never textured (saves memory and download size).
   * @returns {Record<string, import('three').BufferGeometry>}
   */
  build({ keepUV } = {}) {
    const out = {};
    for (const [material, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      if (!merged) throw new Error(`PartBuilder: could not merge parts for "${material}"`);
      if (keepUV && !keepUV(material)) merged.deleteAttribute('uv');
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      out[material] = merged;
      for (const g of list) g.dispose();
    }
    this.parts.clear();
    return out;
  }

  /** Total vertex count (useful for LOD budgeting). */
  vertexCount() {
    let n = 0;
    for (const list of this.parts.values()) for (const g of list) n += g.attributes.position.count;
    return n;
  }
}

/** Reverse triangle winding (after a mirroring transform). */
export function flipWinding(g) {
  const index = g.index;
  if (!index) return;
  const a = index.array;
  for (let i = 0; i < a.length; i += 3) {
    const t = a[i + 1];
    a[i + 1] = a[i + 2];
    a[i + 2] = t;
  }
  index.needsUpdate = true;
}

/**
 * Bake world-space XZ into a `uv1` attribute (top-down lightmap projection).
 * @param {import('three').BufferGeometry} g
 * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} bounds
 */
export function addTopDownUV1(g, bounds) {
  const pos = g.attributes.position;
  const uv1 = new Float32Array(pos.count * 2);
  const sx = bounds.maxX - bounds.minX;
  const sz = bounds.maxZ - bounds.minZ;
  for (let i = 0; i < pos.count; i++) {
    uv1[i * 2] = (pos.getX(i) - bounds.minX) / sx;
    uv1[i * 2 + 1] = 1 - (pos.getZ(i) - bounds.minZ) / sz;
  }
  g.setAttribute('uv1', new BufferAttribute(uv1, 2));
  return g;
}

/**
 * Re-project UVs from a world axis pair (box/planar mapping) so tiled
 * textures keep a constant texel density across differently sized parts.
 * @param {import('three').BufferGeometry} g
 * @param {number} scale Texture repeats per metre.
 */
export function planarUV(g, scale = 1) {
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    _v.set(Math.abs(nor.getX(i)), Math.abs(nor.getY(i)), Math.abs(nor.getZ(i)));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (_v.y >= _v.x && _v.y >= _v.z) uv.setXY(i, x * scale, z * scale);
    else if (_v.x >= _v.z) uv.setXY(i, z * scale, y * scale);
    else uv.setXY(i, x * scale, y * scale);
  }
  uv.needsUpdate = true;
  return g;
}
