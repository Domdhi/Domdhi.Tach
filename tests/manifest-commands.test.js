/**
 * Tests for Story 3.2: Declare `commands` in the Manifest (FR-10)
 *
 * Acceptance Criteria covered here:
 *   AC 1 — manifest.json declares increase-speed, decrease-speed, reset-speed
 *          with suggested keys.
 *   AC 3 — (justification doc) is verified separately in _project-context.md.
 *   AC 2 — chrome://extensions/shortcuts appearance is manual / not unit-testable.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'src', 'manifest.json'), 'utf8')
);

const EXPECTED_COMMANDS = ['increase-speed', 'decrease-speed', 'reset-speed'];

describe('manifest commands (Story 3.2)', () => {
  test('manifest declares a commands object', () => {
    expect(manifest.commands).toBeDefined();
    expect(typeof manifest.commands).toBe('object');
  });

  test('declares exactly the three expected commands', () => {
    expect(Object.keys(manifest.commands).sort()).toEqual(
      [...EXPECTED_COMMANDS].sort()
    );
  });

  test.each(EXPECTED_COMMANDS)('command "%s" has a description and a default suggested key', (cmd) => {
    const entry = manifest.commands[cmd];
    expect(entry).toBeDefined();
    expect(typeof entry.description).toBe('string');
    expect(entry.description.length).toBeGreaterThan(0);
    expect(entry.suggested_key).toBeDefined();
    expect(typeof entry.suggested_key.default).toBe('string');
    expect(entry.suggested_key.default.length).toBeGreaterThan(0);
  });

  test('suggested keys avoid the reserved Ctrl+Shift+{R,N,T,W} Chrome shortcuts', () => {
    const reserved = ['Ctrl+Shift+R', 'Ctrl+Shift+N', 'Ctrl+Shift+T', 'Ctrl+Shift+W'];
    for (const cmd of EXPECTED_COMMANDS) {
      expect(reserved).not.toContain(manifest.commands[cmd].suggested_key.default);
    }
  });

  // Story 3.3 — guard the manifest↔service-worker wiring. Renaming a command in
  // manifest.json (or in background.js's COMMAND_MESSAGES) without updating the
  // other would silently break the hotkey in production while each file's own
  // test still passes. Assert the two key sets are identical.
  test('manifest commands match background.js COMMAND_MESSAGES keys exactly', () => {
    // background.js registers chrome listeners at load — mock chrome first.
    require('./chrome-mock').setupChromeMock();
    const { COMMAND_MESSAGES } = require('../src/background');
    expect(Object.keys(COMMAND_MESSAGES).sort()).toEqual(
      Object.keys(manifest.commands).sort()
    );
  });
});
