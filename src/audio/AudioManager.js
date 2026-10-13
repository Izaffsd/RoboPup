import { Audio, AudioListener, PositionalAudio } from 'three';
import { AUDIO } from '../config/config.js';
import { Events } from '../core/EventBus.js';
import { AUDIO_EMITTERS } from '../world/layout.js';
import { SOUND_LIST, SR } from './SoundSynth.js';

const rand = (a, b) => a + Math.random() * (b - a);

/** Voice chirp and playback rate per emote. */
const EMOTE_SOUNDS = Object.freeze({
  sit: ['chirpHappy', 1],
  beg: ['chirpHappy', 1.15],
  wag: ['chirpHappy', 1.08],
  zoomies: ['chirpExcited', 1],
  rollOver: ['chirpExcited', 0.9],
  playBow: ['chirpExcited', 1.1],
  sleep: ['chirpSleepy', 1],
});

/**
 * Game audio on top of three.js' Web Audio wrappers.
 *
 * - Sounds are synthesised during loading (CPU only, no AudioContext yet).
 * - The AudioListener/AudioContext is created on the first user gesture, so
 *   no autoplay-policy warnings are ever triggered.
 * - Three buses (master → listener, SFX, ambience) back the volume sliders.
 * - One-shot player sounds use a pool of THREE.Audio; toy impacts use a pool
 *   of THREE.PositionalAudio placed at the impact point.
 * - Ambience: room tone bed, positional ventilation hum and water dispenser
 *   loops, and randomly scheduled distant dog barks from behind kennel doors.
 */
export class AudioManager {
  /**
   * @param {object} deps
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {import('../core/SettingsStore.js').SettingsStore} deps.settings
   * @param {import('three').Camera} deps.camera
   * @param {import('three').Scene} deps.scene
   */
  constructor({ bus, settings, camera, scene }) {
    this.bus = bus;
    this.settings = settings;
    this.camera = camera;
    this.scene = scene;
    /** @type {Map<string, Float32Array>} */
    this.pcm = new Map();
    /** @type {Map<string, AudioBuffer>} */
    this.buffers = new Map();
    this.listener = null;
    this.ready = false;
    /** True when the browser has no Web Audio support (game runs silently). */
    this.unavailable = false;
    this.active = false;
    this._sfxPool = [];
    this._posPool = [];
    this._sfxIndex = 0;
    this._posIndex = 0;
    this._loops = [];
    this._kennelSources = [];
    this._barkTimer = rand(...AUDIO.distantBarkInterval);
    this._stepIndex = 0;
    this._sleeping = false;
    this._snoreTimer = 0;

    this._unsubs = [
      bus.on(Events.USER_GESTURE, () => this.unlock()),
      bus.on(Events.SETTINGS_CHANGED, ({ key }) => {
        if (key.endsWith('Volume')) this._applyVolumes();
      }),
      bus.on(Events.PLAYER_FOOTSTEP, (e) => this._footstep(e)),
      bus.on(Events.PLAYER_JUMP, () => this.play('jump', AUDIO.jumpVolume, rand(0.95, 1.05))),
      bus.on(Events.PLAYER_LAND, (e) => {
        if (e.impact > 1.6)
          this.play('land', AUDIO.landVolume * Math.min(1, e.impact / 7), rand(0.92, 1.05));
      }),
      bus.on(Events.PLAYER_BARK, () =>
        this.play(`bark${Math.floor(Math.random() * 3)}`, AUDIO.barkVolume, rand(0.96, 1.06)),
      ),
      bus.on(Events.TOY_IMPACT, (e) => this._toyImpact(e)),
      bus.on(Events.EMOTE_START, ({ id }) => {
        const [name, rate] = EMOTE_SOUNDS[id] || EMOTE_SOUNDS.sit;
        this.play(name, AUDIO.emoteVolume, rate * rand(0.97, 1.03));
        this._sleeping = id === 'sleep';
        this._snoreTimer = AUDIO.snoreInterval * 0.6;
      }),
      bus.on(Events.EMOTE_END, () => {
        this._sleeping = false;
      }),
      bus.on(Events.PHOTO_CAPTURED, () => this.play('shutter', AUDIO.shutterVolume, 1)),
      bus.on(Events.UI_SOUND, (kind) => this.ui(kind)),
      bus.on(Events.GAME_START, () => this.setActive(true)),
      bus.on(Events.GAME_RESUME, () => this.setActive(true)),
      bus.on(Events.GAME_PAUSE, () => this.setActive(false)),
      bus.on(Events.GAME_QUIT, () => this.setActive(false)),
    ];
    this._onVisibility = () => {
      if (!this.listener) return;
      const ctx = this.listener.context;
      // These promises reject when the page is being unloaded; that is fine.
      if (document.hidden) ctx.suspend().catch(() => {});
      else ctx.resume().catch(() => {});
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  /**
   * Synthesise every sound (call during loading; yields between sounds).
   * @param {() => Promise<void>} step
   */
  async prepare(step) {
    for (const [name, gen] of SOUND_LIST) {
      this.pcm.set(name, gen());
      await step();
    }
  }

  /** Create the audio graph. Safe to call repeatedly; only acts inside a user gesture. */
  unlock() {
    if (this.unavailable) return;
    if (this.listener) {
      if (this.listener.context.state === 'suspended' && !document.hidden)
        this.listener.context.resume().catch(() => {});
      return;
    }
    if (this.pcm.size === 0) return;
    try {
      this.listener = new AudioListener();
    } catch {
      // No Web Audio in this browser/embedding: the game runs silently.
      this.unavailable = true;
      this.pcm.clear();
      return;
    }
    this.camera.add(this.listener);
    const ctx = this.listener.context;

    for (const [name, data] of this.pcm) {
      const b = new AudioBuffer({ length: data.length, numberOfChannels: 1, sampleRate: SR });
      b.copyToChannel(data, 0);
      this.buffers.set(name, b);
    }
    this.pcm.clear();

    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.sfxBus.connect(this.listener.getInput());
    this.ambBus.connect(this.listener.getInput());

    for (let i = 0; i < AUDIO.sfxPoolSize; i++) {
      const a = new Audio(this.listener);
      this._route(a, this.sfxBus);
      this._sfxPool.push(a);
    }
    for (let i = 0; i < AUDIO.positionalPoolSize; i++) {
      const a = new PositionalAudio(this.listener);
      a.setRefDistance(2.5);
      a.setRolloffFactor(1.4);
      a.setMaxDistance(40);
      a.panner.panningModel = 'equalpower';
      this._route(a, this.sfxBus);
      this.scene.add(a);
      this._posPool.push(a);
    }

    const room = new Audio(this.listener);
    this._route(room, this.ambBus);
    room.setBuffer(this.buffers.get('room'));
    room.setLoop(true);
    room.setVolume(0.32);
    this._loops.push(room);

    for (const e of AUDIO_EMITTERS) {
      if (e.kind === 'kennels') {
        const k = new PositionalAudio(this.listener);
        k.setRefDistance(6);
        k.setRolloffFactor(0.9);
        k.position.set(e.x, e.y, e.z);
        this._route(k, this.ambBus);
        this.scene.add(k);
        this._kennelSources.push(k);
        continue;
      }
      const loop = new PositionalAudio(this.listener);
      loop.setBuffer(this.buffers.get(e.kind === 'vent' ? 'vent' : 'water'));
      loop.setLoop(true);
      loop.setRefDistance(e.kind === 'vent' ? 3 : 1.6);
      loop.setRolloffFactor(e.kind === 'vent' ? 1.1 : 1.6);
      loop.setVolume(e.kind === 'vent' ? 0.55 : 0.6);
      loop.position.set(e.x, e.y, e.z);
      this._route(loop, this.ambBus);
      this.scene.add(loop);
      this._loops.push(loop);
    }

    this._applyVolumes();
    this.ready = true;
    for (const loop of this._loops) loop.play(rand(0, 0.5));
    if (ctx.state !== 'running') {
      ctx.resume().catch(() => {});
      // Some browsers only allow resuming inside a gesture: retry on the next one.
      const retry = () => {
        if (ctx.state === 'running' || document.hidden) return;
        ctx
          .resume()
          .then(() => {
            if (ctx.state === 'running') removeRetry();
          })
          .catch(() => {});
      };
      const removeRetry = () => {
        for (const type of ['pointerdown', 'keydown', 'touchend'])
          window.removeEventListener(type, retry, true);
      };
      for (const type of ['pointerdown', 'keydown', 'touchend'])
        window.addEventListener(type, retry, true);
      this._removeResumeRetry = removeRetry;
    }
  }

  /** Route a three.js audio node's output into one of our buses. */
  _route(audio, bus) {
    audio.gain.disconnect();
    audio.gain.connect(bus);
  }

  _applyVolumes() {
    if (!this.listener) return;
    const s = this.settings;
    const t = this.listener.context.currentTime;
    this.listener.setMasterVolume(s.get('masterVolume') * (this.active ? 1 : 0.55));
    this.sfxBus.gain.setTargetAtTime(s.get('sfxVolume'), t, 0.02);
    this.ambBus.gain.setTargetAtTime(s.get('ambienceVolume'), t, 0.05);
  }

  /** Gameplay audio on/off (menus duck the mix and stop scheduled barks). */
  setActive(active) {
    this.active = active;
    this._applyVolumes();
  }

  /**
   * Play a one-shot non-positional sound.
   * @param {string} name
   * @param {number} [volume=1]
   * @param {number} [rate=1]
   */
  play(name, volume = 1, rate = 1) {
    if (!this.ready) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const a = this._sfxPool[this._sfxIndex];
    this._sfxIndex = (this._sfxIndex + 1) % this._sfxPool.length;
    if (a.isPlaying) a.stop();
    a.setBuffer(buffer);
    a.setPlaybackRate(rate);
    a.setVolume(volume);
    a.play();
  }

  /**
   * Play a positional one-shot at a world position.
   * @param {string} name
   * @param {number} x @param {number} y @param {number} z
   * @param {number} [volume=1]
   * @param {number} [rate=1]
   */
  playAt(name, x, y, z, volume = 1, rate = 1) {
    if (!this.ready) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const a = this._posPool[this._posIndex];
    this._posIndex = (this._posIndex + 1) % this._posPool.length;
    if (a.isPlaying) a.stop();
    a.position.set(x, y, z);
    a.updateMatrixWorld();
    a.setBuffer(buffer);
    a.setPlaybackRate(rate);
    a.setVolume(volume);
    a.play();
  }

  /** UI feedback blip (menus). */
  ui(kind) {
    this.play(kind === 'hover' ? 'uiHover' : 'uiClick', 0.6, 1);
  }

  _footstep(e) {
    if (!this.active) return;
    this._stepIndex = (this._stepIndex + 1) % 4;
    this.play(`step${this._stepIndex}`, AUDIO.footstepVolume * e.intensity, rand(0.92, 1.08));
  }

  _toyImpact(e) {
    if (!this.active) return;
    const variant = Math.random() < 0.5 ? 0 : 1;
    const name = e.kind === 'plush' ? 'plush' : `${e.kind}${variant}`;
    this.playAt(name, e.x, e.y, e.z, AUDIO.toyVolume * (0.35 + e.strength * 0.65), rand(0.9, 1.12));
  }

  /** @param {number} dt */
  update(dt) {
    if (!this.ready || !this.active) return;
    if (this._sleeping) {
      this._snoreTimer -= dt;
      if (this._snoreTimer <= 0) {
        this._snoreTimer = AUDIO.snoreInterval * rand(0.9, 1.1);
        this.play('snore', AUDIO.snoreVolume, rand(0.95, 1.05));
      }
    }
    this._barkTimer -= dt;
    if (this._barkTimer > 0) return;
    this._barkTimer = rand(...AUDIO.distantBarkInterval);
    const src = this._kennelSources[Math.floor(Math.random() * this._kennelSources.length)];
    if (!src) return;
    if (src.isPlaying) src.stop();
    src.setBuffer(this.buffers.get(`distant${Math.floor(Math.random() * 3)}`));
    src.setPlaybackRate(rand(0.9, 1.1));
    src.setVolume(rand(0.5, 0.9));
    src.play();
  }

  dispose() {
    if (this._removeResumeRetry) this._removeResumeRetry();
    for (const u of this._unsubs) u();
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (!this.listener) return;
    for (const a of [...this._sfxPool, ...this._posPool, ...this._loops, ...this._kennelSources]) {
      if (a.isPlaying) a.stop();
      if (a.parent) a.parent.remove(a);
    }
    this.camera.remove(this.listener);
    // Closing the context releases every node of the graph.
    this.listener.context.close();
  }
}
