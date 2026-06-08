/**
 * Mock for Chrome Extension APIs used across all test files.
 *
 * Call setupChromeMock() in beforeEach to get a fresh mock.
 * The returned object is also assigned to global.chrome.
 */
function setupChromeMock() {
    const storageData = {};

    const chrome = {
        storage: {
            sync: {
                get: jest.fn((keys, callback) => {
                    if (typeof keys === 'string') keys = [keys];
                    const result = {};
                    for (const key of keys) {
                        if (storageData[key] !== undefined) {
                            result[key] = storageData[key];
                        }
                    }
                    if (callback) callback(result);
                    return Promise.resolve(result);
                }),
                set: jest.fn((items, callback) => {
                    Object.assign(storageData, items);
                    if (callback) callback();
                    return Promise.resolve();
                }),
            },
            // Fired on any storage write; background.js listens to repaint the
            // toolbar icon when accentColor changes.
            onChanged: {
                addListener: jest.fn(),
            },
        },
        runtime: {
            // Stable id used by the sender-guard in content.js and content-youtube.js
            // (`sender.id !== chrome.runtime.id`). Without this the guard reads
            // `undefined !== undefined` = false and never rejects foreign senders.
            id: 'tach-test-ext',
            onMessage: {
                addListener: jest.fn(),
            },
            onInstalled: {
                addListener: jest.fn(),
            },
            // Fired when the browser starts and the SW spins back up; background.js
            // listens to repaint the accent-colored icon.
            onStartup: {
                addListener: jest.fn(),
            },
            getManifest: jest.fn(() => ({ version: '1.0.0' })),
            // Real API: undefined when the last call succeeded. Background's
            // command router reads this to swallow "no receiving end" errors.
            lastError: undefined,
        },
        // Story 3.3 — chrome.commands global keyboard shortcuts.
        commands: {
            onCommand: {
                addListener: jest.fn(),
            },
        },
        tabs: {
            query: jest.fn((queryInfo, callback) => {
                if (callback) callback([{ id: 1 }]);
            }),
            sendMessage: jest.fn((tabId, message, callback) => {
                if (callback) callback({ success: true });
            }),
        },
        // chrome.action — toolbar button. setIcon repaints the icon; needs no
        // extra permission beyond the declared "action".
        action: {
            setIcon: jest.fn((details, callback) => {
                if (callback) callback();
            }),
        },
        // Helper — not part of the real API — to pre-seed storage for tests
        _setStorageData: (key, value) => {
            storageData[key] = value;
        },
    };

    global.chrome = chrome;
    return chrome;
}

module.exports = { setupChromeMock };
