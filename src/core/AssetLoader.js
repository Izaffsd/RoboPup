import { LoadingManager } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Events } from './EventBus.js';
import { assetUrl } from './Preloader.js';

const BASE = import.meta.env.BASE_URL || './';

/**
 * LoadingManager keeps its counters private; this subclass mirrors them so
 * progress can be computed whenever an item starts, ends or streams bytes.
 */
class TrackingManager extends LoadingManager {
  /** @param {(url: string, ended: boolean) => void} onChange */
  constructor(onChange) {
    super();
    this.loaded = 0;
    this.total = 0;
    const start = this.itemStart;
    const end = this.itemEnd;
    this.itemStart = (url) => {
      this.total++;
      start(url);
      onChange(url, false);
    };
    this.itemEnd = (url) => {
      this.loaded++;
      end(url);
      onChange(url, true);
    };
  }
}

/**
 * Loads game data through a single THREE.LoadingManager so the loading screen
 * shows real progress: every network file (GLB, KTX2, Basis transcoder) and
 * every procedural build step (world assembly, audio synthesis, shader
 * compilation) is a tracked item, and in-flight downloads contribute their
 * byte progress.
 */
export class AssetLoader {
  /**
   * @param {import('three').WebGLRenderer} renderer Needed for KTX2 format detection.
   * @param {import('./EventBus.js').EventBus} bus
   * @param {Map<string, ArrayBuffer>} [prefetched] Files already downloaded by the Preloader.
   */
  constructor(renderer, bus, prefetched = new Map()) {
    this.bus = bus;
    this.prefetched = prefetched;
    /** @type {Map<string, number>} In-flight download fractions. */
    this._partial = new Map();
    this._label = 'Starting up';
    this._progress = 0;
    this._payload = { progress: 0, label: '' };
    this.manager = new TrackingManager((url, ended) => {
      if (ended) this._partial.delete(url);
      this._report();
    });
    this.manager.onError = (url) => {
      this.bus.emit(Events.LOAD_FAILED, { url });
    };

    // No transcoder path: KTX2Loader then resolves the Basis transcoder
    // through `new URL(..., import.meta.url)`, which Vite emits as hashed,
    // immutably cacheable files.
    this.ktx2 = new KTX2Loader(this.manager).setWorkerLimit(2).detectSupport(renderer);
    this.gltf = new GLTFLoader(this.manager)
      .setMeshoptDecoder(MeshoptDecoder)
      .setKTX2Loader(this.ktx2);
  }

  /**
   * Pre-register named items so the total is known before work starts and
   * the bar never jumps backwards.
   * @param {string[]} names
   */
  plan(names) {
    for (const name of names) this.manager.itemStart(`task:${name}`);
  }

  /**
   * Run a procedural step registered with {@link AssetLoader#plan}.
   * @template T
   * @param {string} name
   * @param {string} label Text shown on the loading screen.
   * @param {() => Promise<T>|T} fn
   * @returns {Promise<T>}
   */
  async task(name, label, fn) {
    this._label = label;
    this._report();
    const start = performance.now();
    try {
      return await fn();
    } finally {
      // Visible in the browser's performance panel (User Timing).
      performance.measure(`robopup:${name}`, { start, end: performance.now() });
      this.manager.itemEnd(`task:${name}`);
    }
  }

  /**
   * Load (or parse a prefetched) glTF.
   * @param {string} path Relative to /assets.
   * @param {string} label
   * @returns {Promise<import('three/addons/loaders/GLTFLoader.js').GLTF>}
   */
  loadGLTF(path, label) {
    const buffer = this.takePrefetched(path);
    if (!buffer) {
      const url = assetUrl(path);
      return this.gltf.loadAsync(url, (e) => this._onBytes(url, e, label));
    }
    const dir = path.slice(0, path.lastIndexOf('/') + 1);
    return this._tracked(`parse:${path}`, label, () =>
      this.gltf.parseAsync(buffer, `${BASE}assets/${dir}`),
    );
  }

  /**
   * Load (or transcode a prefetched) KTX2 texture.
   * @param {string} path Relative to /assets.
   * @param {string} label
   * @returns {Promise<import('three').CompressedTexture>}
   */
  loadKTX2(path, label) {
    const buffer = this.takePrefetched(path);
    if (!buffer) {
      const url = assetUrl(path);
      return this.ktx2.loadAsync(url, (e) => this._onBytes(url, e, label));
    }
    return this._tracked(
      `parse:${path}`,
      label,
      () => new Promise((resolve, reject) => this.ktx2.parse(buffer, resolve, reject)),
    );
  }

  /** @param {string} path */
  takePrefetched(path) {
    const buffer = this.prefetched.get(path);
    this.prefetched.delete(path);
    return buffer;
  }

  async _tracked(item, label, fn) {
    this.manager.itemStart(item);
    this._label = label;
    try {
      return await fn();
    } finally {
      this.manager.itemEnd(item);
    }
  }

  /** Release loader workers once everything is loaded. */
  dispose() {
    this.ktx2.dispose();
  }

  _onBytes(url, e, label) {
    if (e && e.lengthComputable && e.total > 0) this._partial.set(url, e.loaded / e.total);
    this._label = label;
    this._report();
  }

  _report() {
    const { total, loaded } = this.manager;
    let partial = 0;
    for (const f of this._partial.values()) partial += f;
    const value = total > 0 ? Math.min(1, (loaded + partial * 0.95) / total) : 0;
    this._progress = Math.max(this._progress, value);
    this._payload.progress = this._progress;
    this._payload.label = this._label;
    this.bus.emit(Events.LOAD_PROGRESS, this._payload);
  }
}
