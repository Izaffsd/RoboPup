import { Color, Euler, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { PROP_CATALOG } from './propCatalog.js';
import { PASTEL_TINTS } from './props/palette.js';

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _e = new Euler();

/**
 * Parse the prop library GLB into `name → LOD[] → parts`, where each part is
 * { geometry, slot, matrix } and `matrix` is the mesh's transform relative to
 * its prop root (it includes the dequantisation transform added by Meshopt
 * quantisation, so geometry is used as-is, still quantised on the GPU).
 * @param {import('three').Object3D} root gltf.scene
 * @returns {Map<string, {geometry: import('three').BufferGeometry, slot: string, matrix: Matrix4}[][]>}
 */
export function parsePropLibrary(root) {
  root.updateMatrixWorld(true);
  const lib = new Map();
  const loaderMaterials = new Set();
  root.traverse((obj) => {
    if (!/^(prop|toy)_/.test(obj.name)) return;
    const [base, lodStr] = obj.name.split('@');
    const lod = lodStr ? Number(lodStr) : 0;
    const inv = new Matrix4().copy(obj.matrixWorld).invert();
    const parts = [];
    obj.traverse((child) => {
      if (!child.isMesh) return;
      loaderMaterials.add(child.material);
      parts.push({
        geometry: child.geometry,
        slot: child.material.name,
        matrix: new Matrix4().multiplyMatrices(inv, child.matrixWorld),
      });
    });
    if (!lib.has(base)) lib.set(base, []);
    lib.get(base)[lod] = parts;
  });
  // Placeholder materials from the file are replaced by the MaterialLibrary.
  for (const m of loaderMaterials) m.dispose();
  return lib;
}

const isTintSlot = (slot) => slot === 'tint' || slot.endsWith('Tint');

function hash2(x, z) {
  const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * Renders static props with one InstancedMesh per (prop type × LOD × material
 * slot). Props listed with LOD distances in the catalogue are re-bucketed
 * between their LOD meshes by camera distance a few times per second.
 */
export class PropInstancer {
  /**
   * @param {ReturnType<typeof parsePropLibrary>} lib
   * @param {import('./MaterialLibrary.js').MaterialLibrary} materials
   * @param {{type:string,x:number,y?:number,z:number,rotY:number,scale?:number,tint?:number,tintColor?:number}[]} placements
   * @param {{castShadow?: boolean, name?: string}} [options]
   */
  constructor(lib, materials, placements, { castShadow = false, name = 'Props' } = {}) {
    this.group = new Group();
    this.group.name = name;
    /** Types with more than one LOD level. */
    this.lodEntries = [];
    this._lastLodPos = new Vector3(Infinity, 0, 0);
    this._lodTimer = 0;
    this.instanceCount = 0;

    const byType = new Map();
    for (const p of placements) {
      if (!byType.has(p.type)) byType.set(p.type, []);
      byType.get(p.type).push(p);
    }

    for (const [type, list] of byType) {
      const lods = lib.get(`prop_${type}`);
      if (!lods) throw new Error(`PropInstancer: prop "${type}" missing from library`);
      const matrices = list.map((p) => {
        _p.set(p.x, p.y || 0, p.z);
        _q.setFromEuler(_e.set(0, p.rotY || 0, 0));
        const s = p.scale || 1;
        _s.set(s, s, s);
        return new Matrix4().compose(_p, _q, _s);
      });
      const tints = list.map((p) => new Color(tintFor(type, p)));
      const entry = {
        type,
        matrices,
        tints,
        positions: list.map((p) => new Vector3(p.x, p.y || 0, p.z)),
        distances: (PROP_CATALOG[type] && PROP_CATALOG[type].lod) || [0],
        levels: [],
        counts: new Int32Array(lods.length),
      };

      lods.forEach((parts, lod) => {
        const meshes = [];
        for (const part of parts) {
          const mesh = new InstancedMesh(part.geometry, materials.get(part.slot), list.length);
          mesh.name = `${type}@${lod}|${part.slot}`;
          mesh.matrixAutoUpdate = false;
          mesh.castShadow = castShadow;
          mesh.receiveShadow = true;
          const tinted = isTintSlot(part.slot);
          for (let i = 0; i < list.length; i++) {
            _m.multiplyMatrices(matrices[i], part.matrix);
            mesh.setMatrixAt(i, _m);
            if (tinted) mesh.setColorAt(i, tints[i]);
          }
          // Bounds cover every placement so culling stays correct whatever
          // subset a LOD level currently draws.
          mesh.computeBoundingSphere();
          mesh.computeBoundingBox();
          if (lods.length > 1 && lod > 0) {
            mesh.count = 0;
            mesh.visible = false;
          }
          meshes.push({ mesh, partMatrix: part.matrix, tinted });
          this.group.add(mesh);
        }
        entry.levels.push(meshes);
      });
      this.instanceCount += list.length;
      if (lods.length > 1) this.lodEntries.push(entry);
    }
  }

  /**
   * Re-bucket LOD instances by distance (throttled internally).
   * @param {Vector3} cameraPosition
   * @param {number} distanceScale Preset multiplier for LOD switch distances.
   * @param {number} dt
   * @param {boolean} [force]
   */
  updateLOD(cameraPosition, distanceScale, dt, force = false) {
    this._lodTimer -= dt;
    if (!force && this._lodTimer > 0 && cameraPosition.distanceToSquared(this._lastLodPos) < 1)
      return;
    this._lodTimer = 0.25;
    this._lastLodPos.copy(cameraPosition);
    for (const entry of this.lodEntries) {
      entry.counts.fill(0);
      const switchAt = entry.distances[1] * distanceScale;
      const switchSq = switchAt * switchAt;
      for (let i = 0; i < entry.matrices.length; i++) {
        const level = entry.positions[i].distanceToSquared(cameraPosition) > switchSq ? 1 : 0;
        const slot = entry.counts[level]++;
        for (const { mesh, partMatrix, tinted } of entry.levels[level]) {
          _m.multiplyMatrices(entry.matrices[i], partMatrix);
          mesh.setMatrixAt(slot, _m);
          if (tinted) mesh.setColorAt(slot, entry.tints[i]);
        }
      }
      entry.levels.forEach((meshes, level) => {
        for (const { mesh, tinted } of meshes) {
          mesh.count = entry.counts[level];
          mesh.visible = mesh.count > 0;
          mesh.instanceMatrix.needsUpdate = true;
          if (tinted && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      });
    }
  }

  /** Dispose GPU instance buffers (geometries/materials are owned elsewhere). */
  dispose() {
    this.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
  }
}

/** Per-instance tint colour. */
function tintFor(type, p) {
  if (p.tintColor !== undefined) return p.tintColor;
  if (type === 'weavePole') return p.tint ? 0xffd34a : 0xff5f5f;
  const idx = Math.floor(hash2(p.x, p.z) * PASTEL_TINTS.length) % PASTEL_TINTS.length;
  return PASTEL_TINTS[idx];
}
