/**
 * Input-device tests that the desktop smoke test cannot cover.
 *
 *   node scripts/device-test.mjs [--url=http://localhost:4173/] [--channel=msedge|chrome]
 *                                [--software] [--shots=<dir>]
 *
 *  mobile   Phone emulation (touch, coarse pointer, landscape). Drives the
 *           virtual joystick, drag-to-orbit area, Jump/Bark/Pause buttons,
 *           the emote wheel and photo mode (rise button, exit) with real
 *           touch events (CDP Input.dispatchTouchEvent).
 *  gamepad  Injects a standard-mapping gamepad through navigator.getGamepads
 *           and drives the left stick, A (jump), Start (pause), menu
 *           navigation (D-pad + A), the Y emote wheel and photo mode
 *           (View, RT rise, X capture, B exit).
 *
 * Holds and presses are measured in game frames and physics steps (see
 * testkit.mjs), so the test also passes on GPU-less CI machines where
 * SwiftShader renders slowly. `--software` forces SwiftShader locally.
 *
 * Fails on any console error/warning, page error or failed assertion.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import {
  chromiumArgs,
  gameClock,
  isBrowserNoise,
  parseArgs,
  SOFTWARE_RENDERER,
} from './testkit.mjs';

const args = parseArgs();
const base = new URL(args.url || 'http://localhost:4173/');
base.searchParams.set('test', '1');
const channel = args.channel || (process.platform === 'win32' ? 'msedge' : 'chrome');
const shots = typeof args.shots === 'string' ? path.resolve(args.shots) : null;
const problems = [];
const log = (m) => process.stdout.write(`${m}\n`);

const browser = await chromium.launch({
  channel,
  headless: true,
  args: chromiumArgs(Boolean(args.software)),
});

function watch(page, tag) {
  page.on('console', (msg) => {
    const type = msg.type();
    if ((type === 'error' || type === 'warning') && !isBrowserNoise(msg.text()))
      problems.push(`[${tag} console.${type}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`[${tag} pageerror] ${err.message}`));
}

async function shot(page, name) {
  if (!shots) return;
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

/** Load the page, press Play (tap or click) and return the page's game clock. */
async function bootGame(page, tap) {
  await page.goto(base.toString(), { waitUntil: 'domcontentloaded' });
  const play = page.getByRole('button', { name: 'Play' });
  await play.waitFor({ state: 'visible', timeout: 120000 });
  await shot(page, `${tap ? 'mobile' : 'gamepad'}-01-menu`);
  if (tap) await play.tap();
  else await play.click();
  await page.waitForFunction(() => window.__ROBOPUP_TEST__ !== undefined, null, {
    timeout: 180000,
  });
  const gpu = await page.evaluate(() => window.__ROBOPUP_TEST__.snapshot().gpu);
  const software = SOFTWARE_RENDERER.test(gpu);
  const clock = gameClock(page, software ? 300000 : 30000);
  await clock.afterFrames(3);
  return { ...clock, software };
}

// ------------------------------------------------------------------ mobile
{
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  watch(page, 'mobile');
  const { snap, until, afterSteps, afterFrames, software } = await bootGame(page, true);
  await shot(page, 'mobile-02-play');
  const s0 = await snap();
  log(`mobile: preset=${s0.preset} state=${s0.state}${software ? ' (software renderer)' : ''}`);
  if (s0.preset !== 'low')
    problems.push(`[mobile] expected Low preset on a phone, got ${s0.preset}`);
  if (!(await page.locator('.touch-layer').isVisible()))
    problems.push('[mobile] touch controls not visible');

  const cdp = await context.newCDPSession(page);
  const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const centre = async (selector) => {
    const box = await page.locator(selector).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  /** A quick tap that lasts at least one rendered frame. */
  const tapAt = async (selector, id) => {
    const c = await centre(selector);
    await touch('touchStart', [{ ...c, id }]);
    await afterFrames(1);
    await touch('touchEnd', []);
  };

  // Joystick on the left half: push up (forward) for ~1.6 s of play.
  await touch('touchStart', [{ x: 140, y: 280, id: 1 }]);
  for (let i = 1; i <= 15; i++) {
    await touch('touchMove', [{ x: 140, y: 280 - i * 4, id: 1 }]);
  }
  await afterSteps(96);
  await shot(page, 'mobile-03-joystick');
  await touch('touchEnd', []);
  const s1 = await afterSteps(18);
  const moved = Math.hypot(s1.x - s0.x, s1.z - s0.z);
  log(`mobile: joystick moved the dog ${moved.toFixed(2)} m`);
  if (moved < 0.5) problems.push(`[mobile] joystick did not move the dog (${moved.toFixed(2)} m)`);

  // Drag-to-orbit on the right half.
  const yaw = () => page.evaluate(() => window.__ROBOPUP_TEST__.engine.cameraRig.targetYaw);
  const yaw0 = await yaw();
  await touch('touchStart', [{ x: 600, y: 180, id: 2 }]);
  for (let i = 1; i <= 15; i++) await touch('touchMove', [{ x: 600 + i * 8, y: 180, id: 2 }]);
  await afterFrames(2);
  await touch('touchEnd', []);
  const yaw1 = await yaw();
  log(`mobile: drag orbit changed yaw by ${(yaw1 - yaw0).toFixed(2)} rad`);
  if (Math.abs(yaw1 - yaw0) < 0.2) problems.push('[mobile] drag-to-orbit had no effect');

  // Jump button (real touch on the button), held for 0.5 s of play.
  let maxY = 0;
  await touch('touchStart', [{ ...(await centre('.touch-jump')), id: 3 }]);
  const j0 = (await snap()).steps;
  await until((s) => {
    maxY = Math.max(maxY, s.y);
    return s.steps - j0 >= 30;
  });
  await touch('touchEnd', []);
  await until((s) => {
    maxY = Math.max(maxY, s.y);
    return s.steps - j0 >= 70 && s.grounded;
  });
  log(`mobile: jump apex ${maxY.toFixed(2)} m`);
  if (maxY < 0.3) problems.push(`[mobile] jump button did not jump (apex ${maxY.toFixed(2)})`);

  await tapAt('.touch-bark', 9);
  await afterFrames(2);

  // Emote button opens the wheel; tapping a slot performs it.
  await tapAt('.touch-emote', 4);
  const wheelOpen = (await until((s) => s.wheelOpen)).wheelOpen;
  await shot(page, 'mobile-05-wheel');
  await tapAt('.wheel-slot[data-emote="playBow"]', 5);
  const em = await until((s) => s.emote === 'playBow');
  log(`mobile: emote wheel open=${wheelOpen} → ${em.emote}`);
  if (!wheelOpen || em.emote !== 'playBow')
    problems.push(`[mobile] emote wheel failed (${em.emote})`);

  // Photo button → photo mode; ▲ (rise) lifts the camera; ✕ exits.
  await tapAt('.touch-photo', 6);
  const p0 = await until((s) => s.state === 'photo');
  if (p0.state !== 'photo')
    problems.push(`[mobile] photo button did not enter photo mode (${p0.state})`);
  await touch('touchStart', [{ ...(await centre('.touch-jump')), id: 7 }]);
  const p1 = await until((s) => s.camY - p0.camY >= 0.5);
  await touch('touchEnd', []);
  await shot(page, 'mobile-06-photo');
  log(`mobile: photo camera rose ${(p1.camY - p0.camY).toFixed(2)} m`);
  if (p1.camY - p0.camY < 0.3) problems.push('[mobile] rise button did not lift the photo camera');
  await tapAt('.photo-close', 8);
  if ((await until((s) => s.state === 'playing')).state !== 'playing')
    problems.push('[mobile] ✕ did not exit photo mode');

  await tapAt('.touch-pause', 10);
  const s2 = await until((s) => s.state === 'paused');
  if (s2.state !== 'paused') problems.push(`[mobile] pause button did not pause (${s2.state})`);
  await shot(page, 'mobile-04-pause');
  await context.close();
}

// ------------------------------------------------------------------ gamepad
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => {
    const buttons = Array.from({ length: 17 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    }));
    const pad = {
      id: 'Test Gamepad (STANDARD GAMEPAD)',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons,
    };
    window.__testPad = pad;
    navigator.getGamepads = () => [pad, null, null, null];
  });
  const page = await context.newPage();
  watch(page, 'gamepad');
  const { snap, until, afterSteps, afterFrames, software } = await bootGame(page, false);
  if (software) await page.setViewportSize({ width: 640, height: 360 });
  await page.evaluate(() => {
    const e = new Event('gamepadconnected');
    Object.defineProperty(e, 'gamepad', { value: window.__testPad });
    window.dispatchEvent(e);
  });
  await afterFrames(2);

  const setAxis = (i, v) =>
    page.evaluate(
      ([index, value]) => {
        window.__testPad.axes[index] = value;
      },
      [i, v],
    );
  /** Button or trigger value (0..1). */
  const setButton = (i, value) =>
    page.evaluate(
      ([index, v]) => {
        const b = window.__testPad.buttons[index];
        b.value = v;
        b.pressed = v > 0.5;
      },
      [i, value],
    );
  /** Press and release, each held for at least one polled frame. */
  const press = async (i) => {
    await setButton(i, 1);
    await afterFrames(2);
    await setButton(i, 0);
    await afterFrames(2);
  };
  /**
   * A press the game sees in exactly one frame (for menu navigation, which
   * auto-repeats while held). The release happens inside the page in a
   * requestAnimationFrame callback queued after the game's own frame
   * callback, so the next game frame reads it as released however slowly
   * frames render and however late the test's next command arrives.
   */
  const tap = async (i) => {
    await page.evaluate(
      (index) =>
        new Promise((resolve) => {
          const b = window.__testPad.buttons[index];
          b.pressed = true;
          b.value = 1;
          requestAnimationFrame(() => {
            b.pressed = false;
            b.value = 0;
            resolve();
          });
        }),
      i,
    );
    await afterFrames(1);
  };

  const g0 = await snap();
  await setAxis(1, -1);
  await afterSteps(90);
  await setAxis(1, 0);
  const g1 = await afterSteps(18);
  const moved = Math.hypot(g1.x - g0.x, g1.z - g0.z);
  log(`gamepad: left stick moved the dog ${moved.toFixed(2)} m`);
  if (moved < 0.5) problems.push(`[gamepad] stick did not move the dog (${moved.toFixed(2)} m)`);

  await setButton(0, 1);
  let maxY = 0;
  const j0 = (await snap()).steps;
  await until((s) => {
    maxY = Math.max(maxY, s.y);
    return s.steps - j0 >= 30;
  });
  await setButton(0, 0);
  await until((s) => {
    maxY = Math.max(maxY, s.y);
    return s.steps - j0 >= 70 && s.grounded;
  });
  log(`gamepad: A jump apex ${maxY.toFixed(2)} m`);
  if (maxY < 0.3) problems.push(`[gamepad] A did not jump (apex ${maxY.toFixed(2)})`);

  await press(9);
  if ((await until((s) => s.state === 'paused')).state !== 'paused')
    problems.push('[gamepad] Start did not pause');
  // Menu navigation: steer focus to "Photo mode" with the D-pad (direction
  // chosen from the on-screen positions, because the pause menu becomes a
  // two-column grid on short screens), then A opens it. Every press must
  // move the focus.
  const DPAD = { up: 12, down: 13, left: 14, right: 15 };
  const focusedText = () => page.evaluate(() => document.activeElement?.textContent);
  const directionTo = (label) =>
    page.evaluate((text) => {
      const target = [...document.querySelectorAll('button')].find(
        (b) => b.textContent === text && b.offsetParent !== null,
      );
      const a = document.activeElement.getBoundingClientRect();
      const t = target.getBoundingClientRect();
      const dx = t.left + t.width / 2 - (a.left + a.width / 2);
      const dy = t.top + t.height / 2 - (a.top + a.height / 2);
      if (Math.abs(dy) > a.height / 2) return dy > 0 ? 'down' : 'up';
      return dx > 0 ? 'right' : 'left';
    }, label);
  let focused = await focusedText();
  const visited = [focused];
  for (let i = 0; i < 6 && focused !== 'Photo mode'; i++) {
    await tap(DPAD[await directionTo('Photo mode')]);
    const next = await focusedText();
    if (next === focused) break;
    focused = next;
    visited.push(focused);
  }
  await press(0);
  const viaMenu = await until((s) => s.state === 'photo');
  log(`gamepad: D-pad visited ${visited.join(' → ')}, A → ${viaMenu.state}`);
  if (focused !== 'Photo mode' || visited.length < 2 || viaMenu.state !== 'photo')
    problems.push(`[gamepad] menu navigation failed (focus "${focused}", state ${viaMenu.state})`);
  if (software) await page.evaluate(() => window.__ROBOPUP_TEST__.photoParam('dof', false));

  // Photo mode: RT rises, X captures, B exits.
  await setButton(7, 1);
  const risen = await until((s) => s.camY - viaMenu.camY >= 0.5);
  await setButton(7, 0);
  if (risen.camY - viaMenu.camY < 0.3) problems.push('[gamepad] RT did not lift the photo camera');
  const download = page.waitForEvent('download', { timeout: software ? 300000 : 30000 });
  await press(2);
  try {
    const dl = await download;
    log(`gamepad: X saved ${dl.suggestedFilename()}`);
  } catch {
    problems.push('[gamepad] X did not capture a photo');
  }
  await press(1);
  if ((await until((s) => s.state === 'playing')).state !== 'playing')
    problems.push('[gamepad] B did not exit photo mode');

  // Emote wheel: hold Y, point the right stick, release.
  await setButton(3, 1);
  await until((s) => s.wheelOpen);
  await setAxis(2, 0.95);
  await setAxis(3, -0.3);
  await afterFrames(2);
  const sel = await page.locator('.wheel-slot.is-selected').getAttribute('data-emote');
  await setButton(3, 0);
  await setAxis(2, 0);
  await setAxis(3, 0);
  const ge = await until((s) => s.emote !== '');
  log(`gamepad: wheel selected ${sel} → ${ge.emote}`);
  if (!sel || ge.emote !== sel) problems.push(`[gamepad] Y wheel failed (${sel} → ${ge.emote})`);
  await context.close();
}

await browser.close();
if (problems.length) {
  log(`\n✗ ${problems.length} problem(s):`);
  for (const p of problems) log(`  ${p}`);
  process.exit(1);
}
log('\n✓ device tests passed (touch + gamepad, no console errors or warnings)');
