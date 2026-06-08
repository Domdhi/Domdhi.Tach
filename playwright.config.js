// @ts-check
const { defineConfig } = require('@playwright/test');

/**
 * Playwright config for Tach E2E.
 *
 * Tach has no build step (ADR-002) — it loads unpacked at chrome://extensions.
 * E2E therefore launches a *persistent context* with `--load-extension` pointing at
 * the src/ folder (see e2e/extension.js for the shared fixture that does this). There
 * is no webServer; specs serve their own local fixture pages via file:// or data:.
 *
 * MV3 content/background scripts only load in Chromium launched with a persistent
 * context, HEADED. Headed is the default here (WSLg provides DISPLAY). Do NOT set
 * HEADLESS=1 for this suite: the "new headless" mode does NOT reliably load an MV3
 * service worker — verified on Playwright 1.60, HEADLESS=1 fails every spec at
 * `context.waitForEvent('serviceworker')` (the SW never registers).
 *
 * Supersedes the legacy `.playwright/cli.config.json` (an unvalidated stub for a
 * different `channel: chrome` CLI flow that was never wired to a runner).
 */
module.exports = defineConfig({
  testDir: './e2e',
  // Extension specs share one persistent profile dir per worker; keep it serial
  // so concurrent contexts don't fight over the unpacked-extension profile.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
});
