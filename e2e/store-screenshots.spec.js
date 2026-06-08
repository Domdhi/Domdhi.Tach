// @ts-check
// Chrome Web Store screenshot generator (Story 7.3 AC2).
//
// Produces the five 1280×800 store assets in docs/design/store/ by driving the
// REAL extension popup/options (chrome-extension://<id>/...) — the browser MCP
// can't reach extension pages, but Playwright's persistent context can. Each UI
// is seeded via chrome.storage.sync, screenshotted tightly, then composited onto
// a branded 1280×800 canvas using the SAME gradient + caption math as the manual
// docs/design/store/screenshot-framer.html, so output matches that tool.
//
// Asset generator, not a test: guarded behind SHOTS=1 so it stays out of the
// normal `npm run e2e` run. Run it with:
//     SHOTS=1 npx playwright test e2e/store-screenshots.spec.js
// HEADED ONLY (the MV3 service worker doesn't start headless in this WSL2 env —
// see e2e/extension.js / epic07-visual.spec.js).

const path = require('path');
const fs = require('fs');
const { test } = require('./extension');

const OUT_DIR = path.resolve(__dirname, '..', 'docs/design/store');
// The SHIPPED default accent (DEFAULT_SETTINGS.accentColor / theme.css
// --primary-color) — Deep Amethyst. Drives both the seeded UI accent and the
// canvas gradient so the shots show exactly what a new user sees out of the box.
// (The orange #e8590c in screenshot-framer.html predates the Domdhi.OS violet.)
const ACCENT = '#9D4EDD';

const RUN = !!process.env.SHOTS;

/** Seed a settings object into chrome.storage.sync from the service worker. */
async function seed(background, settings) {
  await background.evaluate(
    (s) => new Promise((resolve) => chrome.storage.sync.set(s, resolve)),
    settings,
  );
}

/**
 * Composite a tight UI capture onto a branded 1280×800 canvas (accent gradient,
 * centered card with shadow + rounded corners, optional caption) and return the
 * PNG buffer. Mirrors screenshot-framer.html's draw routine.
 */
async function frame(context, rawPng, { title, subtitle }) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent('<canvas id="cv" width="1280" height="800"></canvas>');
  const src = 'data:image/png;base64,' + rawPng.toString('base64');
  const dataUrl = await page.evaluate(
    async ({ src, title, subtitle, accent }) => {
      const cv = /** @type {HTMLCanvasElement} */ (document.getElementById('cv'));
      const ctx = cv.getContext('2d');
      // Background — accent gradient (orange → dark slate), 45°.
      const g = ctx.createLinearGradient(0, 0, 1280, 800);
      g.addColorStop(0, accent);
      g.addColorStop(1, '#1c2128');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1280, 800);

      let topReserved = 0;
      if (title) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 46px -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(title, 640, 96);
        topReserved = 110;
        if (subtitle) {
          ctx.fillStyle = 'rgba(255,255,255,.82)';
          ctx.font = '400 22px -apple-system, "Segoe UI", Roboto, sans-serif';
          ctx.fillText(subtitle, 640, 138);
          topReserved = 162;
        }
      }

      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = src;
      });

      // Scale the capture UP to fill the available area (popups are ~300px wide).
      let w = img.width;
      let h = img.height;
      const maxH = 800 - topReserved - 72;
      const maxW = 1280 - 160;
      const k = Math.min(maxH / h, maxW / w);
      w *= k;
      h *= k;
      const x = (1280 - w) / 2;
      const y = topReserved + (800 - topReserved - h) / 2;
      const r = Math.min(20, w * 0.04);

      // Card shadow.
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.45)';
      ctx.shadowBlur = 44;
      ctx.shadowOffsetY = 20;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();
      ctx.restore();

      // Clipped UI.
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.clip();
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();

      return cv.toDataURL('image/png');
    },
    { src, title, subtitle, accent: ACCENT },
  );
  await page.close();
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

/** Set the popup's hidden speedSlider and fire input so the gauge reflects it. */
async function setGauge(popup, speed) {
  await popup.evaluate((v) => {
    const s = /** @type {HTMLInputElement} */ (document.getElementById('speedSlider'));
    s.value = String(v);
    s.dispatchEvent(new Event('input', { bubbles: true }));
  }, speed);
  await popup.waitForTimeout(200);
}

async function write(name, buf) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, name), buf);
}

test.describe('Web Store screenshots (SHOTS=1)', () => {
  test.skip(!RUN, 'asset generator — run with SHOTS=1');
  test.describe.configure({ timeout: 120_000 });

  const BASE = {
    defaultPlaybackSpeed: 1.0,
    customPresets: [0.5, 0.75, 1.0, 1.25, 1.5, 2.0],
    accentColor: ACCENT,
  };

  test('01 — popup (light) with transcript row', async ({ context, background, extensionId }) => {
    await seed(background, { ...BASE, theme: 'light', defaultPlaybackSpeed: 1.75 });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(250);
    await setGauge(popup, 1.75);
    // Reveal the YouTube-only transcript row + a realistic per-site domain so the
    // shot showcases the feature exactly as it appears on a watch page.
    await popup.evaluate(() => {
      const btn = document.getElementById('copyTranscriptBtn');
      const chip = document.getElementById('includeTimestampsLabel');
      if (btn) btn.hidden = false;
      if (chip) chip.hidden = false;
      const dom = document.getElementById('rememberSiteDomain');
      if (dom) dom.textContent = 'youtube.com';
    });
    await popup.waitForTimeout(100);
    const raw = await popup.locator('.container').screenshot();
    await write('01-popup-light.png', await frame(context, raw, {
      title: 'Every video, your speed',
      subtitle: 'Default speed everywhere · gauge, presets, shortcuts',
    }));
  });

  test('02 — popup (dark)', async ({ context, background, extensionId }) => {
    await seed(background, { ...BASE, theme: 'dark', defaultPlaybackSpeed: 0.75 });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(250);
    await setGauge(popup, 0.75);
    await popup.evaluate(() => {
      const dom = document.getElementById('rememberSiteDomain');
      if (dom) dom.textContent = 'vimeo.com';
    });
    const raw = await popup.locator('.container').screenshot();
    await write('02-popup-dark.png', await frame(context, raw, {
      title: 'Looks the way you like',
      subtitle: 'Light, dark, or auto — with a custom accent color',
    }));
  });

  test('03 — in-popup settings (gear view)', async ({ context, background, extensionId }) => {
    await seed(background, { ...BASE, theme: 'light' });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(250);
    await popup.locator('#openSettingsBtn').click();
    // Wait for the embedded options iframe to render its first card.
    await popup.frameLocator('#settingsFrame').locator('#speedInput').waitFor({ state: 'visible' });
    await popup.waitForTimeout(400);
    // The embedded options stack many cards, so .container is very tall — capturing
    // it whole shrinks to an illegible strip. Clip to the top region (header +
    // first few settings cards) for a card that reads like the other popup shots.
    const box = await popup.locator('.container').boundingBox();
    const raw = await popup.screenshot({
      clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 500) },
    });
    await write('03-settings.png', await frame(context, raw, {
      title: 'Settings, one click away',
      subtitle: 'A gear in the popup — no extra tab needed',
    }));
  });

  test('04 — options (full tab)', async ({ context, background, extensionId }) => {
    await seed(background, {
      ...BASE,
      theme: 'light',
      defaultPlaybackSpeed: 1.5,
      hideShorts: true,
      hideComments: false,
      hideChatFullscreen: true,
      skipAds: true,
      perSiteSpeeds: { 'youtube.com': 1.5, 'udemy.com': 1.25 },
    });
    const options = await context.newPage();
    await options.setViewportSize({ width: 900, height: 1120 });
    await options.goto(`chrome-extension://${extensionId}/options/options.html`);
    await options.waitForLoadState('domcontentloaded');
    await options.waitForTimeout(400);
    const raw = await options.screenshot(); // viewport (portrait), not fullPage
    await write('04-options.png', await frame(context, raw, {
      title: 'Fine-tune everything',
      subtitle: 'Per-site presets, custom speeds, YouTube cleanup',
    }));
  });

  test('05 — per-site memory (popup, remember on)', async ({ context, background, extensionId }) => {
    await seed(background, { ...BASE, theme: 'light', defaultPlaybackSpeed: 2.0 });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(250);
    await setGauge(popup, 2.0);
    await popup.evaluate(() => {
      const dom = document.getElementById('rememberSiteDomain');
      if (dom) dom.textContent = 'youtube.com';
      const tog = /** @type {HTMLInputElement} */ (document.getElementById('rememberSiteToggle'));
      if (tog) tog.checked = true;
    });
    await popup.waitForTimeout(100);
    const raw = await popup.locator('.container').screenshot();
    await write('05-presets.png', await frame(context, raw, {
      title: 'Remember per site',
      subtitle: 'A different speed for each site, saved automatically',
    }));
  });
});
