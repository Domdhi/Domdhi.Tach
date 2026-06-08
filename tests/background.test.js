/**
 * Unit tests for background.js — service worker.
 *
 * Story 3.3: chrome.commands.onCommand routing. The service worker maps each
 * declared command to a message and forwards it to the active tab's content
 * script (which owns stepping/clamping/persistence — ADR-001 keeps the SW thin).
 */
const { setupChromeMock } = require('./chrome-mock');

// Mock chrome BEFORE requiring background.js — it registers listeners at load.
setupChromeMock();

const {
    COMMAND_MESSAGES,
    commandToMessage,
    handleCommand,
    resolveIconAccent,
    shouldUpdateIcon,
} = require('../src/background');
const { SPEED_SLIDER_STEP, DEFAULT_SETTINGS } = require('../src/constants');

// Capture the onCommand listener background.js registered at load time, against
// the initial mock (before beforeEach swaps global.chrome).
const _onCommandCalls = global.chrome.commands.onCommand.addListener.mock.calls;
const _registeredCommandListener = _onCommandCalls.length > 0
    ? _onCommandCalls[0][0]
    : null;

// Capture the icon-repaint listeners registered at load time (same initial mock).
const _onStartupRegistered =
    global.chrome.runtime.onStartup.addListener.mock.calls.length > 0;
const _onChangedRegistered =
    global.chrome.storage.onChanged.addListener.mock.calls.length > 0;
const _onChangedListener = _onChangedRegistered
    ? global.chrome.storage.onChanged.addListener.mock.calls[0][0]
    : null;

describe('Story 3.3 — commandToMessage (command → content-script message)', () => {
    test('increase-speed → stepSpeed +0.05 (0.05 grid, matches slider + buttons)', () => {
        expect(commandToMessage('increase-speed')).toEqual({ action: 'stepSpeed', delta: 0.05 });
    });

    test('decrease-speed → stepSpeed -0.05', () => {
        expect(commandToMessage('decrease-speed')).toEqual({ action: 'stepSpeed', delta: -0.05 });
    });

    test('reset-speed → resetSpeed', () => {
        expect(commandToMessage('reset-speed')).toEqual({ action: 'resetSpeed' });
    });

    test('unknown command → null', () => {
        expect(commandToMessage('bogus')).toBeNull();
    });

    test('COMMAND_MESSAGES covers exactly the three declared commands', () => {
        expect(Object.keys(COMMAND_MESSAGES).sort()).toEqual(
            ['decrease-speed', 'increase-speed', 'reset-speed']);
    });

    test('hotkey delta stays on the shared SPEED_SLIDER_STEP grid (no silent drift)', () => {
        // background.js hardcodes ±0.05 (the SW can't import constants.js); this
        // pins it to the single source so a future change to the slider / +/-
        // grid can't leave the hotkeys stepping on a stale value.
        expect(commandToMessage('increase-speed').delta).toBe(SPEED_SLIDER_STEP);
        expect(commandToMessage('decrease-speed').delta).toBe(-SPEED_SLIDER_STEP);
    });
});

describe('Story 3.3 — handleCommand routes to the active tab', () => {
    let chrome;
    beforeEach(() => {
        chrome = setupChromeMock();
    });

    test('forwards the mapped message to the active tab', () => {
        handleCommand('increase-speed');
        expect(chrome.tabs.query).toHaveBeenCalledWith(
            { active: true, currentWindow: true }, expect.any(Function));
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
            1, { action: 'stepSpeed', delta: 0.05 }, expect.any(Function));
    });

    test('reset-speed forwards a resetSpeed message', () => {
        handleCommand('reset-speed');
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
            1, { action: 'resetSpeed' }, expect.any(Function));
    });

    test('unknown command is a no-op (does not query tabs)', () => {
        handleCommand('bogus');
        expect(chrome.tabs.query).not.toHaveBeenCalled();
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    test('no addressable active tab → no sendMessage, no throw', () => {
        chrome.tabs.query = jest.fn((q, cb) => cb([]));
        expect(() => handleCommand('increase-speed')).not.toThrow();
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    test('swallows runtime.lastError from the sendMessage callback (no throw)', () => {
        chrome.tabs.sendMessage = jest.fn((id, msg, cb) => {
            chrome.runtime.lastError = { message: 'Could not establish connection' };
            cb();
            chrome.runtime.lastError = undefined;
        });
        expect(() => handleCommand('decrease-speed')).not.toThrow();
    });
});

describe('Story 3.3 — onCommand listener registration', () => {
    test('background.js registered handleCommand as the onCommand listener', () => {
        expect(_registeredCommandListener).toBe(handleCommand);
    });
});

describe('Dynamic toolbar icon — resolveIconAccent (accent → glyph color)', () => {
    test('valid 6-digit hex passes through unchanged', () => {
        expect(resolveIconAccent('#2563eb')).toBe('#2563eb');
    });

    test('uppercase hex is accepted', () => {
        expect(resolveIconAccent('#AABBCC')).toBe('#AABBCC');
    });

    test('undefined → the default accent (mirrors DEFAULT_SETTINGS.accentColor)', () => {
        expect(resolveIconAccent(undefined)).toBe(DEFAULT_SETTINGS.accentColor);
    });

    test('invalid string (3-digit / no hash / named) → the default accent', () => {
        expect(resolveIconAccent('#fff')).toBe(DEFAULT_SETTINGS.accentColor);
        expect(resolveIconAccent('e8590c')).toBe(DEFAULT_SETTINGS.accentColor);
        expect(resolveIconAccent('red')).toBe(DEFAULT_SETTINGS.accentColor);
    });

    test('non-string (number, object, null) → the default accent', () => {
        expect(resolveIconAccent(123)).toBe(DEFAULT_SETTINGS.accentColor);
        expect(resolveIconAccent({})).toBe(DEFAULT_SETTINGS.accentColor);
        expect(resolveIconAccent(null)).toBe(DEFAULT_SETTINGS.accentColor);
    });
});

describe('Dynamic toolbar icon — shouldUpdateIcon (which storage changes repaint)', () => {
    test('sync change that includes accentColor → true', () => {
        expect(shouldUpdateIcon({ accentColor: { newValue: '#16a34a' } }, 'sync')).toBe(true);
    });

    test('sync change WITHOUT accentColor → false', () => {
        expect(shouldUpdateIcon({ defaultPlaybackSpeed: { newValue: 2 } }, 'sync')).toBe(false);
    });

    test('accentColor change in a non-sync area (local/managed) → false', () => {
        expect(shouldUpdateIcon({ accentColor: { newValue: '#16a34a' } }, 'local')).toBe(false);
        expect(shouldUpdateIcon({ accentColor: { newValue: '#16a34a' } }, 'managed')).toBe(false);
    });

    test('null / undefined changes → false (no throw)', () => {
        expect(shouldUpdateIcon(null, 'sync')).toBe(false);
        expect(shouldUpdateIcon(undefined, 'sync')).toBe(false);
    });
});

describe('Dynamic toolbar icon — listener registration', () => {
    test('background.js registered an onStartup listener (repaint on browser launch)', () => {
        expect(_onStartupRegistered).toBe(true);
    });

    test('background.js registered a storage.onChanged listener', () => {
        expect(_onChangedRegistered).toBe(true);
    });

    test('the storage.onChanged listener only acts on a sync accentColor change', () => {
        // It must not throw for any area/changes shape, and must gate on shouldUpdateIcon.
        expect(() => _onChangedListener({ foo: {} }, 'local')).not.toThrow();
        expect(() => _onChangedListener({ accentColor: {} }, 'sync')).not.toThrow();
    });
});
