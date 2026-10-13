import { ASSET_MANIFEST } from '../config/assetManifest.js';

const BASE = import.meta.env.BASE_URL || './';

/** Every file the game needs from public/assets (from the generated manifest). */
export const GAME_ASSETS = Object.freeze(Object.keys(ASSET_MANIFEST));

/**
 * Cache-busted URL for a file in public/assets (`?v=<content hash>`), so the
 * files can be served with immutable long-term caching.
 * @param {string} path Relative to /assets.
 */
export function assetUrl(path) {
  const entry = ASSET_MANIFEST[path];
  return `${BASE}assets/${path}${entry ? `?v=${entry.hash}` : ''}`;
}

/**
 * Download game assets while the start menu is being shown.
 *
 * This module deliberately has no three.js dependency: on page load only the
 * network is busy (no parsing, decoding or GPU work), which keeps the page
 * responsive. Progress is real — bytes received out of the byte sizes
 * recorded in the asset manifest.
 *
 * @param {(progress: number) => void} onProgress 0..1
 * @param {string[]} [paths]
 * @returns {Promise<Map<string, ArrayBuffer>>}
 */
export async function preloadAssets(onProgress, paths = GAME_ASSETS) {
  const total = paths.reduce((sum, p) => sum + (ASSET_MANIFEST[p]?.bytes || 0), 0) || 1;
  const received = new Map();
  const report = () => {
    let sum = 0;
    for (const v of received.values()) sum += v;
    onProgress(Math.min(1, sum / total));
  };

  const fetchOne = async (path) => {
    const response = await fetch(assetUrl(path));
    if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status}`);
    if (!response.body || typeof response.body.getReader !== 'function') {
      const buffer = await response.arrayBuffer();
      received.set(path, buffer.byteLength);
      report();
      return [path, buffer];
    }
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      length += value.byteLength;
      received.set(path, length);
      report();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return [path, bytes.buffer];
  };

  // One retry per file absorbs transient network hiccups.
  const fetchWithRetry = (path) =>
    fetchOne(path).catch(() => {
      received.set(path, 0);
      return fetchOne(path);
    });
  const entries = await Promise.all(paths.map(fetchWithRetry));
  onProgress(1);
  return new Map(entries);
}
