// @ts-check
// Per-site speed presets — E2E (FR-11). Sweep follow-up P2.
//
// HEADED-only (WSL2 MV3 service-worker limitation; run via `npm run e2e`).
//
// SCOPE NOTE: the popup "remember this site" TOGGLE itself is not E2E-testable
// here — driving it needs the real action popup over the video tab, and
// chrome.action.openPopup() does not produce a popup page in a Playwright
// persistent context (see e2e/popup-preset.spec.js + the openPopup memory). Its
// write-decision logic is unit-tested (popup buildSpeedWrite, D2/D4). What IS
// faithfully testable end-to-end — and is what this spec covers — is the part the
// user actually experiences: a per-site preset in storage drives playback,
// precedence is site→global, and the options page can remove a preset.
//
// The fixture is served from 127.0.0.1, whose naive registrable domain (last two
// labels) is "0.1" — that is the perSiteSpeeds key the content script resolves
// against on these pages. Real sites key on e.g. "youtube.com"; the mechanism is
// identical.

const { test, expect, seedDefaultSpeed } = require('./extension');

const SITE_DOMAIN = '0.1'; // getRegistrableDomain('127.0.0.1')

/** Seed the whole perSiteSpeeds map from the service worker before navigation. */
async function seedPerSiteSpeeds(background, map) {
  await background.evaluate(
    (m) => new Promise((resolve) => chrome.storage.sync.set({ perSiteSpeeds: m }, resolve)),
    map,
  );
}

/** Read perSiteSpeeds back from the service worker. */
function readPerSiteSpeeds(background) {
  return background.evaluate(
    () =>
      new Promise((resolve) =>
        chrome.storage.sync.get(['perSiteSpeeds'], (r) => resolve(r.perSiteSpeeds || {})),
      ),
  );
}

test('a per-site preset for the current domain drives playback (FR-11, site wins)', async ({
  page,
  background,
  fixtureBaseURL,
}) => {
  // Global default 1.0, but this domain is "remembered" at 2.5x.
  await seedDefaultSpeed(background, 1.0);
  await seedPerSiteSpeeds(background, { [SITE_DOMAIN]: 2.5 });

  await page.goto(fixtureBaseURL + '/video.html');

  const video = page.locator('#vid');
  await expect.poll(() => video.evaluate((v) => v.playbackRate)).toBe(2.5);
});

test('site → global precedence: no preset for this domain falls back to the global default', async ({
  page,
  background,
  fixtureBaseURL,
}) => {
  // A preset exists, but for a DIFFERENT domain — this page must use the global default.
  await seedDefaultSpeed(background, 1.75);
  await seedPerSiteSpeeds(background, { 'youtube.com': 3.0 });

  await page.goto(fixtureBaseURL + '/video.html');

  const video = page.locator('#vid');
  await expect.poll(() => video.evaluate((v) => v.playbackRate)).toBe(1.75);
});

test('options page removes a per-site preset, and the site reverts to the global default', async ({
  context,
  page,
  background,
  extensionId,
  fixtureBaseURL,
}) => {
  await seedDefaultSpeed(background, 1.0);
  await seedPerSiteSpeeds(background, { [SITE_DOMAIN]: 2.5 });

  // 1) The site is at its per-site speed before removal.
  await page.goto(fixtureBaseURL + '/video.html');
  const video = page.locator('#vid');
  await expect.poll(() => video.evaluate((v) => v.playbackRate)).toBe(2.5);

  // 2) Open the options page; the preset is listed; click its Remove button.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options/options.html`);
  const row = options.locator('.per-site-row', { hasText: SITE_DOMAIN });
  await expect(row).toBeVisible();
  await row.locator('.per-site-remove').click();

  // 3) Storage no longer has the entry.
  await expect
    .poll(() => readPerSiteSpeeds(background).then((m) => SITE_DOMAIN in m))
    .toBe(false);

  // 4) A freshly loaded video page now applies the global default.
  const page2 = await context.newPage();
  await page2.goto(fixtureBaseURL + '/video.html');
  const video2 = page2.locator('#vid');
  await expect.poll(() => video2.evaluate((v) => v.playbackRate)).toBe(1.0);
});
