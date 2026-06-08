/**
 * Static-analysis tests for the speed range + single-source constants invariant.
 *
 * Originally Story 0.3 ("normalize the speed range across components") enforced
 * that every JS file DECLARED its own MIN=0.25 / MAX=4.0 copy. That duplication
 * was later removed: the range now lives ONCE in constants.js and every component
 * sources it (manifest content_scripts load order / <script> tag / require). This
 * guard was rewritten to enforce the new invariant:
 *
 *   constants.js declares  SPEED_MIN = 0.01,  SPEED_MAX = 4.0
 *   consumers REFERENCE the names; they do NOT re-declare numeric copies
 *   slider/input min = 0.01, max = 4.0
 *
 * Runnable with plain Node.js — no test framework required:
 *   node tests/test-speed-range.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'src');

function readSource(relPath) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) throw new Error(`Source file not found: ${full}`);
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

const SOURCES = {
  'constants.js': readSource('constants.js'),
  'content.js': readSource('content.js'),
  'content-youtube.js': readSource('content-youtube.js'),
  'popup/popup.js': readSource('popup/popup.js'),
  'popup/popup.html': readSource('popup/popup.html'),
  'options/options.js': readSource('options/options.js'),
  'options/options.html': readSource('options/options.html'),
};

// ===================================================================
// AC 1 — constants.js is the single source: SPEED_MIN = 0.01, SPEED_MAX = 4.0
// ===================================================================
console.log('\n--- AC 1: constants.js declares the canonical range ---');

assert(
  /SPEED_MIN\s*=\s*0\.01\b/.test(SOURCES['constants.js']),
  'constants.js declares SPEED_MIN = 0.01'
);
assert(
  /SPEED_MAX\s*=\s*4(?:\.0+)?\b/.test(SOURCES['constants.js']),
  'constants.js declares SPEED_MAX = 4.0'
);

// ===================================================================
// AC 2 — Single source: consumers must NOT re-declare a numeric SPEED_MIN/MAX
//         (they destructure from the shared VSC object instead).
// ===================================================================
console.log('\n--- AC 2: no consumer re-declares a numeric range constant ---');

const CONSUMERS = ['content.js', 'popup/popup.js', 'options/options.js'];
const REDECL_MIN_RE = /(?:const|let|var)\s+SPEED_MIN\s*=\s*[\d.]/;
const REDECL_MAX_RE = /(?:const|let|var)\s+SPEED_MAX\s*=\s*[\d.]/;

for (const file of CONSUMERS) {
  assert(
    !REDECL_MIN_RE.test(SOURCES[file]),
    `${file} does NOT re-declare a numeric SPEED_MIN (sources it from constants.js)`
  );
  assert(
    !REDECL_MAX_RE.test(SOURCES[file]),
    `${file} does NOT re-declare a numeric SPEED_MAX (sources it from constants.js)`
  );
  assert(
    /SPEED_MIN/.test(SOURCES[file]) && /SPEED_MAX/.test(SOURCES[file]),
    `${file} references SPEED_MIN / SPEED_MAX by name`
  );
}

// ===================================================================
// AC 3 — No stale upper/lower bounds linger in validation contexts.
// ===================================================================
console.log('\n--- AC 3: no stale range literals in validation logic ---');

assert(!/<=\s*16\b/.test(SOURCES['content.js']), 'content.js does not validate <= 16 (old max)');
assert(!/<=\s*16\b/.test(SOURCES['popup/popup.js']), 'popup/popup.js does not validate <= 16 (old max)');
assert(!/>\s*2\.0\b/.test(SOURCES['options/options.js']), 'options/options.js does not validate > 2.0 (old max)');

// ===================================================================
// AC 4 — Slider / input range attributes: min = 0.01, max = 4.0
// ===================================================================
console.log('\n--- AC 4: slider/input range attributes ---');

assert(/min=["']0\.01["']/.test(SOURCES['popup/popup.html']), 'popup/popup.html slider min attribute is 0.01');
assert(/max=["']4(?:\.0+)?["']/.test(SOURCES['popup/popup.html']), 'popup/popup.html slider max attribute is 4.0');
// The slider's HTML step MUST stay 0.01 so it can HOLD the clean 0.05-grid
// values (0.05, 0.10, …) plus the 0.01 floor. A 0.05-step <input> is offset by
// the 0.01 min (it would land on 1.01/1.51) and re-sanitizes values off the
// grid. The 0.05 grid + floor for both the drag and the +/- buttons is applied
// in JS (snapToSliderStep).
assert(/id=["']speedSlider["'][\s\S]*?step=["']0\.01["']/.test(SOURCES['popup/popup.html']), 'popup/popup.html slider step attribute is 0.01 (holds the JS 0.05 grid + 0.01 floor)');
assert(/min=["']0\.01["']/.test(SOURCES['options/options.html']), 'options/options.html input min attribute is 0.01');
assert(/max=["']4(?:\.0+)?["']/.test(SOURCES['options/options.html']), 'options/options.html input max attribute is 4.0');

// ===================================================================
// Bonus — user-facing help text references the new range.
// ===================================================================
console.log('\n--- Bonus: user-facing range text ---');

assert(
  /0\.01/.test(SOURCES['options/options.html']) && /4\.0/.test(SOURCES['options/options.html']),
  'options/options.html help text mentions 0.01 and 4.0'
);

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
