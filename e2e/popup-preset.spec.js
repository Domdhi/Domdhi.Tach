// @ts-check
// Story 2.2 — E2E: Popup Preset Applies Speed to Active Tab
//
// HEADLESS NOTE: This spec is validated HEADED only (`npm run e2e`).
// Headless mode is blocked by the MV3 service-worker-headless limitation:
// the Chromium extension service worker does not start in headless Chromium
// in this environment (WSL2), and chrome.action.openPopup() additionally
// requires a focused window. Running with HEADLESS=1 will fail at the
// service-worker wait step before any popup interaction is attempted.
//
// APPROACH:
// The spec tries the faithful path first: keep the video page as the active
// tab and open the real action popup via chrome.action.openPopup(). This
// ensures chrome.tabs.query({active,currentWindow}) in popup.js finds the
// video tab, so the setSpeed message reaches the content script.
//
// If chrome.action.openPopup() is unavailable or does not produce a popup
// page (not all Chromium builds expose it at the extension API level), the
// spec falls back to: open popup.html directly as a tab, click a preset,
// assert chrome.storage.sync.defaultPlaybackSpeed was written, then open a
// fresh video tab and assert its <video>.playbackRate equals the preset —
// proving the full pipeline (popup writes storage → content script reads on
// injection → applies speed) works on real extension behavior. The fallback
// clearly cannot exercise the "active tab receives the message from the
// already-open popup" path due to the active-tab identity trap documented in
// the story brief.

const { test, expect, seedDefaultSpeed } = require('./extension');

// The preset we click — far enough from the default (1.0) to make the assertion
// unambiguous. Since Story 6.2 the preset buttons are built dynamically by
// buildPresetButtons, which sets `dataset.speed = value` (a Number), so the DOM
// attribute is the JS-coerced string "2" — NOT "2.0". (The old hardcoded markup
// used data-speed="2.0"; this selector was stale after the dynamic switch.)
const PRESET_SPEED = 2.0;
const PRESET_SELECTOR = `.preset-btn[data-speed="2"]`;

test('popup preset click applies speed to active video tab', async ({
  context,
  page,
  background,
  extensionId,
  fixtureBaseURL,
}) => {
  // Step 1 — Seed a non-preset default so the content script does NOT apply
  // the target speed on its own. This makes the popup interaction causal.
  await seedDefaultSpeed(background, 1.0);

  // Step 2 — Navigate the (only) page to the video fixture and bring it to
  // front so it is the active tab of the focused window when the popup opens.
  await page.goto(fixtureBaseURL + '/video.html');
  await page.bringToFront();

  // Confirm the content script applied the seeded speed before we start.
  const video = page.locator('#vid');
  await expect.poll(() => video.evaluate((v) => v.playbackRate)).toBe(1.0);

  // Step 3 — Try the faithful path: open the real action popup so that
  // chrome.tabs.query({active,currentWindow}) in popup.js resolves to the
  // video tab (not a popup tab).
  let usedFaithfulPath = false;
  let popup = null;

  try {
    const popupPromise = context.waitForEvent('page', { timeout: 4000 });
    await background.evaluate(() => chrome.action.openPopup());
    popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    usedFaithfulPath = true;
  } catch (_err) {
    // chrome.action.openPopup() not available or produced no page in time.
    // Fall through to the fallback path below.
  }

  if (usedFaithfulPath && popup) {
    // --- FAITHFUL PATH ---
    // The popup opened as a real browser action popup. The video page is still
    // the active tab. Click the preset; popup.js will find the video tab via
    // chrome.tabs.query({active,currentWindow}) and send setSpeed to it.
    await popup.locator(PRESET_SELECTOR).click();

    // Assert the video page received and applied the speed.
    await expect
      .poll(() => video.evaluate((v) => v.playbackRate), { timeout: 10000 })
      .toBe(PRESET_SPEED);
  } else {
    // --- FALLBACK PATH ---
    // chrome.action.openPopup() is not usable in this build/environment.
    // Drive the popup UI by opening popup.html as an ordinary tab. This tab
    // becomes the active tab, so popup.js's chrome.tabs.query returns IT —
    // not the video tab — and the setSpeed message will miss the video.
    // Therefore this path cannot exercise the "message reaches active video
    // tab" portion of the AC.
    //
    // What we CAN assert faithfully:
    //   (a) Clicking a preset writes chrome.storage.sync.defaultPlaybackSpeed.
    //   (b) A freshly-loaded video tab (content script reads storage on
    //       injection) applies that stored speed to its <video>.
    // This proves the full pipeline works on real extension behavior; only the
    // "already-open popup messages an already-open video tab" leg cannot be
    // verified without openPopup().

    const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
    const popupPage = await context.newPage();
    await popupPage.goto(popupUrl);
    await popupPage.waitForLoadState('domcontentloaded');

    // Let popup.js finish its loadSavedSpeed() init (it sends a setSpeed on
    // load, which we want to settle before we click the preset).
    await popupPage.locator(PRESET_SELECTOR).waitFor({ state: 'visible' });
    await popupPage.locator(PRESET_SELECTOR).click();

    // (a) Assert storage was written with the preset value. The popup applies
    // the speed instantly but DEBOUNCES the storage write (~200ms, to respect
    // the chrome.storage.sync write quota), so poll rather than read once.
    await expect
      .poll(
        () =>
          background.evaluate(
            () =>
              new Promise((resolve) =>
                chrome.storage.sync.get(['defaultPlaybackSpeed'], (r) =>
                  resolve(r.defaultPlaybackSpeed),
                ),
              ),
          ),
        { timeout: 5000 },
      )
      .toBe(PRESET_SPEED);

    // (b) Open a FRESH video tab — content script reads storage on injection.
    // Do NOT reuse `page` (already loaded; content script already injected).
    const videoPage2 = await context.newPage();
    await videoPage2.goto(fixtureBaseURL + '/video.html');
    const video2 = videoPage2.locator('#vid');
    await expect
      .poll(() => video2.evaluate((v) => v.playbackRate), { timeout: 10000 })
      .toBe(PRESET_SPEED);
  }
});
