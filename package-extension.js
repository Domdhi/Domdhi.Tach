#!/usr/bin/env node
/**
 * package-extension.js — produce a clean Chrome Web Store zip of Tach.
 *
 * WHITELIST-based (not exclude-based): only the files the manifest actually loads
 * are packaged, so dev-only artifacts (tests/, e2e/, docs/, create_icons.js, the
 * configs, node_modules/, .claude/, .git/) can NEVER leak into a published build.
 * Adding a new loadable file to the extension means adding it to INCLUDE below —
 * the script fails loudly if a listed file is missing, so the list can't silently
 * drift out of sync with the manifest.
 *
 * Output: dist/Tach-v<manifest.version>.zip  (manifest.json at the zip root).
 * Run:    npm run package        (requires the `zip` CLI — present on macOS/Linux/WSL)
 *
 * No build step / no bundler (ADR-002): this is a release packaging tool, not a
 * dev build. Load-unpacked at chrome://extensions is still the dev workflow.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
// The loadable extension lives in src/ (manifest.json at its root). The zip is
// produced with cwd: SRC so manifest.json lands at the ZIP root (Web Store
// requirement), while dist/ output stays at the repo root.
const SRC = path.join(ROOT, 'src');

// The exact loadable set, RELATIVE TO src/. Keep in sync with manifest.json's
// referenced files: background.service_worker, content_scripts[].js,
// action.default_popup, options_page, icons.*, and the shared theme.css.
const INCLUDE = [
  'manifest.json',
  'constants.js',
  'background.js',
  'content.js',
  'content-youtube.js',
  'theme.css',
  'popup/popup.html',
  'popup/popup.css',
  'popup/popup.js',
  'options/options.html',
  'options/options.css',
  'options/options.js',
  'icons/icon-16.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
  // Bundled self-hosted webfonts (SIL OFL 1.1) — referenced by theme.css
  // @font-face. The license files ship alongside them (OFL attribution).
  'fonts/jetbrains-mono-400.woff2',
  'fonts/jetbrains-mono-500.woff2',
  'fonts/jetbrains-mono-700.woff2',
  'fonts/space-grotesk-500.woff2',
  'fonts/space-grotesk-700.woff2',
  'fonts/JetBrainsMono-OFL.txt',
  'fonts/SpaceGrotesk-OFL.txt',
];

function fail(msg) {
  console.error('[package] ERROR: ' + msg);
  process.exit(1);
}

// 1. Every whitelisted file must exist — a missing referenced file is a broken build.
const missing = INCLUDE.filter((f) => !fs.existsSync(path.join(SRC, f)));
if (missing.length) fail('missing files: ' + missing.join(', '));

// 2. Version comes from the single source of truth (manifest.json). The popup
//    displays chrome.runtime.getManifest().version, so this is what users see.
const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
const version = manifest.version;
if (!version) fail('manifest.json has no version');

// 3. Fresh dist/ + deterministic output path.
const distDir = path.join(ROOT, 'dist');
fs.mkdirSync(distDir, { recursive: true });
// Clear ALL prior zips so stale Tach-v<oldversion>.zip don't accumulate
// across version bumps (and never append to a stale same-name zip).
for (const f of fs.readdirSync(distDir)) {
  if (f.endsWith('.zip')) fs.unlinkSync(path.join(distDir, f));
}
const zipName = `Tach-v${version}.zip`;
const relZip = path.join('dist', zipName);
const zipPath = path.join(ROOT, relZip);

// 4. Zip exactly the whitelist (paths relative to SRC → manifest.json at zip root).
//    cwd is SRC so entries are stored without a leading src/; zipPath is absolute
//    so the archive still lands in the repo-root dist/.
try {
  execFileSync('zip', ['-q', zipPath, ...INCLUDE], {
    cwd: SRC,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
} catch (e) {
  fail('`zip` failed — is the zip CLI installed? (' + e.message + ')');
}

// 5. Report.
const bytes = fs.statSync(zipPath).size;
console.log(`[package] ${zipName} — ${INCLUDE.length} files, ${(bytes / 1024).toFixed(1)} KB`);
console.log(`[package] → ${relZip}`);
console.log('[package] next: unzip to a fresh folder, Load unpacked, confirm no console');
console.log('[package]       errors, and smoke FR-1 (default speed) / FR-2 (manual) / FR-3 (per-site).');
