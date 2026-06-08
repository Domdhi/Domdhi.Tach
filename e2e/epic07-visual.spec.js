// @ts-check
// Epic 7 — Visual / behavioral E2E for custom presets, dark mode, accent color,
// 0.01 precision, and the icon-D rebrand. Runs against the REAL extension popup
// and options pages (chrome-extension://<id>/...), seeding chrome.storage.sync
// from the service worker so the pages render the same state a user would see.
//
// HEADED ONLY (`npm run e2e`): the MV3 service worker does not start in headless
// Chromium in this WSL2 environment (see e2e/popup-preset.spec.js note). The
// extensionId fixture waits on the service worker, so headless fails early.
//
// Screenshots land in docs/.output/screenshots/2026-06-06/epic07/ as evidence.

const path = require('path');
const { test, expect } = require('./extension');

const SHOT_DIR = path.resolve(
  __dirname,
  '..',
  'docs/.output/screenshots/2026-06-06/epic07',
);

/** Seed an arbitrary settings object into chrome.storage.sync from the SW. */
async function seed(background, settings) {
  await background.evaluate(
    (s) => new Promise((resolve) => chrome.storage.sync.set(s, resolve)),
    settings,
  );
}

/** Read the whole settings object back from chrome.storage.sync. */
async function readAll(background) {
  return background.evaluate(
    () => new Promise((resolve) => chrome.storage.sync.get(null, resolve)),
  );
}

test.describe('Epic 7 visual + behavior', () => {
  test('6.5/6.2/6.7 — popup light: 0.01 slider, 6 presets, icon-D header', async ({
    context,
    background,
    extensionId,
  }) => {
    await seed(background, {
      defaultPlaybackSpeed: 1.0,
      customPresets: [0.5, 0.75, 1.0, 1.25, 1.5, 2.0],
      accentColor: '#e8590c',
      theme: 'light',
    });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');

    // AC 6.5 — the slider's HTML step is 0.01 (so it can hold the +/- buttons'
    // fine values); the 0.05 drag-snap is applied in JS, not via the step attr.
    const slider = popup.locator('#speedSlider');
    await expect(slider).toHaveAttribute('min', '0.01');
    await expect(slider).toHaveAttribute('step', '0.01');

    // AC 6.2 — exactly 6 preset buttons rendered from customPresets
    const presets = popup.locator('.preset-btn');
    await expect(presets).toHaveCount(6);
    await expect(presets.nth(0)).toContainText('0.5');
    await expect(presets.nth(5)).toContainText('2');

    // AC 6.7 — header carries the icon-D play triangle (not the old chevrons)
    const triangle = popup.locator('svg path[d="M9 5l9 7-9 7z"]');
    await expect(triangle).toHaveCount(1);

    // AC 6.2 — clicking a preset sets the active state
    await presets.nth(5).click(); // 2.0x
    await expect(presets.nth(5)).toHaveClass(/active/);

    await popup.screenshot({ path: path.join(SHOT_DIR, 'popup-light.png') });
  });

  test('+/- step by 0.05 REPEATEDLY and reach the 0.01 floor (regression)', async ({
    context,
    background,
    extensionId,
  }) => {
    await seed(background, { defaultPlaybackSpeed: 0.1, theme: 'light' });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');

    const slider = popup.locator('#speedSlider');
    // A range input canonicalizes its value string (0.10 -> "0.1"), so compare
    // numerically. The small spacing between clicks just lets the UI settle
    // between discrete presses; the slider value updates synchronously.
    const val = () => slider.evaluate((el) => parseFloat(el.value));
    const dec = popup.locator('#decreaseSpeed');
    const inc = popup.locator('#increaseSpeed');
    const clickDec = async () => { await dec.click(); await popup.waitForTimeout(60); };
    const clickInc = async () => { await inc.click(); await popup.waitForTimeout(60); };

    expect(await val()).toBeCloseTo(0.1, 5);

    // Step DOWN by 0.05, must NOT freeze (the 0.05-step slider bug) and must
    // reach the 0.01 floor: 0.10 → 0.05 → 0.01 → (stays) 0.01.
    await clickDec(); expect(await val()).toBeCloseTo(0.05, 5);
    await clickDec(); expect(await val()).toBeCloseTo(0.01, 5);
    await clickDec(); expect(await val()).toBeCloseTo(0.01, 5); // pinned at floor

    // Step UP from the floor snaps back onto the 0.05 grid: 0.01 → 0.05 → 0.10.
    await clickInc(); expect(await val()).toBeCloseTo(0.05, 5);
    await clickInc(); expect(await val()).toBeCloseTo(0.1, 5);
  });

  test('slider drag snaps to the coarse 0.25 grid (0.25/0.5/0.75/1.0…)', async ({
    context,
    background,
    extensionId,
  }) => {
    await seed(background, { defaultPlaybackSpeed: 1.0, theme: 'light' });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');

    /** Drag the slider to a raw value, fire the input handler, return the snap. */
    const drag = (raw) =>
      popup.evaluate(async (v) => {
        const s = /** @type {HTMLInputElement} */ (
          document.getElementById('speedSlider')
        );
        s.value = String(v);
        s.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120)); // past the 50ms debounce
        return s.value;
      }, raw);

    // 1.10 snaps DOWN to 1.0 on the 0.25 grid (the old 0.05 grid would keep 1.10).
    expect(parseFloat(await drag(1.1))).toBeCloseTo(1.0, 5);
    // 1.40 snaps UP to 1.5 (the old 0.05 grid would keep 1.40).
    expect(parseFloat(await drag(1.4))).toBeCloseTo(1.5, 5);
  });

  test('6.3 — popup dark theme: data-theme + dark tokens + AA contrast', async ({
    context,
    background,
    extensionId,
  }) => {
    await seed(background, {
      defaultPlaybackSpeed: 1.0,
      customPresets: [0.5, 0.75, 1.0, 1.25, 1.5, 2.0],
      accentColor: '#e8590c',
      theme: 'dark',
    });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');

    // Explicit override applied to the root element.
    await expect(popup.locator('html')).toHaveAttribute('data-theme', 'dark');

    // The body background should be a dark surface (low luminance), proving the
    // dark token block is in effect — not the light default.
    const bgLum = await popup.evaluate(() => {
      const rgb = getComputedStyle(document.body).backgroundColor;
      const [r, g, b] = rgb.match(/\d+/g).map(Number);
      // relative luminance, sRGB
      const lin = (c) => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    });
    expect(bgLum).toBeLessThan(0.1); // dark

    // Body text must clear AA (4.5:1) against that dark background.
    const textContrast = await popup.evaluate(() => {
      const cs = getComputedStyle(document.body);
      const parse = (s) => s.match(/\d+/g).map(Number);
      const lin = (c) => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      const lum = ([r, g, b]) =>
        0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const L1 = lum(parse(cs.color));
      const L2 = lum(parse(cs.backgroundColor));
      const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
      return (hi + 0.05) / (lo + 0.05);
    });
    expect(textContrast).toBeGreaterThanOrEqual(4.5);

    await popup.screenshot({ path: path.join(SHOT_DIR, 'popup-dark.png') });
  });

  test('6.6 — custom accent recolors --primary-color with AA-safe label', async ({
    context,
    background,
    extensionId,
  }) => {
    // A mid-blue accent forces the contrast machinery to do real work.
    await seed(background, {
      defaultPlaybackSpeed: 1.0,
      customPresets: [0.5, 0.75, 1.0, 1.25, 1.5, 2.0],
      accentColor: '#1971c2',
      theme: 'light',
    });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');

    // --primary-color reflects the saved accent (possibly darkened for AA, but
    // it must NOT still be the orange default).
    const primary = await popup.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--primary-color')
        .trim(),
    );
    expect(primary.toLowerCase()).not.toBe('#e8590c');

    // The accent fill must carry its label (--on-accent) at >= 4.5:1.
    const fillContrast = await popup.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const toRgb = (v) => {
        v = v.trim();
        if (v.startsWith('#')) {
          const h = v.slice(1);
          return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
        }
        return v.match(/\d+/g).map(Number);
      };
      const lin = (c) => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      const lum = ([r, g, b]) =>
        0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const L1 = lum(toRgb(root.getPropertyValue('--primary-color')));
      const L2 = lum(toRgb(root.getPropertyValue('--on-accent')));
      const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
      return (hi + 0.05) / (lo + 0.05);
    });
    expect(fillContrast).toBeGreaterThanOrEqual(4.5);

    await popup.screenshot({
      path: path.join(SHOT_DIR, 'popup-accent-blue.png'),
    });
  });

  test('6.1/6.4/6.5 — options: preset grid, theme selector, accent picker, 0.01 input', async ({
    context,
    background,
    extensionId,
  }) => {
    await seed(background, {
      defaultPlaybackSpeed: 1.5,
      customPresets: [0.5, 0.75, 1.0, 1.25, 1.5, 2.0],
      accentColor: '#e8590c',
      theme: 'auto',
    });

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options/options.html`);
    await options.waitForLoadState('domcontentloaded');

    // AC 6.1 — 6 editable preset inputs, reflecting saved values
    for (let i = 0; i < 6; i++) {
      await expect(options.locator(`#preset${i}`)).toHaveCount(1);
    }
    await expect(options.locator('#preset0')).toHaveValue('0.5');

    // AC 6.4 — theme selector with light/dark/auto, reflecting saved 'auto'
    const themeSelect = options.locator('#themeSelect');
    await expect(themeSelect).toHaveValue('auto');
    await expect(themeSelect.locator('option')).toHaveCount(3);

    // AC 6.6 — accent picker present (swatches + custom color input)
    await expect(options.locator('#accentColorInput')).toHaveCount(1);
    expect(await options.locator('.accent-swatch').count()).toBeGreaterThan(0);

    // AC 6.5 — typed speed input precision 0.01
    const speedInput = options.locator('#speedInput');
    await expect(speedInput).toHaveAttribute('step', '0.01');
    await expect(speedInput).toHaveAttribute('min', '0.01');

    await options.screenshot({
      path: path.join(SHOT_DIR, 'options-light.png'),
      fullPage: true,
    });

    // AC 6.1 — out-of-range preset value snaps back into [0.01, 4.0] on write.
    await options.locator('#preset0').fill('99');
    await options.locator('#preset0').blur();
    // Give the change handler + storage write a beat.
    await options.waitForTimeout(300);
    const after = await readAll(background);
    expect(after.customPresets[0]).toBeLessThanOrEqual(4.0);
    expect(after.customPresets[0]).toBeGreaterThanOrEqual(0.01);

    // AC 6.4 — switching the theme selector persists theme.
    await themeSelect.selectOption('dark');
    await options.waitForTimeout(300);
    const after2 = await readAll(background);
    expect(after2.theme).toBe('dark');
  });
});
