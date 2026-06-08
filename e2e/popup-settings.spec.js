// @ts-check
// E2E for the popup settings view: a gear button in the popup header swaps the
// popup to an embedded view of the standalone options page (rendered in a
// same-origin iframe), with a back button to return to the speed controls.
//
// This proves the ONE-settings-implementation design: the popup gear view and
// the full-tab options page are the same options.html/options.js, so there is no
// duplicated settings UI to drift.
//
// HEADED ONLY (`npm run e2e`) — see e2e/epic07-visual.spec.js for the MV3
// service-worker-in-WSL rationale.

const { test, expect } = require('./extension');

test.describe('Popup settings view (gear → embedded options iframe)', () => {
  test('gear opens the embedded options page, back returns to controls', async ({
    context,
    extensionId,
  }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');

    const mainView = popup.locator('#mainView');
    const settingsView = popup.locator('#settingsView');
    const gear = popup.locator('#openSettingsBtn');
    const back = popup.locator('#closeSettingsBtn');

    // Initial state: speed controls visible, settings hidden, gear shown.
    await expect(mainView).toBeVisible();
    await expect(settingsView).toBeHidden();
    await expect(gear).toBeVisible();
    await expect(back).toBeHidden();

    // Open settings — views swap, header switches to the back button.
    await gear.click();
    await expect(settingsView).toBeVisible();
    await expect(mainView).toBeHidden();
    await expect(back).toBeVisible();
    await expect(gear).toBeHidden();
    await expect(popup.locator('body')).toHaveClass(/settings-open/);
    await expect(popup.locator('#popupTitle')).toHaveText('Settings');

    // The iframe loads the REAL options page in compact/embedded mode.
    const frame = popup.frameLocator('#settingsFrame');
    await expect(frame.locator('#speedInput')).toBeVisible();
    await expect(frame.locator('#themeSelect')).toBeVisible();
    await expect(frame.locator('html')).toHaveClass(/embedded/);
    // The full-tab page header is suppressed when embedded (popup supplies its own).
    await expect(frame.locator('.page-header')).toBeHidden();

    // Back returns to the controls and restores the original popup width.
    await back.click();
    await expect(mainView).toBeVisible();
    await expect(settingsView).toBeHidden();
    await expect(gear).toBeVisible();
    await expect(back).toBeHidden();
    await expect(popup.locator('body')).not.toHaveClass(/settings-open/);
    await expect(popup.locator('#popupTitle')).toHaveText('Playback Speed');
  });
});
