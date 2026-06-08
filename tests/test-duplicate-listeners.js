/**
 * Static-analysis tests for Story 0.2: Fix Duplicate Message Listeners in content.js
 *
 * These tests read content.js and verify:
 *   AC 1 — Only one chrome.runtime.onMessage.addListener block exists
 *   AC 2 — All message types (setSpeed, getSpeed) are handled correctly
 *   AC 3 — No regression in speed control functionality
 *
 * Runnable with plain Node.js — no test framework required.
 *
 *   node tests/test-duplicate-listeners.js
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
// Load source file under test
// ---------------------------------------------------------------------------

const contentSrc = readSource('content.js');


// ===================================================================
// AC 1 — Only one chrome.runtime.onMessage.addListener block exists
// ===================================================================

console.log('\n--- AC 1: Only one onMessage listener in content.js ---');

const listenerMatches = contentSrc.match(/chrome\.runtime\.onMessage\.addListener/g);
const listenerCount = listenerMatches ? listenerMatches.length : 0;

assert(
  listenerCount === 1,
  `content.js has exactly 1 onMessage.addListener call (found ${listenerCount})`
);

assert(
  listenerCount > 0,
  'content.js has at least one onMessage.addListener (not accidentally removed)'
);


// ===================================================================
// AC 2 — All message types handled correctly
//
// The single listener must handle both setSpeed and getSpeed actions,
// call sendResponse for each, and return true for async handling.
// ===================================================================

console.log('\n--- AC 2: All message types handled in the listener ---');

// 2a. setSpeed action is handled
assert(
  /['"]setSpeed['"]/.test(contentSrc),
  'content.js handles setSpeed action'
);

// 2b. getSpeed action is handled
assert(
  /['"]getSpeed['"]/.test(contentSrc),
  'content.js handles getSpeed action'
);

// 2c. sendResponse is called (at least once for each action path)
const sendResponseMatches = contentSrc.match(/sendResponse\s*\(/g);
const sendResponseCount = sendResponseMatches ? sendResponseMatches.length : 0;

assert(
  sendResponseCount >= 2,
  `content.js calls sendResponse at least twice — once per action (found ${sendResponseCount})`
);

// 2d. The listener returns true for async response support
// Look for "return true" appearing in the source — it must exist within
// the listener body to keep the message channel open for sendResponse.
assert(
  /return\s+true/.test(contentSrc),
  'content.js returns true for async message response handling'
);


// ===================================================================
// AC 3 — No regression in speed control functionality
//
// Core behaviors that must still be present in content.js after the
// deduplication fix.
// ===================================================================

console.log('\n--- AC 3: No regression in speed control functionality ---');

// 3a. applyToAllVideos function exists
assert(
  /function\s+applyToAllVideos|applyToAllVideos\s*=\s*(?:function|\()/.test(contentSrc),
  'content.js defines applyToAllVideos function'
);

// 3b. applyToAllVideos is called within the setSpeed handling path
// (it should be invoked when speed is set to apply to all video elements)
assert(
  /applyToAllVideos\s*\(/.test(contentSrc),
  'content.js calls applyToAllVideos (used in setSpeed handler)'
);

// 3c. Speed validation uses SPEED_MIN / SPEED_MAX constants in the listener
assert(
  /SPEED_MIN|speed_min|\w*[Mm][Ii][Nn].*[Ss]peed|[Ss]peed.*[Mm][Ii][Nn]/.test(contentSrc),
  'content.js references a MIN speed constant for validation'
);

assert(
  /SPEED_MAX|speed_max|\w*[Mm][Aa][Xx].*[Ss]peed|[Ss]peed.*[Mm][Aa][Xx]/.test(contentSrc),
  'content.js references a MAX speed constant for validation'
);

// 3d. currentPlaybackSpeed variable is updated in setSpeed handler
assert(
  /currentPlaybackSpeed\s*=/.test(contentSrc),
  'content.js updates currentPlaybackSpeed when speed is set'
);

// 3e. Storage is written when speed is set
assert(
  /chrome\.storage\.sync\.set/.test(contentSrc),
  'content.js writes to chrome.storage.sync when speed is set'
);

// 3f. MutationObserver exists for detecting dynamically added videos
assert(
  /MutationObserver/.test(contentSrc),
  'content.js uses MutationObserver for detecting dynamic video elements'
);

// 3g. ratechange listener exists to prevent page overrides of playback speed
assert(
  /ratechange/.test(contentSrc),
  'content.js listens for ratechange events to prevent page speed overrides'
);

// 3h. getSpeed handler responds with the current speed value
// The getSpeed response should include the currentPlaybackSpeed or equivalent
assert(
  /currentPlaybackSpeed/.test(contentSrc),
  'content.js references currentPlaybackSpeed (used in getSpeed response)'
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
