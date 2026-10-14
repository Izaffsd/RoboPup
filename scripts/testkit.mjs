/**
 * Shared helpers for the browser test scripts (smoke-test.mjs, device-test.mjs).
 *
 * Every timing-sensitive check waits on the game's own clocks — rendered
 * frames, fixed 60 Hz physics steps, game time — never on wall-clock sleeps.
 * The same tests therefore behave identically on a GPU at 60 FPS and on a
 * GPU-less CI runner where SwiftShader renders one frame every few seconds.
 */

/** Renderer names of CPU rasterisers (no GPU). */
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|basic render/i;

/** `--key=value` / `--flag` command-line arguments. */
export function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(
    argv.map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? true];
    }),
  );
}

/**
 * Chromium flags: the real GPU where there is one, SwiftShader as the
 * fallback on GPU-less machines. `forceSoftware` (`--software`) always uses
 * SwiftShader, to reproduce CI conditions locally.
 * @param {boolean} forceSoftware
 */
export function chromiumArgs(forceSoftware) {
  return forceSoftware
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : [
        '--ignore-gpu-blocklist',
        '--enable-gpu',
        '--use-angle=default',
        '--enable-unsafe-swiftshader',
      ];
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Waiting helpers bound to one page.
 * @param {import('playwright-core').Page} page
 * @param {number} timeout Upper bound for any single wait (ms).
 */
export function gameClock(page, timeout) {
  const snap = () => page.evaluate(() => window.__ROBOPUP_TEST__.snapshot());

  /** Poll snapshots until `pred` holds (returns the last snapshot either way). */
  async function until(pred, ms = timeout) {
    const end = Date.now() + ms;
    for (;;) {
      const s = await snap();
      if (pred(s) || Date.now() > end) return s;
      await sleep(50);
    }
  }

  /** Wait for `n` fixed physics steps (60 per simulated second; only while playing). */
  async function afterSteps(n) {
    const s0 = (await snap()).steps;
    return until((s) => s.steps - s0 >= n);
  }

  /** Wait for `n` rendered frames. */
  async function afterFrames(n) {
    const f0 = (await snap()).frame;
    return until((s) => s.frame - f0 >= n);
  }

  return { snap, until, afterSteps, afterFrames };
}
