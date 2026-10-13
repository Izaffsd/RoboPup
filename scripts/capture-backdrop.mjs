/**
 * Renders the start-menu backdrop (src/assets/menu-backdrop.jpg) from the
 * real game: boots the engine, frames the sunlit nook, hides the UI and saves
 * a JPEG. Run against a dev or preview server:
 *
 *   npm run capture:backdrop -- --url=http://localhost:5173/
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(ROOT, 'src', 'assets', 'menu-backdrop.jpg');
const url = new URL(args.url || 'http://localhost:5173/');
url.searchParams.set('test', '1');

const browser = await chromium.launch({
  channel: args.channel || (process.platform === 'win32' ? 'msedge' : 'chrome'),
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
});
await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Play' }).click({ timeout: 120000 });
await page.waitForFunction(() => window.__ROBOPUP_TEST__ !== undefined, null, { timeout: 120000 });
await page.evaluate(() => {
  const t = window.__ROBOPUP_TEST__;
  const e = t.engine;
  t.setQuality('ultra');
  t.teleport(0.6, 9.4, Math.atan2(2.4, -3.3));
  e.hud.root.hidden = true;
  e.touch.setVisible(false);
  // Hand-framed shot: windows behind, dog in the right third (the menu panel
  // sits on the left).
  e.cameraRig.update = () => {
    e.camera.position.set(3.0, 1.0, 6.1);
    e.camera.lookAt(2.2, 0.95, 11.5);
    e.cameraRig.dogOpacity = 1;
  };
});
// Let the dog settle into its idle sit (happy face).
await page.waitForTimeout(14000);
await page.screenshot({ path: out, type: 'jpeg', quality: 74 });
await browser.close();
process.stdout.write(`wrote ${path.relative(ROOT, out)}\n`);
