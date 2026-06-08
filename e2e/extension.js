// @ts-check
// Shared E2E fixture: launches Chromium with Tach loaded as an unpacked
// extension, resolves the extension id from its MV3 service worker, and serves
// the local fixture pages over HTTP.
//
// Owned by Story 2.1. Wave-2 specs (2.2 / 2.3) import { test, expect } from here
// and MUST NOT modify this file.
const path = require('path');
const fs = require('fs');
const http = require('http');
const { test: base, chromium, expect } = require('@playwright/test');

// The "unpacked extension" is the src/ folder — manifest.json lives there and
// there is no build artifact (ADR-002).
const EXTENSION_PATH = path.resolve(__dirname, '..', 'src');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// Content scripts do NOT run on file:// URLs unless "Allow access to file URLs"
// is enabled (off by default). So fixture pages must be served over http:// for
// the content script to inject. This tiny static server does exactly that.
function startFixtureServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = (req.url || '/').split('?')[0];
      const rel = url === '/' ? 'video.html' : url.replace(/^\/+/, '');
      const filePath = path.join(FIXTURES_DIR, rel);
      if (!filePath.startsWith(FIXTURES_DIR) || !fs.existsSync(filePath)) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      const ext = path.extname(filePath);
      const TYPES = { '.html': 'text/html', '.webm': 'video/webm', '.mp4': 'video/mp4' };
      res.setHeader('Content-Type', TYPES[ext] || 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');
      res.end(fs.readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('net').AddressInfo} */ (server.address());
      resolve({ server, baseURL: `http://127.0.0.1:${port}` });
    });
  });
}

const test = base.extend({
  // Worker-scoped static server for fixture pages. (Named fixtureBaseURL, not
  // baseURL — baseURL is a reserved Playwright option fixture and cannot be
  // re-scoped to 'worker'.)
  fixtureBaseURL: [
    async ({ }, use) => {
      const { server, baseURL } = await startFixtureServer();
      await use(baseURL);
      await new Promise((r) => server.close(r));
    },
    { scope: 'worker' },
  ],

  // Override the default `context` with a persistent context that has the
  // extension loaded. The default Playwright browser context cannot load
  // extensions; only a persistent context launched this way can.
  context: async ({ }, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: process.env.HEADLESS === '1',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
      ],
    });
    await use(context);
    await context.close();
  },

  // The MV3 background service worker is how we discover the extension id.
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const extensionId = new URL(sw.url()).host;
    await use(extensionId);
  },

  // Convenience: the live service worker, for seeding chrome.storage etc.
  background: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw);
  },
});

/**
 * Seed chrome.storage.sync.defaultPlaybackSpeed from the extension's service
 * worker. Must run BEFORE navigating the page under test, because the content
 * script reads storage once on injection (document_idle).
 * @param {import('@playwright/test').Worker} background
 * @param {number} speed
 */
async function seedDefaultSpeed(background, speed) {
  await background.evaluate(
    (s) => new Promise((resolve) => chrome.storage.sync.set({ defaultPlaybackSpeed: s }, resolve)),
    speed,
  );
}

module.exports = { test, expect, EXTENSION_PATH, FIXTURES_DIR, seedDefaultSpeed };
