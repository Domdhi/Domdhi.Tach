/**
 * Static-analysis tests for Story 0.1: Review Auto-Generated Documentation
 *
 * These tests verify that the documentation (docs/_architecture.md, docs/_prd.md)
 * accurately reflects the actual codebase. Each test reads a claim from the docs
 * and cross-references it against the source-of-truth files (manifest.json,
 * package.json, source code, and the filesystem).
 *
 * Acceptance Criteria:
 *   AC 1 — All docs reviewed for accuracy
 *   AC 2 — LOW confidence items identified and fixed
 *   AC 3 — Documentation reflects actual codebase behavior
 *
 * Runnable with plain Node.js — no test framework required.
 *
 *   node tests/test-doc-accuracy.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..');

function readSource(relPath) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) {
    throw new Error(`Source file not found: ${full}`);
  }
  return fs.readFileSync(full, 'utf-8');
}

function fileExists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
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
// Load source-of-truth files and documentation
// ---------------------------------------------------------------------------

const manifest = JSON.parse(readSource('src/manifest.json'));
const pkg = JSON.parse(readSource('package.json'));
const archDoc = readSource('docs/_architecture.md');
const prdDoc = readSource('docs/_prd.md');
const contentJs = readSource('src/content.js');
const backgroundJs = readSource('src/background.js');
const popupJs = readSource('src/popup/popup.js');
const optionsJs = readSource('src/options/options.js');
const popupHtml = readSource('src/popup/popup.html');
const optionsHtml = readSource('src/options/options.html');


// ===================================================================
// AC 1 + AC 3 — Version numbers in docs match manifest.json
// ===================================================================

console.log('\n--- Version numbers in docs match manifest.json ---');

const manifestVersion = manifest.version;

assert(
  archDoc.includes(`| **Version** | ${manifestVersion} |`),
  `_architecture.md header version matches manifest.json (${manifestVersion})`
);

assert(
  prdDoc.includes(`| **Version** | ${manifestVersion} |`),
  `_prd.md header version matches manifest.json (${manifestVersion})`
);

// Verify manifest version is valid semver
assert(
  /^\d+\.\d+\.\d+$/.test(manifestVersion),
  `manifest.json version "${manifestVersion}" is a valid X.Y.Z semver string`
);


// ===================================================================
// AC 1 + AC 3 — Dependencies listed in docs match package.json
// ===================================================================

console.log('\n--- Dependencies in docs match package.json ---');

const pkgDeps = Object.keys(pkg.dependencies || {});

// Architecture doc mentions canvas as a dependency for icon generation
for (const dep of pkgDeps) {
  assert(
    archDoc.includes(dep),
    `_architecture.md mentions package.json dependency "${dep}"`
  );
}

// Check that doc-listed dependency versions match package.json
// Architecture doc lists canvas version in the Tech Stack table
for (const dep of pkgDeps) {
  const pkgVersion = pkg.dependencies[dep];
  assert(
    archDoc.includes(pkgVersion),
    `_architecture.md lists correct version for "${dep}" (${pkgVersion})`
  );
}

// PRD should also reference the canvas dependency
for (const dep of pkgDeps) {
  assert(
    prdDoc.includes(dep),
    `_prd.md mentions package.json dependency "${dep}"`
  );
}

// Negative: docs should not claim dependencies that do not exist
// Check that docs do not reference non-existent npm dependencies
const commonFalseDepNames = ['express', 'react', 'webpack', 'typescript', 'lodash'];
for (const fakeDep of commonFalseDepNames) {
  if (!pkgDeps.includes(fakeDep)) {
    // Only check tech stack / dependencies sections, not general prose
    const techStackSection = archDoc.split('## Tech Stack')[1] || '';
    const techStackEnd = techStackSection.split('---')[0] || techStackSection;
    assert(
      !techStackEnd.includes(fakeDep),
      `_architecture.md Tech Stack does not falsely claim "${fakeDep}" as a dependency`
    );
  }
}


// ===================================================================
// AC 1 + AC 3 — File structure documented matches actual filesystem
// ===================================================================

console.log('\n--- File structure in docs matches actual filesystem ---');

// Files that the architecture doc's Project Structure section should list
const expectedFiles = [
  'src/manifest.json',
  'src/background.js',
  'src/content.js',
  'src/popup/popup.html',
  'src/popup/popup.js',
  'src/popup/popup.css',
  'src/options/options.html',
  'src/options/options.js',
  'create_icons.js',
  'package.json',
];

for (const file of expectedFiles) {
  assert(
    fileExists(file),
    `File "${file}" referenced in docs exists on disk`
  );
}

// Verify docs mention each expected file
for (const file of expectedFiles) {
  const basename = path.basename(file);
  assert(
    archDoc.includes(basename),
    `_architecture.md mentions "${basename}"`
  );
}

// Icons referenced in manifest exist on disk
const manifestIcons = Object.values(manifest.icons || {});
for (const icon of manifestIcons) {
  assert(
    fileExists('src/' + icon),
    `Icon "${icon}" from manifest.json exists on disk`
  );
}

// Docs mention the icons directory
assert(
  archDoc.includes('icons/') || archDoc.includes('icons'),
  '_architecture.md mentions icons directory'
);


// ===================================================================
// AC 1 + AC 3 — Storage keys in docs match what code actually uses
// ===================================================================

console.log('\n--- Storage keys in docs match code ---');

const STORAGE_KEY = 'defaultPlaybackSpeed';

// Architecture doc must document the storage key
assert(
  archDoc.includes(STORAGE_KEY),
  `_architecture.md documents storage key "${STORAGE_KEY}"`
);

// PRD must document the storage key
assert(
  prdDoc.includes(STORAGE_KEY),
  `_prd.md documents storage key "${STORAGE_KEY}"`
);

// Every source file that uses storage must use the documented key
const sourceFiles = {
  'content.js': contentJs,
  'background.js': backgroundJs,
  'popup/popup.js': popupJs,
  'options/options.js': optionsJs,
};

for (const [name, src] of Object.entries(sourceFiles)) {
  if (src.includes('chrome.storage.sync')) {
    assert(
      src.includes(STORAGE_KEY),
      `${name} uses the documented storage key "${STORAGE_KEY}"`
    );
  }
}

// Verify the documented storage range matches code constants
const contentMinMatch = contentJs.match(/(?:const|let|var)\s+SPEED_MIN\s*=\s*([\d.]+)/);
const contentMaxMatch = contentJs.match(/(?:const|let|var)\s+SPEED_MAX\s*=\s*([\d.]+)/);
const codeMin = contentMinMatch ? contentMinMatch[1] : null;
const codeMax = contentMaxMatch ? contentMaxMatch[1] : null;

assert(
  codeMin !== null && codeMax !== null,
  'content.js defines SPEED_MIN and SPEED_MAX constants'
);

// Architecture doc storage schema table should show the correct range
assert(
  archDoc.includes(`${codeMin} - ${codeMax}`) || archDoc.includes(`${codeMin}-${codeMax}`),
  `_architecture.md storage range matches code constants (${codeMin} - ${codeMax})`
);

// PRD should also reference the correct range
assert(
  prdDoc.includes(`${codeMin}-${codeMax}`) || prdDoc.includes(`${codeMin} - ${codeMax}`)
    || (prdDoc.includes(`${codeMin}x`) && prdDoc.includes(`${codeMax}x`)),
  `_prd.md references the correct speed range (${codeMin} to ${codeMax})`
);


// ===================================================================
// AC 1 + AC 3 — Message types in docs match what code implements
// ===================================================================

console.log('\n--- Message types in docs match code ---');

// Extract all message action handlers from content.js
const contentHandlers = [...contentJs.matchAll(/request\.action\s*===\s*'(\w+)'/g)]
  .map(m => m[1]);

// Extract all message action handlers from background.js
const bgHandlers = [...backgroundJs.matchAll(/request\.action\s*===\s*'(\w+)'/g)]
  .map(m => m[1]);

// Every handler in content.js should be documented
for (const action of contentHandlers) {
  assert(
    archDoc.includes(action),
    `_architecture.md documents content.js message handler "${action}"`
  );
}

// Every handler in background.js should be documented
for (const action of bgHandlers) {
  assert(
    archDoc.includes(action),
    `_architecture.md documents background.js message handler "${action}"`
  );
}

// Messages sent by popup.js should be documented
const popupSentMessages = [...popupJs.matchAll(/action:\s*'(\w+)'/g)]
  .map(m => m[1]);
const uniquePopupMessages = [...new Set(popupSentMessages)];

for (const action of uniquePopupMessages) {
  assert(
    archDoc.includes(action),
    `_architecture.md documents popup.js sent message "${action}"`
  );
}

// Verify no undocumented message handlers exist in content.js
const docMessageTableSection = archDoc.split('## Message Passing API')[1] || '';
const docMessageTableEnd = docMessageTableSection.split(/\n## /)[0] || docMessageTableSection;

for (const action of contentHandlers) {
  assert(
    docMessageTableEnd.includes(action),
    `Message Passing API table includes content.js handler "${action}"`
  );
}

for (const action of bgHandlers) {
  assert(
    docMessageTableEnd.includes(action),
    `Message Passing API table includes background.js handler "${action}"`
  );
}


// ===================================================================
// AC 1 + AC 3 — Speed range constants in docs match code
// ===================================================================

console.log('\n--- Speed range constants in docs match code ---');

// All JS files that define speed constants should agree
const jsFiles = {
  'content.js': contentJs,
  'popup/popup.js': popupJs,
  'options/options.js': optionsJs,
};

const minValues = {};
const maxValues = {};

for (const [name, src] of Object.entries(jsFiles)) {
  const minMatch = src.match(/(?:const|let|var)\s+SPEED_MIN\s*=\s*([\d.]+)/);
  const maxMatch = src.match(/(?:const|let|var)\s+SPEED_MAX\s*=\s*([\d.]+)/);
  if (minMatch) minValues[name] = minMatch[1];
  if (maxMatch) maxValues[name] = maxMatch[1];
}

// All min values should be identical
const minVals = Object.values(minValues);
const maxVals = Object.values(maxValues);

assert(
  minVals.length > 0 && minVals.every(v => v === minVals[0]),
  `All JS files agree on SPEED_MIN (${[...new Set(minVals)].join(', ')})`
);

assert(
  maxVals.length > 0 && maxVals.every(v => v === maxVals[0]),
  `All JS files agree on SPEED_MAX (${[...new Set(maxVals)].join(', ')})`
);

// Architecture doc should reference the correct speed range
if (minVals[0] && maxVals[0]) {
  // Popup section should show correct range
  const popupSection = archDoc.split('### Popup UI')[1] || '';
  const popupSectionEnd = popupSection.split('###')[0] || popupSection;
  assert(
    popupSectionEnd.includes(`${minVals[0]}x`) && popupSectionEnd.includes(`${maxVals[0]}x`),
    `_architecture.md Popup UI section shows correct range (${minVals[0]}x-${maxVals[0]}x)`
  );

  // Options section should show correct range
  const optionsSection = archDoc.split('### Options Page')[1] || '';
  const optionsSectionEnd = optionsSection.split('###')[0] || optionsSection;
  assert(
    optionsSectionEnd.includes(`${minVals[0]}x`) && optionsSectionEnd.includes(`${maxVals[0]}x`),
    `_architecture.md Options Page section shows correct range (${minVals[0]}x-${maxVals[0]}x)`
  );
}

// HTML slider/input attributes should match code constants
if (codeMin && codeMax) {
  const popupSliderMin = popupHtml.match(/min=["']([\d.]+)["']/);
  const popupSliderMax = popupHtml.match(/max=["']([\d.]+)["']/);

  if (popupSliderMin) {
    assert(
      popupSliderMin[1] === codeMin,
      `popup.html slider min="${popupSliderMin[1]}" matches SPEED_MIN=${codeMin}`
    );
  }
  if (popupSliderMax) {
    assert(
      popupSliderMax[1] === codeMax || parseFloat(popupSliderMax[1]) === parseFloat(codeMax),
      `popup.html slider max="${popupSliderMax[1]}" matches SPEED_MAX=${codeMax}`
    );
  }

  const optionsInputMin = optionsHtml.match(/min=["']([\d.]+)["']/);
  const optionsInputMax = optionsHtml.match(/max=["']([\d.]+)["']/);

  if (optionsInputMin) {
    assert(
      optionsInputMin[1] === codeMin,
      `options.html input min="${optionsInputMin[1]}" matches SPEED_MIN=${codeMin}`
    );
  }
  if (optionsInputMax) {
    assert(
      optionsInputMax[1] === codeMax || parseFloat(optionsInputMax[1]) === parseFloat(codeMax),
      `options.html input max="${optionsInputMax[1]}" matches SPEED_MAX=${codeMax}`
    );
  }
}


// ===================================================================
// AC 1 + AC 3 — Manifest claims in docs match actual manifest.json
// ===================================================================

console.log('\n--- Manifest claims in docs match manifest.json ---');

// Manifest V3
assert(
  manifest.manifest_version === 3,
  'manifest.json is Manifest V3'
);
assert(
  archDoc.includes('Manifest V3'),
  '_architecture.md claims Manifest V3'
);
assert(
  prdDoc.includes('Manifest V3'),
  '_prd.md claims Manifest V3'
);

// Service worker
assert(
  manifest.background.service_worker === 'background.js',
  'manifest.json service_worker is background.js'
);
assert(
  archDoc.includes('service_worker') || archDoc.includes('Service Worker') || archDoc.includes('service worker'),
  '_architecture.md mentions service worker'
);

// Content script run_at
const runAt = manifest.content_scripts[0].run_at;
assert(
  archDoc.includes(runAt),
  `_architecture.md mentions content script run_at="${runAt}"`
);

// Permissions
for (const perm of manifest.permissions) {
  assert(
    archDoc.toLowerCase().includes(perm.toLowerCase()),
    `_architecture.md mentions manifest permission "${perm}"`
  );
}

// Host permissions
assert(
  manifest.host_permissions.includes('<all_urls>'),
  'manifest.json has <all_urls> host permission'
);
assert(
  archDoc.includes('all_urls') || archDoc.includes('all URLs') || archDoc.includes('all pages'),
  '_architecture.md mentions all_urls or equivalent'
);

// Options page path
assert(
  manifest.options_page === 'options/options.html',
  'manifest.json options_page is options/options.html'
);
assert(
  archDoc.includes('options.html'),
  '_architecture.md mentions options.html'
);

// Popup path
assert(
  manifest.action.default_popup === 'popup/popup.html',
  'manifest.json default_popup is popup/popup.html'
);
assert(
  archDoc.includes('popup.html'),
  '_architecture.md mentions popup.html'
);


// ===================================================================
// AC 1 + AC 3 — Component behavior described in docs matches code
// ===================================================================

console.log('\n--- Component behavior in docs matches code ---');

// Content script uses MutationObserver (as docs claim)
assert(
  archDoc.includes('MutationObserver') && contentJs.includes('MutationObserver'),
  'Both docs and content.js reference MutationObserver'
);

// Content script uses ratechange listener (as docs claim)
assert(
  archDoc.includes('ratechange') && contentJs.includes('ratechange'),
  'Both docs and content.js reference ratechange event'
);

// Background.js sets default speed on install (as docs claim)
assert(
  backgroundJs.includes('onInstalled') && backgroundJs.includes('defaultPlaybackSpeed'),
  'background.js handles onInstalled and sets defaultPlaybackSpeed'
);
assert(
  archDoc.includes('onInstalled') || archDoc.includes('first install'),
  '_architecture.md mentions onInstalled or first install behavior'
);

// Default speed is 1.0 (as docs claim)
assert(
  /defaultPlaybackSpeed:\s*1\.0/.test(backgroundJs),
  'background.js sets defaultPlaybackSpeed to 1.0 on install'
);
assert(
  archDoc.includes('1.0') || archDoc.includes('1.0x'),
  '_architecture.md mentions default speed of 1.0'
);

// Popup reads speed from storage directly (not via getSpeed message)
const popupReadsStorage = popupJs.includes('chrome.storage.sync.get');
const popupSendsGetSpeed = popupJs.includes("action: 'getSpeed'");

// Docs should accurately describe how popup gets the current speed
if (popupReadsStorage && !popupSendsGetSpeed) {
  // Docs should say popup reads from storage, not from getSpeed message
  const popupDocSection = archDoc.split('### Popup UI')[1] || '';
  const popupDocEnd = popupDocSection.split('###')[0] || popupDocSection;
  assert(
    popupDocEnd.includes('storage') || popupDocEnd.includes('chrome.storage'),
    '_architecture.md Popup section mentions reading from storage (matches actual behavior)'
  );
}

// Content script writes to storage on setSpeed (as docs Data Access table claims)
const contentWritesSection = archDoc.split('### Data Access Pattern')[1] || '';
const contentWritesEnd = contentWritesSection.split('###')[0] || contentWritesSection;
assert(
  contentJs.includes('chrome.storage.sync.set'),
  'content.js writes to chrome.storage.sync (as docs claim)'
);


// ===================================================================
// AC 2 — No LOW confidence items remain in docs
// ===================================================================

console.log('\n--- No LOW confidence items remain (AC 2) ---');

const lowConfidenceMatches = archDoc.match(/\[LOW confidence\]/g);
const lowConfidenceCount = lowConfidenceMatches ? lowConfidenceMatches.length : 0;

assert(
  lowConfidenceCount === 0,
  `_architecture.md has no [LOW confidence] markers remaining (found: ${lowConfidenceCount})`
);

const prdLowMatches = prdDoc.match(/\[LOW confidence\]/g);
const prdLowCount = prdLowMatches ? prdLowMatches.length : 0;

assert(
  prdLowCount === 0,
  `_prd.md has no [LOW confidence] markers remaining (found: ${prdLowCount})`
);

// Verify confidence markers exist on major sections in architecture doc
const archSections = [
  'System Overview',
  'Tech Stack',
  'Architecture Diagram',
  'Component Architecture',
  'Data Architecture',
  'Message Passing API',
  'Cross-Cutting Concerns',
  'Development Standards',
];

for (const section of archSections) {
  const idx = archDoc.indexOf(`## ${section}`);
  if (idx === -1) continue;
  const after = archDoc.substring(idx, idx + 500);
  assert(
    /\[(HIGH|MEDIUM) confidence\]/.test(after),
    `_architecture.md section "${section}" has a HIGH or MEDIUM confidence marker`
  );
}


// ===================================================================
// AC 1 + AC 3 — Known Issues section accuracy
// ===================================================================

console.log('\n--- Known Issues section accuracy ---');

const knownSection = archDoc.split('## Known Issues')[1] || '';
const knownSectionEnd = knownSection.split('---')[0] || knownSection;

// Fixed issues should be struck through
if (knownSectionEnd.includes('Duplicate')) {
  assert(
    /~~.*[Dd]uplicate.*~~/.test(knownSectionEnd),
    'Fixed "Duplicate onMessage listeners" bug is struck through'
  );
}

if (knownSectionEnd.includes('Speed range')) {
  assert(
    /~~.*[Ss]peed range.*~~/.test(knownSectionEnd),
    'Fixed "Speed range inconsistency" bug is struck through'
  );
}

if (knownSectionEnd.includes('Version')) {
  assert(
    /~~.*[Vv]ersion.*~~/.test(knownSectionEnd),
    'Fixed "Version mismatch" bug is struck through'
  );
}

// No active (non-struck) issues that reference already-fixed bugs
const knownLines = knownSectionEnd.split('\n').filter(l => l.trim().startsWith('-'));
const activeIssues = knownLines.filter(l => !l.includes('~~'));

for (const line of activeIssues) {
  const lower = line.toLowerCase();
  assert(
    !(lower.includes('duplicate') && lower.includes('listener')),
    'No active known issue for already-fixed "duplicate listener" bug'
  );
  assert(
    !lower.includes('speed range inconsistency'),
    'No active known issue for already-fixed "speed range inconsistency" bug'
  );
  assert(
    !lower.includes('version mismatch'),
    'No active known issue for already-fixed "version mismatch" bug'
  );
}


// ===================================================================
// AC 1 + AC 3 — PRD-specific accuracy checks
// ===================================================================

console.log('\n--- PRD accuracy checks ---');

// PRD speed range should match code (0.25x-4.0x, not old 0.5x-2.0x)
assert(
  prdDoc.includes('0.25x') || prdDoc.includes('0.25'),
  '_prd.md references minimum speed 0.25'
);
assert(
  prdDoc.includes('4.0x') || prdDoc.includes('4.0'),
  '_prd.md references maximum speed 4.0'
);

// PRD claims chrome.storage.sync — verify manifest has storage permission
assert(
  prdDoc.includes('chrome.storage.sync') && manifest.permissions.includes('storage'),
  '_prd.md chrome.storage.sync claim is backed by manifest "storage" permission'
);

// PRD mentions keyboard shortcuts — verify popup.js implements them
assert(
  prdDoc.includes('Arrow Up') || prdDoc.includes('ArrowUp'),
  '_prd.md documents keyboard shortcuts'
);
assert(
  popupJs.includes('ArrowUp') && popupJs.includes('ArrowDown'),
  'popup.js implements ArrowUp/ArrowDown keyboard shortcuts as PRD claims'
);

// PRD mentions MutationObserver — verify code uses it
assert(
  prdDoc.includes('MutationObserver') && contentJs.includes('MutationObserver'),
  '_prd.md MutationObserver claim matches content.js implementation'
);

// PRD mentions ratechange protection — verify code implements it
assert(
  prdDoc.includes('ratechange') && contentJs.includes('ratechange'),
  '_prd.md ratechange protection claim matches content.js implementation'
);

// PRD default speed of 1.0 matches background.js
assert(
  prdDoc.includes('default speed to 1.0') || prdDoc.includes('defaultPlaybackSpeed'),
  '_prd.md mentions default speed initialization'
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
