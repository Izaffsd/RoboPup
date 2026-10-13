import {
  AudioContext as ThreeAudioContext,
  MathUtils,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three';
import { AudioManager } from '../audio/AudioManager.js';
import { PhotoMode } from '../camera/PhotoMode.js';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera.js';
import { CAMERA, PLAYER, QUALITY_PRESETS, RENDER, SUN_DIRECTION } from '../config/config.js';
import { CharacterController } from '../physics/CharacterController.js';
import { PhysicsWorld, QUERY_IGNORE_GLASS } from '../physics/PhysicsWorld.js';
import { DogAnimator } from '../player/DogAnimator.js';
import { DogController } from '../player/DogController.js';
import { EmoteSystem } from '../player/EmoteSystem.js';
import { FaceController } from '../player/FaceController.js';
import { RobotDog } from '../player/RobotDog.js';
import { GpuTimer } from '../render/GpuTimer.js';
import { PostFX } from '../render/PostFX.js';
import { QualityManager } from '../render/QualityManager.js';
import { Renderer } from '../render/Renderer.js';
import { collectPassMaterials, compileMaterials, waitForGpu } from '../render/gpuSync.js';
import { dogLightingUniforms } from '../render/shaders/materialPatches.js';
import { DebugOverlay } from '../ui/DebugOverlay.js';
import { EmoteWheel } from '../ui/EmoteWheel.js';
import { HUD } from '../ui/HUD.js';
import { TouchControls } from '../ui/TouchControls.js';
import { Shelter } from '../world/Shelter.js';
import { AssetLoader } from './AssetLoader.js';
import { Events } from './EventBus.js';
import { Loop } from './Loop.js';
import { StatsTracker } from './StatsTracker.js';
import { Time } from './Time.js';

const STATE = Object.freeze({
  LOADING: 'loading',
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  PHOTO: 'photo',
});

const TEXTURES = [
  'floor_wood',
  'floor_tile_warm',
  'floor_tile_mint',
  'floor_epoxy',
  'detail_rubber',
  'detail_fabric',
  'detail_wood',
  'detail_plaster',
  'bake_lightmap',
  'bake_ao',
];

/** Input with nothing pressed (while the emote wheel is open). */
const NEUTRAL_INPUT = Object.freeze({
  moveX: 0,
  moveY: 0,
  sprint: false,
  jumpHeld: false,
  jumpPressed: false,
  jumpReleased: false,
  barkPressed: false,
  lookX: 0,
  lookY: 0,
  zoom: 0,
});

/** Yield to the browser so long build steps never block input or paint. */
function yieldToMain() {
  const sched = /** @type {any} */ (globalThis).scheduler;
  if (sched && typeof sched.yield === 'function') return sched.yield();
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });
}

const _sunView = new Vector3();
const _headPoint = new Vector3();

/**
 * Composition root of the 3D game. Created when the player first presses
 * Play (see main.js): builds every system, wires them through the EventBus,
 * runs the boot sequence behind the loading screen and owns the game state
 * machine (playing ⇄ paused → menu → playing, playing/paused ⇄ photo).
 */
export class Engine {
  /**
   * @param {object} deps
   * @param {HTMLCanvasElement} deps.canvas
   * @param {HTMLElement} deps.uiRoot
   * @param {import('./EventBus.js').EventBus} deps.bus
   * @param {import('./SettingsStore.js').SettingsStore} deps.settings
   * @param {import('./SaveManager.js').SaveManager} deps.save
   * @param {import('./Input.js').Input} deps.input
   * @param {import('../ui/GamepadNav.js').GamepadNav} deps.nav
   * @param {import('../ui/LoadingScreen.js').LoadingScreen} deps.loadingScreen
   * @param {import('../ui/Menu.js').Menu} deps.menu
   * @param {Map<string, ArrayBuffer>|null} [deps.prefetched] Downloaded asset files.
   * @param {AudioContext|null} [deps.audioContext] Context created inside the Play gesture.
   */
  constructor(deps) {
    this.canvas = deps.canvas;
    this.uiRoot = deps.uiRoot;
    this.bus = deps.bus;
    this.settings = deps.settings;
    this.save = deps.save;
    this.input = deps.input;
    this.nav = deps.nav;
    this.loadingScreen = deps.loadingScreen;
    this.menu = deps.menu;
    this.prefetched = deps.prefetched || new Map();
    if (deps.audioContext) ThreeAudioContext.setContext(deps.audioContext);
    this.state = STATE.LOADING;
    this.time = new Time();
    this._stats = { calls: 0, triangles: 0 };
    this._bodies = { bodies: 0, awake: 0 };
    this._sunVis = 0;
    this._photoTime = 0;
    /** Unit vector pointing towards the sun. */
    this._toSun = new Vector3(...SUN_DIRECTION).negate().normalize();
  }

  /** Boot every system behind the loading screen (resolves when playable). */
  async init() {
    const bus = this.bus;
    try {
      this.renderer = new Renderer(this.canvas, bus);
    } catch (error) {
      const err = new Error('WebGL 2 context could not be created', { cause: error });
      err.code = 'NO_WEBGL2';
      throw err;
    }
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(CAMERA.fovDefault, 1, CAMERA.near, CAMERA.far);
    this.camera.position.set(-10, 2.5, 12);
    this._resize();
    this.quality = new QualityManager({ bus, renderer: this.renderer, settings: this.settings });

    const loader = new AssetLoader(this.renderer.three, bus, this.prefetched);
    this.prefetched = null;
    loader.plan(['physics', 'world', 'player', 'audio', 'post', 'shaders', 'probe']);
    const texturesPromise = Promise.all(
      TEXTURES.map((name) =>
        loader.loadKTX2(`textures/${name}.ktx2`, 'Unpacking textures').then((t) => [name, t]),
      ),
    );
    const propsPromise = loader.loadGLTF('models/props.glb', 'Unpacking furniture & toys');
    const dogPromise = loader.loadGLTF('models/robodog.glb', 'Assembling your robo-pup');

    this.physics = await loader.task('physics', 'Waking up physics', () => PhysicsWorld.create());
    const [textureEntries, propsGltf, dogGltf] = await Promise.all([
      texturesPromise,
      propsPromise,
      dogPromise,
    ]);

    this.shelter = new Shelter({
      scene: this.scene,
      physics: this.physics,
      bus,
      renderer: this.renderer.three,
    });
    await loader.task('world', 'Building the shelter', () =>
      this.shelter.build(
        { textures: Object.fromEntries(textureEntries), propScene: propsGltf.scene },
        yieldToMain,
      ),
    );
    await loader.task('player', 'Booting robo-pup', () => this._createPlayer(dogGltf.scene));
    this.shelter.installPlaceholderEnvironment();

    this.audio = new AudioManager({
      bus,
      settings: this.settings,
      camera: this.camera,
      scene: this.scene,
    });
    await loader.task('audio', 'Composing sounds', () => this.audio.prepare(yieldToMain));

    this.postfx = new PostFX(this.renderer, this.scene, this.camera);
    bus.on(Events.QUALITY_APPLIED, ({ preset }) => this._applyQuality(preset));
    await loader.task('post', 'Tuning the lights', () => this.quality.start());
    await loader.task('shaders', 'Compiling shaders', () => this._precompile());
    await loader.task('probe', 'Polishing reflections', () => this._bakeProbe());
    loader.dispose();

    this._createUI();
    this._wireEvents();

    this.loop = new Loop({
      time: this.time,
      fixedUpdate: (dt) => this._fixedUpdate(dt),
      update: (t) => this._update(t),
      render: (t) => this._render(t),
    });
    this.loop.start(this.renderer.three);
    this.state = STATE.MENU;
    document.body.classList.add('engine-ready');
    this.loadingScreen.hide();
    bus.emit(Events.LOAD_COMPLETE);
    this._exposeTestHooks();
  }

  _createPlayer(dogScene) {
    this.dog = new RobotDog(dogScene, this.shelter.materials);
    this.scene.add(this.dog.object);
    this.character = new CharacterController(this.physics, PLAYER.spawn);
    this.animator = new DogAnimator(this.dog, this.physics, this.bus, this.character.collider);
    this.controller = new DogController({
      bus: this.bus,
      character: this.character,
      animator: this.animator,
      zoneAt: (x, z) => this.shelter.zoneAt(x, z),
    });
    this.controller.respawn();
    this.emotes = new EmoteSystem({
      bus: this.bus,
      animator: this.animator,
      controller: this.controller,
    });
    this.face = new FaceController({
      bus: this.bus,
      dog: this.dog,
      animator: this.animator,
      toyAhead: (x, z, dx, dz) => this.shelter.toys.nearestAhead(x, z, dx, dz),
    });
    this.cameraRig = new ThirdPersonCamera({
      camera: this.camera,
      physics: this.physics,
      bus: this.bus,
      settings: this.settings,
      excludeCollider: this.character.collider,
    });
    this.controller.update(0, 1, 0, this.camera.position);
    this.cameraRig.update(1 / 60, this.controller.rootPos, null);
  }

  /**
   * Compile every shader program up front, in parallel where the browser
   * supports KHR_parallel_shader_compile, so the first frames never hitch.
   *
   * Programs are compiled for the render target the frame actually uses
   * (with post-processing the scene renders into a linear half-float target,
   * which needs different variants than drawing to the canvas), and every
   * post-processing pass material is compiled alongside. A warm-up frame then
   * validates everything behind the loading screen.
   */
  async _precompile() {
    const r = this.renderer.three;
    const target = this.postfx.composer ? this.postfx.composer.renderTarget1 : null;
    compileMaterials(r, collectPassMaterials(this.postfx.allPasses), this.camera);
    r.setRenderTarget(target);
    // compileAsync probes KHR_parallel_shader_compile in a way that logs a
    // warning where it is missing (Firefox); use plain compile() there.
    if (r.extensions.has('KHR_parallel_shader_compile'))
      await r.compileAsync(this.scene, this.camera);
    else r.compile(this.scene, this.camera);
    r.setRenderTarget(null);
    this.postfx.render(0);
    await waitForGpu(r.getContext());
  }

  _bakeProbe() {
    this.shelter.bakeReflectionProbe([
      this.dog.object,
      this.shelter.shafts.group,
      this.shelter.toys.group,
    ]);
  }

  _createUI() {
    const bus = this.bus;
    this.hud = new HUD({ root: this.uiRoot, bus });
    this.touch = new TouchControls({ root: this.uiRoot, input: this.input, bus });
    this.wheel = new EmoteWheel({ root: this.uiRoot, bus });
    this.stats = new StatsTracker({ bus, save: this.save });
    this.gpuTimer = new GpuTimer(this.renderer.three.getContext());
    this.overlay = new DebugOverlay({
      root: this.uiRoot,
      bus,
      settings: this.settings,
      gpu: this.quality.gpu,
    });
    this.overlay.onToggle = (visible) => this.gpuTimer.setEnabled(visible);
    this.gpuTimer.setEnabled(this.overlay.visible);
    this._overlayFrame = {
      logicMs: 0,
      physicsMs: 0,
      drawMs: 0,
      sample: () => this._sampleStats(),
    };
    this.photo = new PhotoMode({
      bus,
      uiRoot: this.uiRoot,
      camera: this.camera,
      physics: this.physics,
      postfx: this.postfx,
      renderer: this.renderer,
      dog: this.dog,
      face: this.face,
      settings: this.settings,
      focusPoint: () => this.dog.bones.head.getWorldPosition(_headPoint),
      renderFrame: () => this._render(this.time),
    });
    this.nav.addRoot(() =>
      this.state === STATE.PHOTO && !this.photo.uiHidden ? this.photo.panel.root : null,
    );
  }

  _wireEvents() {
    const bus = this.bus;
    bus.on(Events.UI_REQUEST_PLAY, () => this.startGame());
    bus.on(Events.UI_REQUEST_RESUME, () => this.resume());
    bus.on(Events.UI_REQUEST_QUIT, () => this.quitToTitle());
    bus.on(Events.UI_REQUEST_PHOTO, () => this.enterPhoto());
    bus.on(Events.INPUT_PAUSE_TOGGLE, () => {
      if (this.state === STATE.PHOTO) this.exitPhoto();
      else if (this.state === STATE.PLAYING) {
        if (this.wheel.isOpen) this.wheel.close();
        else this.pause();
      } else if (this.state === STATE.PAUSED) {
        if (!this.menu.back()) this.resume();
      } else if (this.state === STATE.MENU) this.menu.back();
    });
    bus.on(Events.INPUT_RECENTER_CAMERA, () => this.cameraRig.recenter(this.controller.yaw));
    bus.on(Events.EMOTE_WHEEL, ({ open }) => {
      if (open) this.input.cancelDrag();
    });
    bus.on(Events.SAVE_PROGRESS_RESET, () => this.stats.resetTracking());
    bus.on(Events.CONTEXT_RESTORED, () => {
      this._applyQuality(QUALITY_PRESETS[this.quality.current]);
      this._bakeProbe();
    });
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    this._onVisibility = () => {
      if (document.hidden && this.state === STATE.PLAYING) this.pause();
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  // ------------------------------------------------------------------ state

  startGame() {
    if (this.state !== STATE.MENU) return;
    this.audio.unlock();
    this._enterPlay();
    this.cameraRig.recenter(this.controller.yaw);
    this.hud.showHints(6);
    this.bus.emit(Events.GAME_START);
  }

  pause() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.PAUSED;
    this.loop.simulate = false;
    this.wheel.close();
    this.emotes.enabled = false;
    this.input.setMode('menu');
    this.input.releasePointerLock();
    this.controller.clearInput();
    this.stats.resetTracking();
    this.save.flush();
    this.menu.showPause();
    this.hud.setMode('hidden');
    this.touch.setVisible(false);
    this.bus.emit(Events.GAME_PAUSE);
  }

  resume() {
    if (this.state !== STATE.PAUSED) return;
    this.audio.unlock();
    this._enterPlay();
    this.bus.emit(Events.GAME_RESUME);
  }

  quitToTitle() {
    if (this.state !== STATE.PAUSED) return;
    this.state = STATE.MENU;
    this.emotes.cancel();
    this.emotes.reset();
    this.controller.respawn();
    this.shelter.reset();
    this.menu.showStart();
    this.bus.emit(Events.GAME_QUIT);
  }

  /** Photo mode from gameplay (P / View / touch) or the pause menu. */
  enterPhoto() {
    if (this.state !== STATE.PLAYING && this.state !== STATE.PAUSED) return;
    const fromPause = this.state === STATE.PAUSED;
    this.state = STATE.PHOTO;
    this._photoTime = this.time.elapsed;
    this.loop.simulate = false;
    this.wheel.close();
    this.emotes.enabled = false;
    this.controller.clearInput();
    this.stats.resetTracking();
    this.menu.hide();
    this.input.setMode('photo');
    this.hud.setMode('photo');
    this.touch.setMode('photo');
    this.touch.setVisible(true);
    this.dog.setOpacity(1);
    if (fromPause) this.audio.setActive(true);
    this.photo.enter();
    if (document.body.classList.contains('gamepad-nav')) this.photo.panel.focusFirst();
  }

  exitPhoto() {
    if (this.state !== STATE.PHOTO) return;
    this.photo.exit();
    this.touch.setMode('play');
    this._enterPlay();
    this.bus.emit(Events.GAME_RESUME);
  }

  _enterPlay() {
    this.state = STATE.PLAYING;
    this.menu.hide();
    this.hud.setMode('play');
    this.touch.setVisible(true);
    this.input.setMode('play');
    this.emotes.enabled = true;
    this.loop.resetAccumulator();
    this.loop.simulate = true;
    this.canvas.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ frame

  _fixedUpdate(dt) {
    this.controller.fixedUpdate(dt);
    this.physics.step();
  }

  /** @param {Time} time */
  _update(time) {
    const dt = time.delta;
    this.input.poll(dt);
    const input = this.input.state;

    if (this.state === STATE.PLAYING) {
      this.wheel.update(input);
      const control = this.wheel.isOpen ? NEUTRAL_INPUT : input;
      this.emotes.update(dt, control);
      this.controller.handleInput(control, this.cameraRig.yaw);
      if (input.photoToggle && !this.wheel.isOpen) this.enterPhoto();
    } else if (this.state === STATE.PHOTO && input.photoToggle) {
      this.exitPhoto();
    }

    if (this.state === STATE.PHOTO) this._updatePhoto(time, input);
    else this._updateWorld(time, input);

    this.audio.update(dt);
    this.hud.update(time.rawDelta);
    const f = this._overlayFrame;
    f.logicMs = this.loop.physicsMs + this.loop.updateMs;
    f.physicsMs = this.loop.physicsMs;
    f.drawMs = this.loop.renderMs;
    this.overlay.update(time.rawDelta, f);
  }

  _updateWorld(time, input) {
    const dt = time.delta;
    const playing = this.state === STATE.PLAYING;
    const c = this.controller;
    c.update(dt, playing ? time.alpha : 1, time.elapsed, this.camera.position);
    this.face.update(dt, time.elapsed, c.rootPos, c.renderYaw);
    const look = playing ? (this.wheel.isOpen ? NEUTRAL_INPUT : input) : null;
    this.cameraRig.update(dt, c.rootPos, look);
    this.dog.setOpacity(this.cameraRig.dogOpacity);
    this._updateDogLighting(dt);
    this.shelter.update({
      dt,
      time: time.elapsed,
      alpha: playing ? time.alpha : 1,
      camera: this.camera,
      focus: c.rootPos,
      pixelRatio: this.renderer.pixelRatio,
    });
    if (playing) this.stats.update(dt, c.rootPos);
    this.quality.update(time.rawDelta);
  }

  /** Frozen world: only the free camera and camera-dependent work run. */
  _updatePhoto(time, input) {
    this.photo.update(Math.min(time.rawDelta, 0.1), input);
    this._updateDogLighting(0);
    this.shelter.update({
      dt: 0,
      time: this._photoTime,
      alpha: 1,
      camera: this.camera,
      focus: this.controller.rootPos,
      pixelRatio: this.renderer.pixelRatio,
    });
  }

  /**
   * Sample the baked sun at the dog: one ray towards the sun (ignoring glass)
   * tells whether the dog stands in a window sun patch.
   */
  _updateDogLighting(dt) {
    const p = this.controller.rootPos;
    const s = this._toSun;
    if (dt > 0) {
      const flags = this.physics.RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC;
      const hit = this.physics.castRay(
        p.x,
        p.y + 0.5,
        p.z,
        s.x,
        s.y,
        s.z,
        60,
        flags,
        this.character.collider,
        QUERY_IGNORE_GLASS,
      );
      this._sunVis = MathUtils.damp(this._sunVis, hit < 0 ? 1 : 0, 5, dt);
    }
    dogLightingUniforms.uSunBoost.value = this._sunVis * RENDER.sunBoost;
    _sunView.copy(s).transformDirection(this.camera.matrixWorldInverse);
    dogLightingUniforms.uSunDirView.value.copy(_sunView);
  }

  /** @param {Time} time */
  _render(time) {
    this.renderer.resetInfo();
    this.gpuTimer.begin();
    this.postfx.render(time.delta);
    this.gpuTimer.end();
    const info = this.renderer.three.info.render;
    this._stats.calls = info.calls;
    this._stats.triangles = info.triangles;
  }

  /** Slower-changing numbers for the F3 overlay (sampled twice a second). */
  _sampleStats() {
    const r = this.renderer.three;
    const mem = r.info.memory;
    this.physics.countBodies(this._bodies);
    const gpuMs = this.gpuTimer.read();
    return {
      gpuMs,
      gpuNote: this.gpuTimer.supported ? 'measuring…' : 'n/a (no GPU timer in this browser)',
      calls: this._stats.calls,
      triangles: this._stats.triangles,
      bodies: this._bodies.bodies,
      bodiesAwake: this._bodies.awake,
      geometries: mem.geometries,
      textures: mem.textures,
      programs: r.info.programs ? r.info.programs.length : 0,
      preset: QUALITY_PRESETS[this.quality.current].label + (this.quality.auto ? ' (auto)' : ''),
      width: r.domElement.width,
      height: r.domElement.height,
      scale: this.renderer.renderScale,
    };
  }

  _applyQuality(preset) {
    this.renderer.refreshPixelRatio();
    this.postfx.configure(preset);
    this.shelter.applyQuality(preset);
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    if (this.postfx) this.postfx.setSize();
  }

  /**
   * Diagnostics and controls for the automated tests, only when the page is
   * opened with `?test` (never in normal play).
   */
  _exposeTestHooks() {
    if (!new URLSearchParams(window.location.search).has('test')) return;
    const engine = this;
    Object.defineProperty(window, '__ROBOPUP_TEST__', {
      configurable: true,
      value: Object.freeze({
        /** Full engine access for debugging scripts (test mode only). */
        engine,
        snapshot() {
          const p = engine.controller.rootPos;
          const mem = engine.renderer.three.info.memory;
          return {
            state: engine.state,
            x: p.x,
            y: p.y,
            z: p.z,
            grounded: engine.controller.grounded,
            calls: engine._stats.calls,
            triangles: engine._stats.triangles,
            preset: engine.quality.current,
            geometries: mem.geometries,
            textures: mem.textures,
            programs: engine.renderer.three.info.programs
              ? engine.renderer.three.info.programs.length
              : 0,
            camDist: engine.camera.position.distanceTo(engine.cameraRig.focus),
            camX: engine.camera.position.x,
            camY: engine.camera.position.y,
            camZ: engine.camera.position.z,
            fov: engine.camera.fov,
            exposure: engine.renderer.three.toneMappingExposure,
            emote: engine.emotes.id,
            emoteWeight: engine.animator.emoteW,
            bodyRoll: engine.dog.bones.body.rotation.z,
            bodyY: engine.dog.bones.body.position.y,
            face: engine.face.expression,
            wheelOpen: engine.wheel.isOpen,
            dogVisible: engine.dog.object.visible,
            dof: Boolean(engine.postfx.dof && engine.postfx.dof.enabled),
            grade: Boolean(engine.postfx.grade && engine.postfx.grade.enabled),
            stats: { ...engine.save.progress.stats },
            frame: engine.time.frame,
            now: performance.now(),
          };
        },
        setQuality(q) {
          engine.settings.set('quality', q);
        },
        teleport(x, z, yaw) {
          engine.character.teleport({ x, y: 0.05, z });
          engine.controller.yaw = yaw;
          engine.controller.prevYaw = yaw;
          engine.animator.resetPose(engine.controller.rootPos.set(x, 0.05, z), yaw);
        },
        inspectMaterial(name) {
          const m = engine.shelter.materials.get(name);
          const tex = (t) =>
            t
              ? {
                  w: t.image?.width,
                  h: t.image?.height,
                  format: t.format,
                  type: t.type,
                  channel: t.channel,
                  colorSpace: t.colorSpace,
                  mipmaps: t.mipmaps?.length,
                }
              : null;
          let uv1 = false;
          engine.shelter.architecture.traverse((o) => {
            if (o.isMesh && o.material === m) uv1 = uv1 || Boolean(o.geometry.attributes.uv1);
          });
          return {
            name: m.name,
            map: tex(m.map),
            lightMap: tex(m.lightMap),
            aoMap: tex(m.aoMap),
            lightMapIntensity: m.lightMapIntensity,
            uv1,
          };
        },
        orbit(yaw, pitch, distance) {
          const rig = engine.cameraRig;
          rig.targetYaw = rig.yaw = yaw;
          rig.targetPitch = rig.pitch = pitch;
          rig.targetDistance = rig.distance = distance;
        },
        /** Force an LED expression ('auto' to release). */
        face(expression) {
          engine.face.force(expression);
        },
        /** Set a photo-mode parameter as the panel would. */
        photoParam(key, value) {
          engine.photo.params[key] = value;
          engine.photo._onChange(key);
          engine.photo.panel.sync();
        },
      }),
    });
  }
}
