// @ts-check
// Story 2.3 — E2E: Options Save Persists to Page Load
//
// AC: Given a speed saved on the options page, when a new page with a <video>
// loads, then the video plays at the saved speed.
//
// Flow:
//   1. Open the real options page in the extension.
//   2. Fill the speed input with a non-default value (2.0) and click Save.
//   3. Wait for the "saved" confirmation to appear (storage commit confirmed).
//   4. Open a fresh video page — content script reads storage on injection.
//   5. Assert the video's playbackRate equals the saved value.
const { test, expect } = require('./extension');

test('options page save persists speed to a freshly loaded video page', async ({
  context,
  extensionId,
  fixtureBaseURL,
}) => {
  // Step 1: open the options page.
  const optionsPage = await context.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options/options.html`);

  // Step 2: set a non-default speed and save.
  await optionsPage.fill('#speedInput', '2');
  await optionsPage.click('#saveBtn');

  // Step 3: wait for the save to commit — the status element confirms storage write.
  await expect(optionsPage.locator('#status')).toContainText('saved');

  // Step 4: open a fresh video page — content script reads chrome.storage.sync
  // once at document_idle, so the new speed must already be written before navigation.
  const videoPage = await context.newPage();
  await videoPage.goto(fixtureBaseURL + '/video.html');

  // Step 5: assert the content script applied the saved speed.
  const video = videoPage.locator('#vid');
  await expect(video).toBeAttached();
  await expect.poll(() => video.evaluate((v) => v.playbackRate)).toBe(2);
  await expect(video).toHaveClass(/vsc-speed-adjusted/);
});
