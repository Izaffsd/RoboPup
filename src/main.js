import './styles/main.css';
import { QUALITY_PRESETS } from './config/config.js';
import { EventBus, Events } from './core/EventBus.js';
import { Input } from './core/Input.js';
import { preloadAssets } from './core/Preloader.js';
import { SaveManager } from './core/SaveManager.js';
import { SettingsStore } from './core/SettingsStore.js';
import { detectPresetKey } from './render/QualityManager.js';
import { GamepadNav } from './ui/GamepadNav.js';
import { LoadingScreen } from './ui/LoadingScreen.js';
import { Menu } from './ui/Menu.js';

/**
 * Entry point (kept small and free of three.js / Rapier).
 *
 * 1. The branded loading screen (static HTML) paints immediately while every
 *    game asset downloads in the background — network only, with real byte
 *    progress, so the page stays responsive.
 * 2. The start menu appears over a pre-rendered view of the shelter. The
 *    save, settings and input already exist, so keyboard, mouse, touch and
 *    gamepad all work in the menus before the engine is loaded.
 * 3. Pressing Play boots the engine chunk (three.js, Rapier, game code)
 *    behind the loading screen — decoding, physics, world assembly, shader
 *    compilation and the reflection probe, tracked by a THREE.LoadingManager —
 *    and drops straight into the game.
 */

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('scene'));
const uiRoot = /** @type {HTMLElement} */ (document.getElementById('ui'));

const bus = new EventBus();
const save = new SaveManager(bus);
const settings = new SettingsStore(bus, save);
const input = new Input({ bus, canvas, settings });
const nav = new GamepadNav({ bus });
const loading = new LoadingScreen(bus);
let menu = null;
nav.addRoot(() => (menu ? menu.activePanel : null));
let prefetched = null;
let detectedLabel = '';

function showFatal(title, message) {
  loading.hideImmediately();
  if (menu) menu.hide();
  const box = document.getElementById('fatal');
  box.querySelector('h2').textContent = title;
  box.querySelector('p').textContent = message;
  box.querySelector('.fatal-reload').addEventListener('click', () => window.location.reload());
  box.hidden = false;
}

const NO_WEBGL2 = [
  'WebGL 2 is not available',
  'RoboPup needs a browser with WebGL 2 enabled (latest Chrome, Edge, Firefox or Safari). ' +
    'Try updating your browser, enabling hardware acceleration, or switching devices.',
];

/** Graphics tier the "Auto" preset will pick, detected lazily (Settings panel). */
function detectedQuality() {
  if (detectedLabel) return detectedLabel;
  try {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    const gl = probe.getContext('webgl2');
    if (gl) {
      detectedLabel = QUALITY_PRESETS[detectPresetKey(gl)].label;
      // Release the probe context right away (Firefox logs a warning for an
      // explicit loseContext(), so there the 1×1 context is left to the GC).
      if (!/firefox/i.test(navigator.userAgent))
        gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    detectedLabel = '';
  }
  return detectedLabel || 'n/a';
}

/**
 * Resolves once the page has painted its first content and the menu backdrop
 * has loaded (each with a timeout), so the bulk download never competes with
 * the first paint or the backdrop for bandwidth.
 */
function firstPaintSettled() {
  const painted = new Promise((resolve) => {
    if (performance.getEntriesByName('first-contentful-paint').length) {
      resolve();
      return;
    }
    try {
      const observer = new PerformanceObserver((list) => {
        if (list.getEntriesByName('first-contentful-paint').length) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe({ type: 'paint', buffered: true });
    } catch {
      // Paint timing unsupported: rely on the timeout below.
    }
    window.setTimeout(resolve, 1200);
  });
  const img = /** @type {HTMLImageElement|null} */ (document.getElementById('backdrop'));
  const backdrop =
    !img || img.complete
      ? Promise.resolve()
      : new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
          window.setTimeout(resolve, 2000);
        });
  return Promise.all([painted, backdrop]);
}

/**
 * Until the engine's loop runs, poll input once per frame so the gamepad can
 * navigate the start menu.
 */
let menuFrame = 0;
let menuLast = 0;
function pollMenu(now) {
  const dt = menuLast ? Math.min(0.1, (now - menuLast) / 1000) : 0;
  menuLast = now;
  input.poll(dt);
  menuFrame = requestAnimationFrame(pollMenu);
}

async function boot(audioContext) {
  cancelAnimationFrame(menuFrame);
  offBack();
  menu.hide();
  loading.show('Preparing the shelter');
  try {
    const { Engine } = await import('./core/Engine.js');
    const engine = new Engine({
      canvas,
      uiRoot,
      bus,
      settings,
      save,
      input,
      nav,
      loadingScreen: loading,
      menu,
      prefetched,
      audioContext,
    });
    prefetched = null;
    await engine.init();
    engine.startGame();
  } catch (error) {
    console.error(error);
    if (error && error.code === 'NO_WEBGL2') showFatal(...NO_WEBGL2);
    else {
      showFatal(
        'Something went wrong',
        'The shelter could not be loaded. Please reload the page to try again.',
      );
    }
  }
}

// Esc / gamepad B / Start on the title screen close a sub-panel.
const offBack = bus.on(Events.INPUT_PAUSE_TOGGLE, () => {
  if (menu) menu.back();
});

async function start() {
  if (!('WebGL2RenderingContext' in window)) {
    showFatal(...NO_WEBGL2);
    return;
  }
  menu = new Menu({ root: uiRoot, bus, settings, save, detectedQuality });
  await firstPaintSettled();
  try {
    prefetched = await preloadAssets((p) => loading.setProgress(p, 'Fetching the shelter'));
  } catch {
    loading.showError('Could not download the game files. Check your connection and reload.');
    return;
  }
  loading.hide(); 
  menu.showStart();
  menuFrame = requestAnimationFrame(pollMenu);
  const off = bus.on(Events.UI_REQUEST_PLAY, () => {
    off();
    // Created inside the click so audio may start on every browser (Safari
    // only allows it within a user gesture); the engine adopts this context.
    let audioContext = null;
    try {
      const Ctor = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
      if (Ctor) audioContext = new Ctor();
    } catch {
      audioContext = null;
    }
    boot(audioContext);
  });
}

start();
