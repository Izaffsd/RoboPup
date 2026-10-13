/**
 * Offline asset pipeline (run with `npm run assets`, outputs are committed).
 *
 *   textures  procedural tileable textures  → KTX2 (Basis ETC1S, sRGB, mipmapped)
 *   bake      Rapier ray-traced floor lightmap + AO → KTX2 (Basis UASTC + Zstd)
 *   models    procedural robot dog + props + toys → GLB → Meshopt + quantization
 *   manifest  content hashes for cache-busting → src/config/assetManifest.js
 *
 * Options:
 *   --only=textures,bake,models   run a subset (manifest always runs)
 *   --preview=<dir>                     also write PNG previews of textures/bakes
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeToKTX2 } from 'ktx2-encoder';
import { Group, Mesh, MeshStandardMaterial } from 'three';
import { buildRobotDog } from '../src/player/robotDogGeometry.js';
import { PROP_GENERATORS, TOY_GENERATORS } from '../src/world/props/index.js';
import { planarUV } from '../src/world/props/PartBuilder.js';
import { compressGLB, exportGLB } from './assetgen/gltfExport.mjs';
import { bakeLightmap } from './assetgen/lightmapBake.mjs';
import { encodePNG } from './assetgen/png.mjs';
import { textureSet } from './assetgen/textures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'assets');
const MANIFEST = path.join(ROOT, 'src', 'config', 'assetManifest.js');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const only = args.only ? new Set(String(args.only).split(',')) : null;
const want = (step) => !only || only.has(step);
const previewDir = typeof args.preview === 'string' ? path.resolve(args.preview) : null;

const log = (msg) => process.stdout.write(`${msg}\n`);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/**
 * Encode an RGBA8 image to KTX2. The encoder's WASM prints progress to
 * stdout; that output is harmless and only appears while running the pipeline.
 */
async function encodeKTX2(image, { srgb, uastc, quality = 160, rdo = false }) {
  return encodeToKTX2(new Uint8Array(1), {
    isUASTC: uastc,
    enableRDO: rdo,
    rdoQualityLevel: 1.2,
    generateMipmap: true,
    isKTX2File: true,
    isPerceptual: srgb,
    isSetKTX2SRGBTransferFunc: srgb,
    qualityLevel: quality,
    compressionLevel: 2,
    needSupercompression: uastc,
    uastcLDRQualityLevel: 2,
    imageDecoder: async () => image,
  });
}

async function writePreview(name, image) {
  if (!previewDir) return;
  await mkdir(previewDir, { recursive: true });
  await writeFile(path.join(previewDir, `${name}.png`), encodePNG(image));
}

async function stepTextures() {
  log('• textures');
  const dir = path.join(OUT, 'textures');
  await mkdir(dir, { recursive: true });
  for (const t of textureSet()) {
    const image = t.image();
    const ktx = await encodeKTX2(image, { srgb: true, uastc: false, quality: t.quality });
    await writeFile(path.join(dir, `${t.name}.ktx2`), ktx);
    await writePreview(t.name, image);
    log(`  ${t.name}.ktx2  ${image.width}²  ${kb(ktx.byteLength)}`);
  }
}

async function stepBake() {
  log('• lightmap bake');
  const dir = path.join(OUT, 'textures');
  await mkdir(dir, { recursive: true });
  const result = await bakeLightmap({ log });
  const lm = { width: result.width, height: result.height, data: result.lightmap };
  const ao = { width: result.aoWidth, height: result.aoHeight, data: result.ao };
  const lmKtx = await encodeKTX2(lm, { srgb: true, uastc: true, rdo: true });
  const aoKtx = await encodeKTX2(ao, { srgb: false, uastc: true, rdo: true });
  await writeFile(path.join(dir, 'bake_lightmap.ktx2'), lmKtx);
  await writeFile(path.join(dir, 'bake_ao.ktx2'), aoKtx);
  await writePreview('bake_lightmap', lm);
  await writePreview('bake_ao', ao);
  log(`  bake_lightmap.ktx2 ${kb(lmKtx.byteLength)}, bake_ao.ktx2 ${kb(aoKtx.byteLength)}`);
}

/** Slots that sample a detail texture at runtime, with their repeats per metre. */
const TEXTURE_DENSITY = Object.freeze({ wood: 2.2, fabric: 3.5, fabricTint: 3.5 });

function slotMaterialFactory() {
  const cache = new Map();
  return (slot) => {
    if (!cache.has(slot))
      cache.set(slot, new MeshStandardMaterial({ name: slot, vertexColors: true }));
    return cache.get(slot);
  };
}

async function stepModels() {
  log('• models');
  const dir = path.join(OUT, 'models');
  await mkdir(dir, { recursive: true });

  // Robot dog.
  const dog = buildRobotDog();
  const dogGlb = await compressGLB(await exportGLB(dog));
  await writeFile(path.join(dir, 'robodog.glb'), dogGlb);
  log(`  robodog.glb  ${kb(dogGlb.byteLength)}`);

  // Props + toys in one library file. Node names avoid ':' because GLTFLoader
  // strips reserved PropertyBinding characters; material names carry the slot.
  const material = slotMaterialFactory();
  const scene = new Group();
  scene.name = 'PropLibrary';
  let verts = 0;
  const addEntry = (name, builder) => {
    const group = new Group();
    group.name = name;
    const parts = builder.build({ keepUV: (slot) => slot in TEXTURE_DENSITY });
    for (const [slot, geometry] of Object.entries(parts)) {
      if (slot in TEXTURE_DENSITY) planarUV(geometry, TEXTURE_DENSITY[slot]);
      verts += geometry.attributes.position.count;
      const mesh = new Mesh(geometry, material(slot));
      mesh.name = `${name}|${slot}`;
      group.add(mesh);
    }
    scene.add(group);
  };
  for (const [type, lods] of Object.entries(PROP_GENERATORS)) {
    lods.forEach((gen, lod) => addEntry(lod === 0 ? `prop_${type}` : `prop_${type}@${lod}`, gen()));
  }
  for (const [type, gen] of Object.entries(TOY_GENERATORS)) addEntry(`toy_${type}`, gen());
  const raw = await exportGLB(scene);
  const propsGlb = await compressGLB(raw);
  await writeFile(path.join(dir, 'props.glb'), propsGlb);
  log(`  props.glb  ${verts} verts, ${kb(raw.byteLength)} → ${kb(propsGlb.byteLength)}`);
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

async function stepManifest() {
  log('• manifest');
  const files = await walk(OUT);
  const entries = [];
  let total = 0;
  for (const rel of files) {
    const buf = await readFile(path.join(OUT, rel));
    total += buf.byteLength;
    const hash = createHash('sha1').update(buf).digest('hex').slice(0, 10);
    entries.push(`  '${rel}': Object.freeze({ hash: '${hash}', bytes: ${buf.byteLength} }),`);
  }
  const src = [
    '// Generated by scripts/build-assets.mjs — do not edit by hand.',
    '// Content hashes are appended to asset URLs so they can be cached immutably.',
    'export const ASSET_MANIFEST = Object.freeze({',
    ...entries,
    '});',
    '',
  ].join('\n');
  await writeFile(MANIFEST, src);
  log(`  ${files.length} files, ${kb(total)} total`);
}

const t0 = performance.now();
if (want('textures')) await stepTextures();
if (want('bake')) await stepBake();
if (want('models')) await stepModels();
await stepManifest();
log(`done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
