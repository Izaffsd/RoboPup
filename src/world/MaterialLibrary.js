import {
  ClampToEdgeWrapping,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
} from 'three';
import { RENDER } from '../config/config.js';
import { createFaceScreenMaterial } from '../render/shaders/FaceScreenMaterial.js';
import { patchDogMaterial } from '../render/shaders/materialPatches.js';
import { LIGHTMAP } from './layout.js';

/**
 * Every material in the game, keyed by the slot names written by the
 * procedural generators. All slots use vertex colours (the stylised palette
 * lives in the geometry), so a handful of shared materials covers hundreds
 * of distinct coloured parts.
 */
export class MaterialLibrary {
  /**
   * @param {Record<string, import('three').Texture>} textures KTX2 textures by name.
   * @param {number} maxAnisotropy
   */
  constructor(textures, maxAnisotropy) {
    this.textures = textures;
    for (const tex of Object.values(textures)) {
      tex.wrapS = RepeatWrapping;
      tex.wrapT = RepeatWrapping;
      tex.anisotropy = Math.min(8, maxAnisotropy);
    }
    const bakeLM = textures.bake_lightmap;
    const bakeAO = textures.bake_ao;
    for (const t of [bakeLM, bakeAO]) {
      if (!t) continue;
      t.wrapS = ClampToEdgeWrapping;
      t.wrapT = ClampToEdgeWrapping;
      t.channel = 1;
    }

    /** @type {Map<string, import('three').Material>} */
    this.map = new Map();
    const std = (params) => new MeshStandardMaterial({ vertexColors: true, ...params });

    const paint = std({ name: 'paint', roughness: 0.48, metalness: 0 });
    const matte = std({ name: 'matte', roughness: 0.86, metalness: 0 });
    const fabric = std({ name: 'fabric', roughness: 0.93, map: textures.detail_fabric || null });
    // Standard (not Physical) on purpose: low roughness + environment
    // reflections read as glossy plastic, and the shader shares programs
    // with the other vertex-coloured materials (cheaper to compile/render).
    const gloss = std({ name: 'gloss', roughness: 0.24, metalness: 0 });
    const metal = std({ name: 'metal', roughness: 0.3, metalness: 0.88 });
    const wood = std({ name: 'wood', roughness: 0.6, map: textures.detail_wood || null });
    const leaf = std({ name: 'leaf', roughness: 0.6, side: DoubleSide });
    const doubleMatte = std({ name: 'doubleMatte', roughness: 0.8, side: DoubleSide });
    const glow = new MeshBasicMaterial({
      name: 'glow',
      vertexColors: true,
      color: new Color(2.6, 2.6, 2.6),
    });
    const screen = new MeshBasicMaterial({
      name: 'screen',
      vertexColors: true,
      color: new Color(1.15, 1.15, 1.15),
    });
    const decal = std({
      name: 'decal',
      roughness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const glass = new MeshStandardMaterial({
      name: 'glass',
      color: 0xdff4ff,
      roughness: 0.04,
      metalness: 0.1,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      envMapIntensity: 1.6,
    });
    const wall = std({ name: 'wall', roughness: 0.92, map: textures.detail_plaster || null });
    const ceiling = std({ name: 'ceiling', roughness: 0.95, map: textures.detail_plaster || null });

    for (const m of [
      paint,
      matte,
      fabric,
      gloss,
      metal,
      wood,
      leaf,
      doubleMatte,
      glow,
      screen,
      decal,
      glass,
      wall,
      ceiling,
    ]) {
      this.map.set(m.name, m);
    }
    // Tinted variants share the base material; per-instance colour does the tint.
    this.map.set('tint', paint);
    this.map.set('fabricTint', fabric);
    this.map.set('glossTint', gloss);

    // Floors / walkable surfaces receive the baked lightmap + AO (uv1, top-down).
    const floor = (name, map, roughness, extra = {}) =>
      std({
        name,
        map: map || null,
        roughness,
        lightMap: bakeLM || null,
        lightMapIntensity: LIGHTMAP.scale * RENDER.lightMapIntensity,
        aoMap: bakeAO || null,
        aoMapIntensity: RENDER.aoMapIntensity,
        ...extra,
      });
    this.map.set('floor_wood', floor('floor_wood', textures.floor_wood, 0.5));
    this.map.set('floor_tile_warm', floor('floor_tile_warm', textures.floor_tile_warm, 0.35));
    this.map.set('floor_tile_mint', floor('floor_tile_mint', textures.floor_tile_mint, 0.35));
    this.map.set('floor_epoxy', floor('floor_epoxy', textures.floor_epoxy, 0.3));
    this.map.set('floor_rubber', floor('floor_rubber', textures.detail_rubber, 0.82));
    this.map.set('deck_wood', floor('deck_wood', textures.floor_wood, 0.52));
    this.map.set('deck_play', floor('deck_play', textures.detail_rubber, 0.75));
    this.map.set('deck_soft', floor('deck_soft', textures.detail_fabric, 0.9));
    this.map.set('rug_floor', floor('rug_floor', textures.detail_fabric, 0.95));
    this.map.set(
      'decal_floor',
      floor('decal_floor', null, 0.6, {
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );

    // Robot dog.
    const dogShell = new MeshPhysicalMaterial({
      name: 'dog_shell',
      vertexColors: true,
      roughness: 0.34,
      metalness: 0,
      clearcoat: 0.85,
      clearcoatRoughness: 0.12,
      alphaHash: true,
    });
    const dogMech = std({ name: 'dog_mech', roughness: 0.3, metalness: 0.72, alphaHash: true });
    const dogGlow = new MeshBasicMaterial({
      name: 'dog_glow',
      vertexColors: true,
      color: new Color(2.4, 2.4, 2.4),
      alphaHash: true,
    });
    patchDogMaterial(dogShell);
    patchDogMaterial(dogMech);
    this.map.set('dog_shell', dogShell);
    this.map.set('dog_mech', dogMech);
    this.map.set('dog_glow', dogGlow);
    this.map.set('dog_face', createFaceScreenMaterial());
  }

  /**
   * @param {string} slot
   * @returns {import('three').Material}
   */
  get(slot) {
    const m = this.map.get(slot);
    if (!m) throw new Error(`MaterialLibrary: unknown material slot "${slot}"`);
    return m;
  }

  /**
   * Scale environment reflections (quality preset).
   * @param {number} intensity
   */
  setEnvIntensity(intensity) {
    for (const m of new Set(this.map.values())) {
      if ('envMapIntensity' in m && m.name !== 'glass') m.envMapIntensity = intensity;
    }
  }

  /** Dispose every material and texture. */
  dispose() {
    for (const m of new Set(this.map.values())) m.dispose();
    for (const t of Object.values(this.textures)) t.dispose();
    this.map.clear();
  }
}
