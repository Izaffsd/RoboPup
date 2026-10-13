import RAPIER from '@dimforge/rapier3d-compat';
import { SUN_DIRECTION } from '../../src/config/config.js';
import { buildColliderSpecs, createColliderDesc } from '../../src/world/colliderSpecs.js';
import { BOUNDS, LAMPS, LIGHTMAP } from '../../src/world/layout.js';

/**
 * Offline lightmap baker. Ray-traces the very same Rapier colliders the game
 * uses for physics, so baked shadows always match the collision world.
 *
 * Output (top-down projection over the shelter footprint):
 *   - irradiance: direct sunlight through the windows (soft, multi-sample
 *     area-light) + warm pools under the pendant lamps
 *   - ao: cosine-weighted hemisphere ambient occlusion
 *
 * The sample point of each texel is the top-most *walkable* surface under it
 * (floor, deck, ramp, dome), so raised platforms are lit correctly too.
 */

const SUN_COLOR = [1.0, 0.86, 0.66];
const SUN_INTENSITY = 2.7;
const SUN_SOFTNESS = 0.01;
const LAMP_COLOR = [1.0, 0.8, 0.55];
const LAMP_SCALE = 0.11;
/** Lamp shade radius used to soften lamp shadows (area light). */
const LAMP_RADIUS = 0.22;
const LAMP_SAMPLES = 4;
const AO_DISTANCE = 1.25;

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Low-discrepancy 2D sequence (R2). */
function r2(i, out) {
  const g = 1.324717957244746; // plastic number
  out[0] = (0.5 + i / g) % 1;
  out[1] = (0.5 + i / (g * g)) % 1;
  return out;
}

function blur(src, w, h, channels) {
  const dst = new Float32Array(src.length);
  const k = [1, 2, 1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < channels; c++) {
        let sum = 0;
        let wsum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            const wt = k[dx + 1] * k[dy + 1];
            sum += src[(yy * w + xx) * channels + c] * wt;
            wsum += wt;
          }
        }
        dst[(y * w + x) * channels + c] = sum / wsum;
      }
    }
  }
  return dst;
}

const toSRGB = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/**
 * Run the bake.
 * @param {{aoRays?: number, sunRays?: number, log?: (msg: string) => void}} [options]
 * @returns {Promise<{width:number,height:number,lightmap:Uint8Array,ao:Uint8Array}>}
 */
export async function bakeLightmap({ aoRays = 24, sunRays = 12, log = () => {} } = {}) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const floorLike = new Set();
  for (const spec of buildColliderSpecs({ includeBakeOnly: true })) {
    if (spec.tag === 'glass') continue; // sunlight passes through glass
    const desc = createColliderDesc(RAPIER, spec);
    if (!desc) continue;
    const collider = world.createCollider(desc);
    if (spec.tag === 'floor' || spec.tag === 'platform') floorLike.add(collider.handle);
  }
  world.step(); // queries only see colliders after a step

  const W = LIGHTMAP.width;
  const H = LIGHTMAP.height;
  const sx = BOUNDS.maxX - BOUNDS.minX;
  const sz = BOUNDS.maxZ - BOUNDS.minZ;
  const irr = new Float32Array(W * H * 3);
  const AW = W / LIGHTMAP.aoDownsample;
  const AH = H / LIGHTMAP.aoDownsample;
  const aoBuf = new Float32Array(AW * AH);

  const toSun = normalize(SUN_DIRECTION.map((v) => -v));
  // Orthonormal basis around the sun direction for soft-shadow jitter.
  const tA = normalize([toSun[1], -toSun[0], 0]);
  const tB = [
    toSun[1] * tA[2] - toSun[2] * tA[1],
    toSun[2] * tA[0] - toSun[0] * tA[2],
    toSun[0] * tA[1] - toSun[1] * tA[0],
  ];

  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const onlyFloor = (c) => floorLike.has(c.handle);
  const seq = [0, 0];
  const start = performance.now();

  for (let j = 0; j < H; j++) {
    const z = BOUNDS.maxZ - ((j + 0.5) / H) * sz;
    for (let i = 0; i < W; i++) {
      const x = BOUNDS.minX + ((i + 0.5) / W) * sx;
      const idx = j * W + i;

      // Find the walkable surface under this texel.
      ray.origin.x = x;
      ray.origin.y = 1.4;
      ray.origin.z = z;
      ray.dir.x = 0;
      ray.dir.y = -1;
      ray.dir.z = 0;
      const surf = world.castRayAndGetNormal(
        ray,
        3,
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        onlyFloor,
      );
      let px = x;
      let py = 0;
      let pz = z;
      let nx = 0;
      let ny = 1;
      let nz = 0;
      if (surf) {
        py = 1.4 - surf.timeOfImpact;
        nx = surf.normal.x;
        ny = surf.normal.y;
        nz = surf.normal.z;
      }
      px += nx * 0.02;
      py += ny * 0.02;
      pz += nz * 0.02;
      ray.origin.x = px;
      ray.origin.y = py;
      ray.origin.z = pz;

      // Ambient occlusion: cosine-weighted hemisphere, rotated per texel
      // (computed on a coarser grid; AO is low frequency).
      const ds = LIGHTMAP.aoDownsample;
      if (i % ds === 0 && j % ds === 0) {
        const ta = Math.abs(ny) < 0.9 ? normalize([-nz, 0, nx]) : [1, 0, 0];
        const tb = [ny * ta[2] - nz * ta[1], nz * ta[0] - nx * ta[2], nx * ta[1] - ny * ta[0]];
        const rot = ((i * 0.7548776662 + j * 0.56984029) % 1) * Math.PI * 2;
        let occlusion = 0;
        for (let s = 0; s < aoRays; s++) {
          r2(s, seq);
          const r = Math.sqrt(seq[0]);
          const phi = seq[1] * Math.PI * 2 + rot;
          const lx = r * Math.cos(phi);
          const lz = r * Math.sin(phi);
          const ly = Math.sqrt(Math.max(0, 1 - seq[0]));
          ray.dir.x = ta[0] * lx + tb[0] * lz + nx * ly;
          ray.dir.y = ta[1] * lx + tb[1] * lz + ny * ly;
          ray.dir.z = ta[2] * lx + tb[2] * lz + nz * ly;
          const hit = world.castRay(ray, AO_DISTANCE, true);
          if (hit) occlusion += Math.pow(1 - hit.timeOfImpact / AO_DISTANCE, 0.6);
        }
        aoBuf[(j / ds) * AW + i / ds] = Math.max(0, 1 - occlusion / aoRays);
      }

      // Sun (soft area light through the windows).
      const ndl = Math.max(0, nx * toSun[0] + ny * toSun[1] + nz * toSun[2]);
      let sun = 0;
      if (ndl > 0) {
        let lit = 0;
        for (let s = 0; s < sunRays; s++) {
          r2(s + 7, seq);
          const rr = Math.sqrt(seq[0]) * SUN_SOFTNESS;
          const a = seq[1] * Math.PI * 2;
          const ox = Math.cos(a) * rr;
          const oy = Math.sin(a) * rr;
          const d = normalize([
            toSun[0] + tA[0] * ox + tB[0] * oy,
            toSun[1] + tA[1] * ox + tB[1] * oy,
            toSun[2] + tA[2] * ox + tB[2] * oy,
          ]);
          ray.dir.x = d[0];
          ray.dir.y = d[1];
          ray.dir.z = d[2];
          if (!world.castRay(ray, 80, true)) lit++;
        }
        sun = (lit / sunRays) * ndl * SUN_INTENSITY;
      }
      let r = sun * SUN_COLOR[0];
      let g = sun * SUN_COLOR[1];
      let b = sun * SUN_COLOR[2];

      // Pendant lamp pools.
      for (const lamp of LAMPS) {
        const dx = lamp.x - px;
        const dy = lamp.y - 0.06 - py;
        const dz = lamp.z - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 64) continue;
        const d = Math.sqrt(d2);
        const cos = (dx * nx + dy * ny + dz * nz) / d;
        if (cos <= 0) continue;
        // Area light: visibility averaged over points on the shade's opening,
        // which gives soft lamp shadows instead of hard point-light edges.
        let vis = 0;
        for (let s = 0; s < LAMP_SAMPLES; s++) {
          const a = (s / LAMP_SAMPLES) * Math.PI * 2 + (i + j) * 0.37;
          const sx = dx + Math.cos(a) * LAMP_RADIUS;
          const sz = dz + Math.sin(a) * LAMP_RADIUS;
          const sd = Math.hypot(sx, dy, sz);
          ray.dir.x = sx / sd;
          ray.dir.y = dy / sd;
          ray.dir.z = sz / sd;
          if (!world.castRay(ray, sd - 0.3, true)) vis++;
        }
        if (vis === 0) continue;
        // Cone-shaped shade: most light goes straight down, a little spills sideways.
        const cone = 0.15 + 0.85 * Math.pow(Math.max(0, dy / d), 1.5);
        const e =
          ((vis / LAMP_SAMPLES) * lamp.intensity * LAMP_SCALE * cos * cone) / (d2 * 0.12 + 0.35);
        r += e * LAMP_COLOR[0];
        g += e * LAMP_COLOR[1];
        b += e * LAMP_COLOR[2];
      }
      irr[idx * 3] = r;
      irr[idx * 3 + 1] = g;
      irr[idx * 3 + 2] = b;
    }
    if (j % 96 === 0)
      log(`  bake row ${j}/${H} (${((performance.now() - start) / 1000).toFixed(1)}s)`);
  }
  world.free();

  // Direct light keeps its crisp window/mullion edges (area-light sampling
  // already softens them); AO gets a light blur to remove sampling noise.
  const aoB = blur(aoBuf, AW, AH, 1);
  const lightmap = new Uint8Array(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    for (let c = 0; c < 3; c++) {
      const v = Math.min(1, irr[p * 3 + c] / LIGHTMAP.scale);
      lightmap[p * 4 + c] = Math.round(toSRGB(v) * 255);
    }
    lightmap[p * 4 + 3] = 255;
  }
  const ao = new Uint8Array(AW * AH * 4);
  for (let p = 0; p < AW * AH; p++) {
    const a = Math.round(Math.min(1, Math.max(0, aoB[p])) * 255);
    ao[p * 4] = a;
    ao[p * 4 + 1] = a;
    ao[p * 4 + 2] = a;
    ao[p * 4 + 3] = 255;
  }
  log(`  bake done in ${((performance.now() - start) / 1000).toFixed(1)}s`);
  return { width: W, height: H, aoWidth: AW, aoHeight: AH, lightmap, ao };
}
