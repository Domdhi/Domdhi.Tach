// @ts-check
// Story 3.4 — E2E: Global Shortcut Changes Speed Without Popup (FR-10)
//
// HEADLESS NOTE: validated HEADED only (`npm run e2e`). Same MV3
// service-worker-headless limitation as the other specs (WSL2): the extension
// service worker does not start in headless Chromium in this environment, so the
// extension-id wait times out before any assertion runs.
//
// COMMAND-DISPATCH NOTE (the one untestable seam): chrome.commands global
// keyboard shortcuts cannot be triggered programmatically from Playwright. There
// is no API to synthesize the OS-level hotkey that fires chrome.commands
// .onCommand, and the binding is owned by the browser, not the page. So the
// "OS keystroke → onCommand" leg is inherently un-automatable.
//
// What this spec DOES verify end-to-end (the meaningful integration, popup
// CLOSED): the REAL service-worker command handler — background.js's
// `handleCommand`, the exact function registered via
// `chrome.commands.onCommand.addListener(handleCommand)` — maps the command and
// routes it to the active tab, and the content script steps <video>.playbackRate
// and persists it. `handleCommand` is a top-level function declaration in the
// classic (non-module) service-worker script, so it is reachable on the SW
// global scope. Only the keystroke→onCommand binding is excluded; everything the
// command actually triggers is exercised against real extension behavior.
//
// PERSISTENCE BRANCH NOTE: persistHotkeySpeed routes per-site vs. global by
// whether perSiteSpeeds has an entry for the page's registrable domain (Story
// 3.8). The fixture is served from 127.0.0.1 (registrable domain "0.1"). These
// tests pin the GLOBAL-default branch by explicitly clearing perSiteSpeeds, so
// the persistence assertion reads defaultPlaybackSpeed unambiguously and cannot
// silently start checking the wrong key.

const { test, expect, seedDefaultSpeed } = require('./extension');

// Hotkeys step on the 0.05 grid (= SPEED_SLIDER_STEP), same as the slider and
// the popup +/- buttons. 1.0 + 0.05 lands cleanly on 1.05.
const STEP = 0.05;
const POLL_TIMEOUT = 10000;

/**
 * Clear perSiteSpeeds so the page's domain has no per-site preset — pins the
 * global-default persistence branch in persistHotkeySpeed.
 * @param {import('@playwright/test').Worker} background
 */
async function clearPerSiteSpeeds(background) {
  await background.evaluate(
    () => new Promise((resolve) => chrome.storage.sync.set({ perSiteSpeeds: {} }, resolve)),
  );
}

/**
 * Read back the persisted global default from the service worker.
 * @param {import('@playwright/test').Worker} background
 * @returns {Promise<number|undefined>}
 */
function readStoredDefault(background) {
  return background.evaluate(
    () =>
      new Promise((resolve) =>
        chrome.storage.sync.get(['defaultPlaybackSpeed'], (r) =>
          resolve(r.defaultPlaybackSpeed),
        ),
      ),
  );
}

test('increase-speed command steps the active video speed up and persists (popup closed)', async ({
  page,
  background,
  fixtureBaseURL,
}) => {
  // Seed a known starting speed (content script applies it on injection) and
  // pin the global-default persistence branch (no per-site preset for the domain).
  await seedDefaultSpeed(background, 1.0);
  await clearPerSiteSpeeds(background);

  await page.goto(fixtureBaseURL + '/video.html');
  await page.bringToFront();

  const video = page.locator('#vid');
  await expect.poll(() => video.evaluate((v) => v.playbackRate)).toBe(1.0);

  // Fire the REAL SW command handler. No popup, no page UI — this is exactly
  // what the registered onCommand listener invokes when the hotkey fires.
  await background.evaluate(() => {
    // @ts-ignore — handleCommand is a global in the classic SW script.
    if (typeof handleCommand !== 'function') {
      throw new Error('handleCommand is not reachable on the service-worker global scope');
    }
    // @ts-ignore
    handleCommand('increase-speed');
  });

  // AC: <video>.playbackRate increases by one step (+0.25).
  await expect
    .poll(() => video.evaluate((v) => v.playbackRate), { timeout: POLL_TIMEOUT })
    .toBe(1.0 + STEP);

  // AC: the change persists. perSiteSpeeds was cleared → global default branch.
  expect(await readStoredDefault(background)).toBe(1.0 + STEP);
});

test('reset-speed command resets the active video to 1.0x and persists (popup closed)', async ({
  page,
  background,
  fixtureBaseURL,
}) => {
  // Seed a non-default speed so the reset is observable; pin the global branch.
  await seedDefaultSpeed(background, 2.0);
  await clearPerSiteSpeeds(background);

  await page.goto(fixtureBaseURL + '/video.html');
  await page.bringToFront();

  const video = page.locator('#vid');
  await expect.poll(() => video.evaluate((v) => v.playbackRate)).toBe(2.0);

  await background.evaluate(() => {
    // @ts-ignore — handleCommand is a global in the classic SW script.
    if (typeof handleCommand !== 'function') {
      throw new Error('handleCommand is not reachable on the service-worker global scope');
    }
    // @ts-ignore
    handleCommand('reset-speed');
  });

  await expect
    .poll(() => video.evaluate((v) => v.playbackRate), { timeout: POLL_TIMEOUT })
    .toBe(1.0);

  expect(await readStoredDefault(background)).toBe(1.0);
});
