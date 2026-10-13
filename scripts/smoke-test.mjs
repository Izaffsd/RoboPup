/**
 * Automated browser smoke test (quality gate).
 *
 *   npm run test:smoke -- [--url=http://localhost:4173/] [--channel=chrome|msedge]
 *                         [--browser=chromium|firefox|webkit] [--headed]
 *                         [--shots=<dir>] [--soak=<seconds>] [--tour]
 *
 * Opens the game with `?test`, then:
 *  - fails on any console error / warning or uncaught exception;
 *  - checks the save migration (legacy settings key → versioned save);
 *  - waits for the real loading sequence to finish;
 *  - clicks Play and drives keyboard + mouse input (move, sprint, jump, bark,
 *    orbit, zoom) and checks the dog moved and is grounded afterwards;
 *  - F3 overlay, emotes (number keys and the Q wheel, movement cancels,
 *    zoomies run, roll-over rolls), photo mode (fly, FOV, filter, PNG
 *    capture, exit restores the camera), stats persisting across a reload
 *    and Settings › Reset progress;
 *  - cycles every graphics preset and checks GPU geometry/texture counts
 *    return to their baseline (no leaks on preset change);
 *  - optional soak test: plays for N seconds and checks memory is stable.
 * Chromium runs on an installed Chrome/Edge (no download). Firefox (Gecko) and
 * WebKit need `npx playwright-core install firefox webkit` first.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const url = new URL(args.url || 'http://localhost:4173/');
url.searchParams.set('test', '1');
const channel = args.channel || (process.platform === 'win32' ? 'msedge' : 'chrome');
const shots = typeof args.shots === 'string' ? path.resolve(args.shots) : null;
const soak = Number(args.soak || 0);

const problems = [];
const log = (m) => process.stdout.write(`${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const engine = String(args.browser || 'chromium');
const browser =
  engine === 'firefox'
    ? await firefox.launch({ headless: !args.headed })
    : engine === 'webkit'
      ? await webkit.launch({ headless: !args.headed })
      : await chromium.launch({
          channel,
          headless: !args.headed,
          args: [
            '--ignore-gpu-blocklist',
            // Allows WebGL via SwiftShader on GPU-less CI runners.
            '--enable-unsafe-swiftshader',
            '--enable-gpu',
            '--use-angle=default',
            '--autoplay-policy=user-gesture-required',
          ],
        });
log(`browser: ${engine}${engine === 'chromium' ? ` (${channel})` : ''} ${browser.version()}`);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (msg) => {
  const type = msg.type();
  if (type === 'error' || type === 'warning') problems.push(`[console.${type}] ${msg.text()}`);
});
page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`));
page.on('requestfailed', (req) =>
  problems.push(`[requestfailed] ${req.url()} ${req.failure()?.errorText}`),
);

async function shot(name) {
  if (!shots) return;
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}
const snap = () => page.evaluate(() => window.__ROBOPUP_TEST__.snapshot());

// Save migration: a pre-SaveManager settings key is upgraded into the
// versioned save document (and removed), keeping the player's values.
{
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.clear();
      localStorage.setItem('robopup.settings.v1', JSON.stringify({ fov: 80, masterVolume: 0.3 }));
    }
  });
  const mp = await ctx.newPage();
  mp.on('pageerror', (err) => problems.push(`[migration pageerror] ${err.message}`));
  await mp.goto(url.toString(), { waitUntil: 'load' });
  const saved = await mp.evaluate(() => ({
    save: JSON.parse(localStorage.getItem('robopup.save') || 'null'),
    legacy: localStorage.getItem('robopup.settings.v1'),
  }));
  const ok =
    saved.save &&
    saved.save.version === 1 &&
    saved.save.settings.fov === 80 &&
    saved.save.settings.masterVolume === 0.3 &&
    saved.save.progress &&
    saved.legacy === null;
  log(`save migration: ${ok ? 'ok' : 'FAILED'} (${JSON.stringify(saved.save?.settings ?? null)})`);
  if (!ok) problems.push(`[save] legacy settings were not migrated: ${JSON.stringify(saved)}`);
  await ctx.close();
}

const t0 = Date.now();
await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
// Phase 1: asset download behind the loading screen, then the start menu.
const play = page.getByRole('button', { name: 'Play' });
await play.waitFor({ state: 'visible', timeout: 120000 });
log(`menu ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await sleep(700);
await shot('01-menu');

// Phase 2: Play boots the engine behind the loading screen and starts the game.
const t1 = Date.now();
await play.click();
await page.waitForFunction(() => window.__ROBOPUP_TEST__ !== undefined, null, { timeout: 120000 });
log(`engine booted in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
await sleep(1200);
await shot('02-play-start');
const start = await snap();
if (start.state !== 'playing')
  problems.push(`[ui] expected playing after boot, got ${start.state}`);
log(`play: preset=${start.preset} calls=${start.calls} tris=${start.triangles}`);

// Move forward, sprint, jump, bark.
await page.keyboard.down('KeyW');
await sleep(1400);
await page.keyboard.down('ShiftLeft');
await sleep(1200);
await page.keyboard.press('Space');
await sleep(250);
await shot('03-jump');
await sleep(700);
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');
await page.keyboard.press('KeyE');
await sleep(300);
await shot('04-bark');
await sleep(900);

// Orbit (drag) and zoom.
const cx = 640;
const cy = 360;
await page.mouse.move(cx, cy);
await page.mouse.down({ button: 'left' });
for (let i = 0; i < 20; i++) await page.mouse.move(cx + i * 12, cy + i * 2);
await page.mouse.up({ button: 'left' });
await page.mouse.wheel(0, -400);
await sleep(800);
await shot('05-orbit');
const moved = await snap();
const dist = Math.hypot(moved.x - start.x, moved.z - start.z);
log(
  `moved ${dist.toFixed(2)} m, grounded=${moved.grounded}, y=${moved.y.toFixed(3)}, calls=${moved.calls}`,
);
// Software-rendered CI runs simulate fewer steps per real second, so keep this lenient.
if (dist < 1) problems.push(`[gameplay] dog only moved ${dist.toFixed(2)} m`);
if (!moved.grounded) problems.push('[gameplay] dog not grounded after landing');
if (moved.y < -0.05) problems.push(`[gameplay] dog below floor (y=${moved.y})`);

// Pause / resume via Esc.
await page.keyboard.press('Escape');
await sleep(400);
const paused = await snap();
if (paused.state !== 'paused') problems.push(`[ui] Esc did not pause (state=${paused.state})`);
await shot('06-pause');
await page.keyboard.press('Escape');
await sleep(400);
if ((await snap()).state !== 'playing') problems.push('[ui] Esc did not resume');

// ---------------------------------------------------------------- Phase A
const wait = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  for (;;) {
    const s = await snap();
    if (fn(s) || Date.now() > end) return s;
    await sleep(100);
  }
};
const resetSpot = () =>
  page.evaluate(() => window.__ROBOPUP_TEST__.teleport(-2, 7.5, Math.PI)).then(() => sleep(400));

// F3 performance overlay.
await page.keyboard.press('F3');
await sleep(1300);
const overlayText = await page.locator('.debug-overlay').innerText();
for (const label of ['FPS', 'CPU logic', 'GPU', 'Draw calls', 'Triangles', 'Physics']) {
  if (!overlayText.includes(label)) problems.push(`[overlay] missing "${label}"`);
}
log(`overlay: ${overlayText.split('\n').slice(0, 12).join(' ').replace(/\s+/g, ' ')}`);
await shot('09-overlay');
await page.keyboard.press('F3');
await sleep(200);
if (await page.locator('.debug-overlay').isVisible()) problems.push('[overlay] F3 did not hide it');

// Emotes: number key, movement cancels.
await resetSpot();
await page.keyboard.press('Digit1');
let e = await wait((s) => s.emote === 'sit' && s.emoteWeight > 0.6);
if (e.emote !== 'sit') problems.push(`[emote] 1 did not start Sit (${e.emote})`);
if (e.face !== 'happy') problems.push(`[emote] Sit face is ${e.face}, expected happy`);
await page.keyboard.down('KeyW');
await sleep(300);
await page.keyboard.up('KeyW');
e = await wait((s) => s.emote === '');
if (e.emote !== '') problems.push('[emote] movement did not cancel the emote');

// Emote wheel: hold Q, move the mouse, release.
await resetSpot();
await page.mouse.move(640, 360);
await page.keyboard.down('KeyQ');
await sleep(150);
for (let i = 1; i <= 8; i++) await page.mouse.move(640, 360 - i * 8);
await sleep(150);
const wheelOpen = (await snap()).wheelOpen;
const picked = await page.locator('.wheel-slot.is-selected').getAttribute('data-emote');
await shot('10-emote-wheel');
await page.keyboard.up('KeyQ');
e = await wait((s) => s.emote !== '');
log(`emote wheel: open=${wheelOpen} picked=${picked} → ${e.emote}`);
if (!wheelOpen || picked !== 'sit' || e.emote !== 'sit')
  problems.push(
    `[emote] wheel pick failed (open=${wheelOpen}, picked=${picked}, emote=${e.emote})`,
  );
await page.keyboard.press('Space');
await wait((s) => s.emote === '' && s.grounded);

// Zoomies runs in a circle; Roll Over rolls the body; Sleep shows the sleepy face.
await resetSpot();
const z0 = await snap();
await page.keyboard.press('Digit4');
await sleep(1500);
const z1 = await snap();
const zoomDist = Math.hypot(z1.x - z0.x, z1.z - z0.z);
if (z1.emote !== 'zoomies' || zoomDist < 0.5)
  problems.push(`[emote] zoomies did not run (${z1.emote}, ${zoomDist.toFixed(2)} m)`);
await wait((s) => s.emote === '', 6000);
await resetSpot();
await page.keyboard.press('Digit5');
let maxRoll = 0;
for (let i = 0; i < 25; i++) {
  maxRoll = Math.max(maxRoll, Math.abs((await snap()).bodyRoll));
  await sleep(80);
}
if (maxRoll < 2.5)
  problems.push(`[emote] roll over never rolled onto its back (max ${maxRoll.toFixed(2)})`);
await wait((s) => s.emote === '', 4000);
await page.keyboard.press('Digit7');
e = await wait((s) => s.emote === 'sleep' && s.face === 'sleepy');
await shot('11-sleep');
if (e.face !== 'sleepy') problems.push(`[emote] Sleep face is ${e.face}`);
log(
  `emotes: zoomies ran ${zoomDist.toFixed(2)} m, roll-over max roll ${maxRoll.toFixed(2)} rad, sleep face ${e.face}`,
);
await page.keyboard.press('KeyA');
await wait((s) => s.emote === '');

// Photo mode: freeze, fly, FOV, filter, capture, exit.
await resetSpot();
await page.keyboard.press('KeyP');
let ph = await wait((s) => s.state === 'photo');
if (ph.state !== 'photo') problems.push(`[photo] P did not enter photo mode (${ph.state})`);
const fov0 = ph.fov;
await page.keyboard.down('KeyS');
await page.keyboard.down('KeyE');
await sleep(600);
await page.keyboard.up('KeyS');
await page.keyboard.up('KeyE');
await page.mouse.move(400, 300);
await page.mouse.wheel(0, 400);
await sleep(300);
const ph1 = await snap();
const camMoved = Math.hypot(ph1.camX - ph.camX, ph1.camY - ph.camY, ph1.camZ - ph.camZ);
if (camMoved < 0.3) problems.push(`[photo] free camera did not move (${camMoved.toFixed(2)} m)`);
if (Math.hypot(ph1.x - ph.x, ph1.z - ph.z) > 1e-3) problems.push('[photo] simulation not frozen');
if (ph1.fov <= fov0) problems.push('[photo] wheel did not change the FOV');
await page.locator('.chip[data-filter="vintage"]').click();
await sleep(200);
if (!(await snap()).grade) problems.push('[photo] filter pass not enabled');
await shot('12-photo');
const download = page.waitForEvent('download', { timeout: 15000 });
await page.keyboard.press('KeyC');
let pngBytes = 0;
try {
  const dl = await download;
  const file = await dl.path();
  const { stat } = await import('node:fs/promises');
  pngBytes = file ? (await stat(file)).size : 0;
  log(
    `photo: camera moved ${camMoved.toFixed(2)} m, fov ${fov0} → ${ph1.fov}, saved ${dl.suggestedFilename()} (${(pngBytes / 1024).toFixed(0)} KB)`,
  );
} catch (err) {
  problems.push(`[photo] capture produced no download (${err.message})`);
}
if (pngBytes > 0 && pngBytes < 20000)
  problems.push(`[photo] PNG suspiciously small (${pngBytes} B)`);
await page.locator('.chip[data-filter="none"]').click();
await page.keyboard.press('Escape');
ph = await wait((s) => s.state === 'playing');
if (ph.state !== 'playing') problems.push(`[photo] Esc did not exit (${ph.state})`);
if (Math.abs(ph.fov - fov0) > 0.01 || ph.exposure !== 1 || ph.grade || ph.dof)
  problems.push(`[photo] exit did not restore the camera (${ph.fov}, ${ph.exposure})`);

// Stats persist across a reload; Settings › Reset progress erases them.
await page.keyboard.press('Escape');
await sleep(300);
await page.reload({ waitUntil: 'domcontentloaded' });
const stored = await page.evaluate(
  () => JSON.parse(localStorage.getItem('robopup.save')).progress.stats,
);
log(
  `stats after reload: photos=${stored.photos} emotes=${JSON.stringify(stored.emotes)} jumps=${stored.jumps}`,
);
if (stored.photos < 1 || !stored.emotes.sit) problems.push('[save] stats were not persisted');
await page.getByRole('button', { name: 'Settings' }).click({ timeout: 120000 });
const reset = page.getByRole('button', { name: 'Reset progress' });
await reset.click();
await page.getByRole('button', { name: 'Press again to erase' }).click();
await sleep(200);
const cleared = await page.evaluate(
  () => JSON.parse(localStorage.getItem('robopup.save')).progress.stats,
);
const settingsKept = await page.evaluate(
  () => JSON.parse(localStorage.getItem('robopup.save')).settings,
);
if (cleared.photos !== 0 || Object.keys(cleared.emotes).length !== 0)
  problems.push('[save] Reset progress did not erase the stats');
if (!settingsKept || typeof settingsKept.fov !== 'number')
  problems.push('[save] Reset progress lost settings');
log('reset progress: ok');
await page.getByRole('button', { name: 'Back' }).click();
await page.getByRole('button', { name: 'Play' }).click();
await page.waitForFunction(() => window.__ROBOPUP_TEST__ !== undefined, null, { timeout: 120000 });
await sleep(1200);

// Frame-rate sample per preset (uncapped by test harness; vsync-limited).
async function measureFps(ms = 2500) {
  const a = await snap();
  await sleep(ms);
  const b = await snap();
  return ((b.frame - a.frame) * 1000) / (b.now - a.now);
}
for (const q of ['low', 'medium', 'high', 'ultra']) {
  await page.evaluate((v) => window.__ROBOPUP_TEST__.setQuality(v), q);
  await sleep(1500);
  const fps = await measureFps();
  const s = await snap();
  log(
    `  fps ${q.padEnd(6)} ${fps.toFixed(1)} fps, ${s.calls} draw calls, ${(s.triangles / 1000).toFixed(0)}k tris`,
  );
}

// Preset cycling: memory must return to baseline.
const base = await snap();
for (const q of ['low', 'medium', 'high', 'ultra', 'medium', 'low', 'ultra']) {
  await page.evaluate((v) => window.__ROBOPUP_TEST__.setQuality(v), q);
  await sleep(900);
  const s = await snap();
  log(
    `  preset ${q.padEnd(6)} calls=${String(s.calls).padStart(3)} geo=${s.geometries} tex=${s.textures}`,
  );
  if (q === 'ultra') await shot(`07-${q}`);
}
await page.evaluate((v) => window.__ROBOPUP_TEST__.setQuality(v), base.preset);
await sleep(900);
const after = await snap();
log(
  `memory baseline geo=${base.geometries} tex=${base.textures} → after geo=${after.geometries} tex=${after.textures}`,
);
if (after.geometries > base.geometries + 2 || after.textures > base.textures + 2) {
  problems.push(
    `[memory] GPU resources grew after preset cycling (${base.geometries}/${base.textures} → ${after.geometries}/${after.textures})`,
  );
}
await page.evaluate(() => window.__ROBOPUP_TEST__.setQuality('auto'));

if (soak > 0) {
  log(`soak ${soak}s…`);
  await page.evaluate(() => window.__ROBOPUP_TEST__.setQuality('medium'));
  await sleep(2000);
  const fps0 = await measureFps(4000);
  const heap0 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  const s0 = await snap();
  const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
  const end = Date.now() + soak * 1000;
  let i = 0;
  let minY = Infinity;
  while (Date.now() < end) {
    const k = keys[i++ % keys.length];
    await page.keyboard.down(k);
    if (i % 2 === 0) await page.keyboard.down('ShiftLeft');
    if (i % 3 === 0) await page.keyboard.press('Space');
    if (i % 5 === 0) await page.keyboard.press('KeyE');
    await sleep(1100);
    await page.keyboard.up(k);
    await page.keyboard.up('ShiftLeft');
    minY = Math.min(minY, (await snap()).y);
  }
  await sleep(1500);
  const fps1 = await measureFps(4000);
  const heap1 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  const s1 = await snap();
  log(
    `soak: fps ${fps0.toFixed(1)} → ${fps1.toFixed(1)}, heap ${(heap0 / 1e6).toFixed(1)} → ${(heap1 / 1e6).toFixed(1)} MB, ` +
      `geo ${s0.geometries} → ${s1.geometries}, tex ${s0.textures} → ${s1.textures}, lowest y ${minY.toFixed(3)}`,
  );
  if (s1.geometries > s0.geometries + 2 || s1.textures > s0.textures + 2) {
    problems.push('[memory] GPU resources grew during soak');
  }
  if (heap0 > 0 && heap1 > heap0 * 1.5 + 20e6) problems.push('[memory] JS heap grew during soak');
  if (fps1 < fps0 * 0.85)
    problems.push(
      `[perf] frame rate degraded during soak (${fps0.toFixed(1)} → ${fps1.toFixed(1)})`,
    );
  if (minY < -0.05) problems.push(`[gameplay] dog fell below the floor during soak (y=${minY})`);
}

if (args.tour) {
  // Visual tour of every zone for screenshot review.
  const stops = [
    ['nook', 0, 9.6, 0, Math.PI, 0.18, 5.2],
    ['nook-deck', -2.5, 11.4, 0.3, Math.PI + 0.3, 0.12, 3.4],
    ['kennels', -4.2, -9.6, -Math.PI / 2, Math.PI / 2 - 0.25, 0.22, 5.5],
    ['play', 9.5, -3.2, -2.4, 0.75, 0.28, 6.5],
    ['play-deck', 14.3, -7.0, Math.PI, 0.2, 0.3, 4.5],
    ['feeding', 13.5, 7.2, 0, Math.PI + 0.35, 0.26, 5],
    ['reception', -13.5, 7.5, -Math.PI / 2 - 0.4, Math.PI / 2 - 0.5, 0.2, 5],
    ['closeup', -12.5, 8.5, 2.4, 2.4 + Math.PI - 0.6, 0.15, 1.7],
  ];
  for (const [name, x, z, yaw, camYaw, pitch, dist] of stops) {
    await page.evaluate(
      ([px, pz, py, cy, cp, cd]) => {
        window.__ROBOPUP_TEST__.teleport(px, pz, py);
        window.__ROBOPUP_TEST__.orbit(cy, cp, cd);
      },
      [x, z, yaw, camYaw, pitch, dist],
    );
    await sleep(1600);
    await shot(`tour-${name}`);
  }
}

await shot('08-final');
await browser.close();

if (problems.length) {
  log(`\n✗ ${problems.length} problem(s):`);
  for (const p of problems) log(`  ${p}`);
  process.exit(1);
}
log('\n✓ smoke test passed (no console errors or warnings)');
