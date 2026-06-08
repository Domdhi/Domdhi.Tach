// @ts-check
// Story 2.1 smoke spec — proves the runner is genuinely validated:
//   1. Chromium launches with Tach loaded as an unpacked extension.
//   2. The MV3 service worker is alive (extension actually loaded).
//   3. The content script injects into a real page and (a) answers a getSpeed
//      message — a codec-independent proof of injection + the message boundary —
//      and (b) applies the stored speed to a real decoding <video>.
const { test, expect, seedDefaultSpeed } = require('./extension');

test('extension service worker loads (extension id resolves)', async ({ extensionId }) => {
  expect(extensionId).toMatch(/^[a-z]{32}$/);
});

test('content script is present and applies the stored speed to a real <video>', async ({
  page,
  background,
  fixtureBaseURL,
}) => {
  // Seed a non-default speed BEFORE navigating — the content script reads storage
  // once on injection. A non-default value makes its action observable.
  await seedDefaultSpeed(background, 1.75);

  await page.goto(fixtureBaseURL + '/video.html');

  // (a) Content script present + message boundary works. This is the primary,
  // codec-independent presence proof: getSpeed round-trips through the injected
  // content listener regardless of whether the media decodes.
  const getSpeed = await background.evaluate(
    () =>
      new Promise((resolve) => {
        chrome.tabs.query({ url: 'http://*/*' }, (tabs) => {
          if (!tabs.length) return resolve({ err: 'no tab' });
          chrome.tabs.sendMessage(tabs[0].id, { action: 'getSpeed' }, (resp) =>
            resolve({ lastError: chrome.runtime.lastError?.message || null, resp }),
          );
        });
      }),
  );
  expect(getSpeed.lastError).toBeNull();
  expect(getSpeed.resp).toEqual({ speed: 1.75 });

  // (b) The content script applies the speed to a real, decoding <video> once it
  // reaches readyState > 0, and tags the element.
  const video = page.locator('#vid');
  await expect(video).toBeAttached();
  await expect.poll(() => video.evaluate((v) => v.playbackRate)).toBe(1.75);
  await expect(video).toHaveClass(/vsc-speed-adjusted/);
});
