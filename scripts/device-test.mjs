/**
 * Input-device tests that the desktop smoke test cannot cover.
 *
 *   node scripts/device-test.mjs [--url=http://localhost:4173/] [--channel=msedge|chrome] [--shots=<dir>]
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
 * Fails on any console error/warning, page error or failed assertion.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const base = new URL(args.url || 'http://localhost:4173/');
base.searchParams.set('test', '1');
const channel = args.channel || (process.platform === 'win32' ? 'msedge' : 'chrome');
const shots = typeof args.shots === 'string' ? path.resolve(args.shots) : null;
const problems = [];
const log = (m) => process.stdout.write(`${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  channel,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--enable-unsafe-swiftshader'],
});

function watch(page, tag) {
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning')
      problems.push(`[${tag} console.${type}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`[${tag} pageerror] ${err.message}`));
}

async function shot(page, name) {
  if (!shots) return;
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

const snap = (page) => page.evaluate(() => window.__ROBOPUP_TEST__.snapshot());

async function boot(page, tapToPlay) {
  await page.goto(base.toString(), { waitUntil: 'domcontentloaded' });
  const play = page.getByRole('button', { name: 'Play' });
  await play.waitFor({ state: 'visible', timeout: 120000 });
  return { play, tap: tapToPlay };
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
  const { play } = await boot(page);
  await shot(page, 'mobile-01-menu');
  await play.tap();
  await page.waitForFunction(() => window.__ROBOPUP_TEST__ !== undefined, null, {
    timeout: 120000,
  });
  await sleep(1000);
  await shot(page, 'mobile-02-play');
  const s0 = await snap(page);
  log(`mobile: preset=${s0.preset} state=${s0.state}`);
  if (s0.preset !== 'low')
    problems.push(`[mobile] expected Low preset on a phone, got ${s0.preset}`);
  if (!(await page.locator('.touch-layer').isVisible()))
    problems.push('[mobile] touch controls not visible');

  const cdp = await context.newCDPSession(page);
  const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  // Joystick on the left half: push up (forward) for ~1.6 s.
  await touch('touchStart', [{ x: 140, y: 280, id: 1 }]);
  for (let i = 1; i <= 40; i++) {
    await touch('touchMove', [{ x: 140, y: 280 - Math.min(60, i * 4), id: 1 }]);
    await sleep(40);
  }
  await shot(page, 'mobile-03-joystick');
  await touch('touchEnd', []);
  await sleep(300);
  const s1 = await snap(page);
  const moved = Math.hypot(s1.x - s0.x, s1.z - s0.z);
  log(`mobile: joystick moved the dog ${moved.toFixed(2)} m`);
  if (moved < 0.5) problems.push(`[mobile] joystick did not move the dog (${moved.toFixed(2)} m)`);

  // Drag-to-orbit on the right half.
  const yaw0 = await page.evaluate(() => window.__ROBOPUP_TEST__.engine.cameraRig.targetYaw);
  await touch('touchStart', [{ x: 600, y: 180, id: 2 }]);
  for (let i = 1; i <= 15; i++) {
    await touch('touchMove', [{ x: 600 + i * 8, y: 180, id: 2 }]);
    await sleep(16);
  }
  await touch('touchEnd', []);
  const yaw1 = await page.evaluate(() => window.__ROBOPUP_TEST__.engine.cameraRig.targetYaw);
  log(`mobile: drag orbit changed yaw by ${(yaw1 - yaw0).toFixed(2)} rad`);
  if (Math.abs(yaw1 - yaw0) < 0.2) problems.push('[mobile] drag-to-orbit had no effect');

  // Jump button (real touch on the button).
  const jb = await page.locator('.touch-jump').boundingBox();
  const jx = jb.x + jb.width / 2;
  const jy = jb.y + jb.height / 2;
  let maxY = 0;
  await touch('touchStart', [{ x: jx, y: jy, id: 3 }]);
  for (let i = 0; i < 30; i++) {
    await sleep(40);
    maxY = Math.max(maxY, (await snap(page)).y);
  }
  await touch('touchEnd', []);
  log(`mobile: jump apex ${maxY.toFixed(2)} m`);
  if (maxY < 0.3) problems.push(`[mobile] jump button did not jump (apex ${maxY.toFixed(2)})`);
  await sleep(900);

  await page.locator('.touch-bark').tap();
  await sleep(300);

  // Emote button opens the wheel; tapping a slot performs it.
  const tapAt = async (selector, id) => {
    const box = await page.locator(selector).boundingBox();
    await touch('touchStart', [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id }]);
    await sleep(60);
    await touch('touchEnd', []);
  };
  await tapAt('.touch-emote', 4);
  await sleep(300);
  const wheelOpen = (await snap(page)).wheelOpen;
  await shot(page, 'mobile-05-wheel');
  await tapAt('.wheel-slot[data-emote="playBow"]', 5);
  await sleep(700);
  const em = await snap(page);
  log(`mobile: emote wheel open=${wheelOpen} → ${em.emote}`);
  if (!wheelOpen || em.emote !== 'playBow')
    problems.push(`[mobile] emote wheel failed (${em.emote})`);

  // Photo button → photo mode; ▲ (rise) lifts the camera; ✕ exits.
  await tapAt('.touch-photo', 6);
  await sleep(500);
  const p0 = await snap(page);
  if (p0.state !== 'photo')
    problems.push(`[mobile] photo button did not enter photo mode (${p0.state})`);
  const rb = await page.locator('.touch-jump').boundingBox();
  await touch('touchStart', [{ x: rb.x + rb.width / 2, y: rb.y + rb.height / 2, id: 7 }]);
  await sleep(700);
  await touch('touchEnd', []);
  const p1 = await snap(page);
  await shot(page, 'mobile-06-photo');
  log(`mobile: photo camera rose ${(p1.camY - p0.camY).toFixed(2)} m`);
  if (p1.camY - p0.camY < 0.3) problems.push('[mobile] rise button did not lift the photo camera');
  await tapAt('.photo-close', 8);
  await sleep(400);
  if ((await snap(page)).state !== 'playing') problems.push('[mobile] ✕ did not exit photo mode');

  await page.locator('.touch-pause').tap();
  await sleep(400);
  const s2 = await snap(page);
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
  const { play } = await boot(page);
  await play.click();
  await page.waitForFunction(() => window.__ROBOPUP_TEST__ !== undefined, null, {
    timeout: 120000,
  });
  await page.evaluate(() => {
    const e = new Event('gamepadconnected');
    Object.defineProperty(e, 'gamepad', { value: window.__testPad });
    window.dispatchEvent(e);
  });
  await sleep(500);
  const g0 = await snap(page);
  await page.evaluate(() => {
    window.__testPad.axes[1] = -1;
  });
  await sleep(1500);
  await page.evaluate(() => {
    window.__testPad.axes[1] = 0;
  });
  await sleep(300);
  const g1 = await snap(page);
  const moved = Math.hypot(g1.x - g0.x, g1.z - g0.z);
  log(`gamepad: left stick moved the dog ${moved.toFixed(2)} m`);
  if (moved < 0.5) problems.push(`[gamepad] stick did not move the dog (${moved.toFixed(2)} m)`);

  const setButton = (i, down) =>
    page.evaluate(
      ([index, isDown]) => {
        const b = window.__testPad.buttons[index];
        b.pressed = isDown;
        b.value = isDown ? 1 : 0;
      },
      [i, down],
    );
  await setButton(0, true);
  let maxY = 0;
  for (let i = 0; i < 30; i++) {
    await sleep(40);
    maxY = Math.max(maxY, (await snap(page)).y);
  }
  await setButton(0, false);
  log(`gamepad: A jump apex ${maxY.toFixed(2)} m`);
  if (maxY < 0.3) problems.push(`[gamepad] A did not jump (apex ${maxY.toFixed(2)})`);
  await sleep(900);
  await setButton(9, true);
  await sleep(150);
  await setButton(9, false);
  await sleep(300);
  if ((await snap(page)).state !== 'paused') problems.push('[gamepad] Start did not pause');
  // Menu navigation: D-pad down from Resume focuses "Photo mode", A opens it.
  const press = async (i, hold = 120) => {
    await setButton(i, true);
    await sleep(hold);
    await setButton(i, false);
    await sleep(250);
  };
  await press(13);
  const focused = await page.evaluate(() => document.activeElement?.textContent);
  await press(0);
  const viaMenu = await snap(page);
  log(`gamepad: D-pad focused "${focused}", A → ${viaMenu.state}`);
  if (focused !== 'Photo mode' || viaMenu.state !== 'photo')
    problems.push(`[gamepad] menu navigation failed (focus "${focused}", state ${viaMenu.state})`);
  // Photo mode: RT rises, X captures, B exits.
  const setAxis = (i, v) =>
    page.evaluate(
      ([index, value]) => {
        window.__testPad.axes[index] = value;
      },
      [i, v],
    );
  const setTrigger = (i, v) =>
    page.evaluate(
      ([index, value]) => {
        const b = window.__testPad.buttons[index];
        b.value = value;
        b.pressed = value > 0.5;
      },
      [i, v],
    );
  await setTrigger(7, 1);
  await sleep(600);
  await setTrigger(7, 0);
  const risen = await snap(page);
  if (risen.camY - viaMenu.camY < 0.3) problems.push('[gamepad] RT did not lift the photo camera');
  const download = page.waitForEvent('download', { timeout: 15000 });
  await press(2);
  try {
    const dl = await download;
    log(`gamepad: X saved ${dl.suggestedFilename()}`);
  } catch {
    problems.push('[gamepad] X did not capture a photo');
  }
  await press(1);
  if ((await snap(page)).state !== 'playing') problems.push('[gamepad] B did not exit photo mode');

  // Emote wheel: hold Y, point the right stick, release.
  await setButton(3, true);
  await sleep(200);
  await setAxis(2, 0.95);
  await setAxis(3, -0.3);
  await sleep(250);
  const sel = await page.locator('.wheel-slot.is-selected').getAttribute('data-emote');
  await setButton(3, false);
  await setAxis(2, 0);
  await setAxis(3, 0);
  await sleep(500);
  const ge = await snap(page);
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
