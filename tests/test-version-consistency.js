/**
 * Static-analysis tests for Story 0.4: Fix Version Mismatch
 *
 * These tests verify that the extension has a single source of truth
 * for the version number, and that no stale hardcoded version strings
 * remain in the popup UI.
 *
 * Acceptance Criteria:
 *   AC 1 — Manifest version and popup display version match
 *   AC 2 — Single source of truth for version number
 *
 * Runnable with plain Node.js — no test framework required.
 *
 *   node tests/test-version-consistency.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..', 'src');

function readSource(relPath) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) {
    throw new Error(`Source file not found: ${full}`);
  }
  return fs.readFileSync(full, 'utf-8');
}

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${testName}`);
  } else {
    failed++;
    failures.push(testName);
    console.log(`  FAIL  ${testName}`);
  }
}

// ---------------------------------------------------------------------------
// Load source files
// ---------------------------------------------------------------------------

const manifest = JSON.parse(readSource('manifest.json'));
const popupHtml = readSource('popup/popup.html');
const popupJs = readSource('popup/popup.js');
// The version display lives on the OPTIONS page (#optionsAbout), populated at
// runtime from chrome.runtime.getManifest().version. It was moved off the popup
// (the popup footer was removed to fit YouTube watch pages) — so the
// single-source-of-truth checks target options.js / options.html.
const optionsHtml = readSource('options/options.html');
const optionsJs = readSource('options/options.js');

const manifestVersion = manifest.version;

console.log(`\nManifest version detected: ${manifestVersion}\n`);


// ===================================================================
// AC 1 — Manifest version and displayed version match
//
// The options page may contain a fallback/default version string. If it
// does, it must match the manifest version exactly. If the version is
// shown purely at runtime via JS, no HTML fallback should display a stale
// version that disagrees with the manifest — on EITHER page.
// ===================================================================

console.log('--- AC 1: Manifest version and displayed version match ---');

// 1a. The manifest must declare a valid semver-ish version string
assert(
  /^\d+\.\d+\.\d+$/.test(manifestVersion),
  'manifest.json version is a valid X.Y.Z semver string'
);

// 1b. If options.html contains the version element with a hardcoded fallback,
//     that fallback must match the manifest version.
const versionElementRE = /id=["']optionsAbout["'][^>]*>([^<]*)</;
const versionMatch = optionsHtml.match(versionElementRE);

if (versionMatch) {
  const fallbackText = versionMatch[1].trim();
  // Strip the leading brand label / 'v' — we only care about a version number.
  const fallbackVersionMatch = fallbackText.match(/\d+\.\d+\.\d+/);
  if (fallbackVersionMatch) {
    assert(
      fallbackVersionMatch[0] === manifestVersion,
      `options.html fallback version ("${fallbackText}") matches manifest version ("${manifestVersion}")`
    );
  } else {
    console.log('  INFO  #optionsAbout has no hardcoded version fallback (OK — JS populates it at runtime)');
  }
} else {
  console.log('  INFO  options.html version element resolved at runtime (no static fallback)');
}

// 1c. No stale "vX.Y.Z" strings on EITHER page that contradict the manifest.
const allVersionStrings = (popupHtml + '\n' + optionsHtml).match(/v\d+\.\d+\.\d+/g) || [];
const staleVersions = allVersionStrings.filter(v => v !== `v${manifestVersion}`);

assert(
  staleVersions.length === 0,
  `popup.html + options.html contain no stale version strings (found: ${staleVersions.length > 0 ? staleVersions.join(', ') : 'none'})`
);


// ===================================================================
// AC 2 — Single source of truth for version number
//
// options.js must read the version from chrome.runtime.getManifest()
// rather than having its own hardcoded version string. The manifest
// is the single source of truth.
// ===================================================================

console.log('\n--- AC 2: Single source of truth for version number ---');

// 2a. options.js must reference chrome.runtime.getManifest to get the version
assert(
  /chrome\.runtime\.getManifest\s*\(\s*\)/.test(optionsJs),
  'options.js calls chrome.runtime.getManifest() to retrieve the version'
);

// 2b. Neither popup.js nor options.js may contain hardcoded version strings
//     like 'v1.0.0' — the manifest is the only source.
const hardcodedVersionRE = /['"]v?\d+\.\d+\.\d+['"]/g;
const hardcodedMatches = (popupJs + '\n' + optionsJs).match(hardcodedVersionRE) || [];

assert(
  hardcodedMatches.length === 0,
  `popup.js + options.js contain no hardcoded version strings (found: ${hardcodedMatches.length > 0 ? hardcodedMatches.join(', ') : 'none'})`
);

// 2c. options.js should reference getManifest().version specifically,
//     meaning it actually extracts the .version property
assert(
  /getManifest\s*\(\s*\)\s*\.\s*version/.test(optionsJs),
  'options.js accesses .version from getManifest() result'
);

// 2d. The version element exists in options.html so JS can populate it
assert(
  /id=["']optionsAbout["']/.test(optionsHtml),
  'options.html has a version element with id="optionsAbout" for JS to populate'
);

// 2e. options.js references the version DOM element to update it
assert(
  /getElementById\s*\(\s*['"]optionsAbout['"]\s*\)|querySelector\s*\(\s*['"]#optionsAbout['"]\s*\)/.test(optionsJs),
  'options.js selects the version element from the DOM'
);


// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n========================================');
console.log(`  Total: ${passed + failed}   Passed: ${passed}   Failed: ${failed}`);
console.log('========================================');

if (failed > 0) {
  console.log('\nFailed tests:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
  process.exit(0);
}
