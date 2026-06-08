/**
 * Integration tests — Message-Passing Contract (Story 2.4)
 *
 * SCOPE OF THE "REAL BOUNDARY" CLAIM:
 * - AC#1 (setSpeed/getSpeed handled by the content script): exercises the REAL
 *   boundary. chrome.tabs.sendMessage is routed through to the ACTUAL
 *   chrome.runtime.onMessage listener that content.js registers at module load,
 *   so these tests go red if content.js's handler regresses.
 * - AC#2 (graceful degradation when the content script is NOT injected): the AC
 *   asks for a "popup-LIKE context", so the sender is MODELED here, not imported.
 *   popup.js's send-with-retry lives inside a DOMContentLoaded closure and is not
 *   importable, so these tests assert the NFR-R1 contract against a faithful
 *   re-creation of popup.js:91-116 (storage.set → getActiveTab → tab guard →
 *   sendMessage → retry). This proves the *contract* holds for a popup-shaped
 *   sender; it canNOT catch a regression in popup.js itself.
 *   FOLLOW-UP (tracked in the Epic 2 TODO): extract popup.js's sender into an
 *   importable function so AC#2 can become load-bearing against the real code.
 *
 * Setup note:
 * content.js registers its listener and creates a MutationObserver AT MODULE
 * LOAD. The routing chrome mock and the MutationObserver stub must be assigned
 * to global BEFORE require('../src/content'). content.js is cached by Node's module
 * system after the first require, so we reset its internal state between tests
 * via the exported _setCurrentSpeed / _setInitialized setters rather than
 * re-requiring the module.
 */

'use strict';

// ============================================================
// 1. ROUTING CHROME MOCK (built here — do not edit chrome-mock.js)
// ============================================================

/**
 * Build a routing chrome mock.
 *
 * chrome.runtime.onMessage.addListener(fn) — captures fn in an array.
 * chrome.tabs.sendMessage(tabId, msg, cb)  — invokes every captured listener
 *   as listener(msg, sender, sendResponse), where sendResponse(resp) forwards
 *   resp to cb. content.js returns `true` from its handler (async-capable) but
 *   calls sendResponse synchronously, so we handle both: the response may
 *   arrive before or after sendMessage returns.
 *
 * @returns {{ chromeMock, listeners, storageData }}
 */
function buildRoutingMock() {
    const listeners = [];
    const storageData = {};

    const chromeMock = {
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
        },
        runtime: {
            // Must match chrome-mock.js so the sender-guard (sender.id !== chrome.runtime.id)
            // passes for messages routed through this mock.
            id: 'tach-test-ext',
            onMessage: {
                addListener: jest.fn((fn) => {
                    listeners.push(fn);
                }),
            },
            onInstalled: {
                addListener: jest.fn(),
            },
            getManifest: jest.fn(() => ({ version: '1.0.0' })),
            lastError: undefined,
        },
        tabs: {
            query: jest.fn((queryInfo, callback) => {
                if (callback) callback([{ id: 1 }]);
            }),
            sendMessage: jest.fn((tabId, message, callback) => {
                // Route message to every registered onMessage listener.
                // sendResponse forwards the response to the caller's callback.
                let responded = false;
                const sendResponse = (response) => {
                    responded = true;
                    if (callback) callback(response);
                };
                const sender = { id: chromeMock.runtime.id, tab: { id: tabId } };

                for (const listener of listeners) {
                    listener(message, sender, sendResponse);
                }

                // If no listener responded (e.g. handler did not fire) and a
                // callback was provided, call it with undefined so the caller
                // is not left hanging.
                if (!responded && callback) {
                    callback(undefined);
                }
            }),
        },
        // Helper — not part of the real API — to pre-seed storage for tests
        _setStorageData: (key, value) => {
            storageData[key] = value;
        },
    };

    return { chromeMock, listeners, storageData };
}

/**
 * Build a NO-LISTENER routing mock that simulates Chrome when the content
 * script is not injected into the tab.
 *
 * chrome.tabs.sendMessage calls the callback with undefined and sets
 * chrome.runtime.lastError, mirroring real Chrome behaviour.
 * The callback is responsible for reading (and thereby clearing) lastError.
 */
function buildNoListenerMock() {
    const storageData = {};
    const sendMessageMock = jest.fn((tabId, message, callback) => {
        // Simulate Chrome: set lastError, call back with undefined.
        chromeMock.runtime.lastError = {
            message: 'Could not establish connection. Receiving end does not exist.',
        };
        if (callback) {
            callback(undefined);
            // Callback is expected to read lastError; clear it afterward.
            chromeMock.runtime.lastError = undefined;
        }
    });

    const chromeMock = {
        storage: {
            sync: {
                get: jest.fn((keys, callback) => {
                    if (typeof keys === 'string') keys = [keys];
                    const result = {};
                    for (const key of (Array.isArray(keys) ? keys : [keys])) {
                        if (storageData[key] !== undefined) result[key] = storageData[key];
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
        },
        runtime: {
            onMessage: {
                addListener: jest.fn(),
            },
            onInstalled: {
                addListener: jest.fn(),
            },
            getManifest: jest.fn(() => ({ version: '1.0.0' })),
            lastError: undefined,
        },
        tabs: {
            query: jest.fn((queryInfo, callback) => {
                if (callback) callback([{ id: 1 }]);
            }),
            sendMessage: sendMessageMock,
        },
    };

    return chromeMock;
}

// ============================================================
// 2. JSDOM / MODULE SETUP
// ============================================================

// MutationObserver stub — must exist before content.js is required.
global.MutationObserver = class {
    constructor(cb) { this._cb = cb; }
    observe() {}
    disconnect() {}
};

// Install the ROUTING mock as global.chrome before requiring content.js.
// content.js reads global.chrome at module load to register its listener.
const { chromeMock: routingChrome, storageData: routingStorage } = buildRoutingMock();
global.chrome = routingChrome;

// Now require content.js — this registers the onMessage listener.
//
// INVARIANT (relied on by AC#1 assertions): content.js captured `global.chrome`
// === `routingChrome` at this require. Its handler closes over THAT object, so
// when AC#1 inspects `routingChrome.storage.sync.set`, it inspects the same
// object content.js writes to — even though AC#2 below temporarily swaps
// `global.chrome` to a no-listener mock and restores it in afterEach. The
// content listener never sees the swap (it holds its own reference), so the
// swap cannot leak into AC#1.
const {
    SPEED_MIN,
    SPEED_MAX,
    _getCurrentSpeed,
    _setCurrentSpeed,
    _setInitialized,
} = require('../src/content');

// ============================================================
// 3. HELPERS
// ============================================================

/** Create a minimal mock <video> element with readyState > 0 so content.js
 *  will actually write playbackRate to it. */
function createMockVideo(readyState = 1) {
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { value: readyState, writable: true });
    video.playbackRate = 1.0;
    return video;
}

// ============================================================
// 4. AC#1 — setSpeed message routed through the real listener
// ============================================================

describe('AC#1 — setSpeed message routes through the real content listener', () => {
    beforeEach(() => {
        // Reset content.js internal state between tests. _setInitialized(true)
        // makes the "initializeSpeed did not run during routing" assumption
        // explicit: if a future change wired initializeSpeed() into the routing
        // path, the seeded storage could feed currentPlaybackSpeed and make the
        // "speed == 2.0 after routing" assertion pass for the wrong reason.
        _setCurrentSpeed(1.0);
        _setInitialized(true);

        // Clear per-test storage entries.
        delete routingStorage.defaultPlaybackSpeed;

        // Reset mock call history so call counts are per-test.
        routingChrome.storage.sync.set.mockClear();
        routingChrome.tabs.sendMessage.mockClear();

        // Clear DOM videos.
        document.body.innerHTML = '';
    });

    test('happy path: callback receives {success:true} for a valid speed', (done) => {
        chrome.tabs.sendMessage(1, { action: 'setSpeed', speed: 2.0 }, (response) => {
            expect(response).toBeDefined();
            expect(response.success).toBe(true);
            done();
        });
    });

    test('happy path: _getCurrentSpeed() reflects the new speed after routing', (done) => {
        chrome.tabs.sendMessage(1, { action: 'setSpeed', speed: 2.0 }, () => {
            expect(_getCurrentSpeed()).toBe(2.0);
            done();
        });
    });

    test('happy path: video.playbackRate is updated when a ready video is present', (done) => {
        const video = createMockVideo(1); // readyState 1 → content.js writes playbackRate
        document.body.appendChild(video);

        chrome.tabs.sendMessage(1, { action: 'setSpeed', speed: 2.0 }, () => {
            expect(video.playbackRate).toBe(2.0);
            done();
        });
    });

    test('happy path: a REMEMBERED site persists to perSiteSpeeds (default is options-owned)', (done) => {
        // The default is set only in options; setSpeed persists ONLY when the
        // current domain (jsdom: localhost) has a per-site entry.
        routingChrome._setStorageData('perSiteSpeeds', { localhost: 1.0 });
        chrome.tabs.sendMessage(1, { action: 'setSpeed', speed: 2.0 }, () => {
            expect(routingChrome.storage.sync.set).toHaveBeenCalledWith(
                expect.objectContaining({ perSiteSpeeds: expect.objectContaining({ localhost: 2.0 }) })
            );
            done();
        });
    });

    test('out-of-range speed (below minimum): callback receives {success:false}', (done) => {
        // Derive from the real constant so the test tracks SPEED_MIN changes.
        chrome.tabs.sendMessage(1, { action: 'setSpeed', speed: SPEED_MIN - 0.1 }, (response) => {
            expect(response).toBeDefined();
            expect(response.success).toBe(false);
            done();
        });
    });

    test('out-of-range speed (above maximum): callback receives {success:false}', (done) => {
        chrome.tabs.sendMessage(1, { action: 'setSpeed', speed: SPEED_MAX + 1 }, (response) => {
            expect(response).toBeDefined();
            expect(response.success).toBe(false);
            done();
        });
    });

    test('NaN speed: callback receives {success:false}', (done) => {
        chrome.tabs.sendMessage(1, { action: 'setSpeed', speed: NaN }, (response) => {
            expect(response).toBeDefined();
            expect(response.success).toBe(false);
            done();
        });
    });

    test('getSpeed: callback receives {speed: <current>} documenting the full contract', (done) => {
        _setCurrentSpeed(3.0);
        chrome.tabs.sendMessage(1, { action: 'getSpeed' }, (response) => {
            expect(response).toBeDefined();
            expect(response.speed).toBe(3.0);
            done();
        });
    });
});

// ============================================================
// 5. AC#2 — graceful degradation when content script is not injected
// ============================================================

/**
 * FAITHFUL re-creation of popup.js setVideoSpeed()'s send path (popup.js:91-116).
 *
 * It is NOT a minimal copy — it preserves the exact structure that governs the
 * NFR-R1 retry, so the test fails if that contract's shape is wrong:
 *   storage.sync.set(...) -> getActiveTab() -> `if (tab && tab.id)` guard ->
 *   sendMessage(cb) -> on falsy/failed response, setTimeout(retry, 500).
 * Faithfulness notes matching the real popup:
 *   - the guard means NO active tab (getActiveTab -> null) sends nothing and
 *     retries nothing (the real degradation path), and
 *   - popup.js does NOT read chrome.runtime.lastError; it decides to retry purely
 *     from `!response || !response.success`, so this model does the same.
 * The sender is parameterized on `chromeApi` so it can be pointed at a
 * no-listener mock (content script not injected) or a no-active-tab mock.
 * It returns a promise that resolves once the INITIAL send is dispatched (or
 * skipped), so tests can await it before advancing fake timers.
 */
function getActiveTab(chromeApi) {
    return new Promise((resolve) => {
        chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0] || null));
    });
}

function popupLikeSend(chromeApi, speed) {
    return new Promise((resolve) => {
        chromeApi.storage.sync.set({ defaultPlaybackSpeed: speed }, () => {
            getActiveTab(chromeApi).then((tab) => {
                if (tab && tab.id) {
                    chromeApi.tabs.sendMessage(tab.id, { action: 'setSpeed', speed }, (response) => {
                        if (!response || !response.success) {
                            setTimeout(() => {
                                chromeApi.tabs.sendMessage(tab.id, { action: 'setSpeed', speed });
                            }, 500);
                        }
                    });
                }
                resolve(tab);
            });
        });
    });
}

describe('AC#2 — graceful degradation when content script is not injected', () => {
    let noListenerChrome;

    beforeEach(() => {
        jest.useFakeTimers();
        // buildNoListenerMock: tabs.query returns an active tab, but sendMessage
        // finds no receiver -> callback(undefined) + lastError set.
        noListenerChrome = buildNoListenerMock();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('sending when the content script is not injected does not throw', async () => {
        await expect(popupLikeSend(noListenerChrome, 2.0)).resolves.toBeDefined();
        // The retry is also exception-free.
        expect(() => jest.advanceTimersByTime(500)).not.toThrow();
    });

    test('a retry is attempted once after 500 ms (NFR-R1)', async () => {
        await popupLikeSend(noListenerChrome, 2.0);

        // After the initial send only: one call, no retry yet.
        expect(noListenerChrome.tabs.sendMessage).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(500);

        // Retry fired exactly once.
        expect(noListenerChrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
    });

    test('initial and retry sends target the same tab id and carry the same message', async () => {
        await popupLikeSend(noListenerChrome, 2.0);
        jest.advanceTimersByTime(500);

        const calls = noListenerChrome.tabs.sendMessage.mock.calls;
        expect(calls).toHaveLength(2);
        expect(calls[0][0]).toBe(1); // tabId
        expect(calls[0][1]).toEqual({ action: 'setSpeed', speed: 2.0 });
        expect(calls[1][0]).toBe(1);
        expect(calls[1][1]).toEqual({ action: 'setSpeed', speed: 2.0 });
    });

    test('no active tab (getActiveTab -> null): sends nothing, schedules no retry, does not throw', async () => {
        // The real degradation path popup.js guards with `if (tab && tab.id)`:
        // when there is no active tab, nothing is sent and nothing is retried.
        const noTabChrome = buildNoListenerMock();
        noTabChrome.tabs.query = jest.fn((queryInfo, callback) => callback([]));

        await expect(popupLikeSend(noTabChrome, 2.0)).resolves.toBeNull();
        expect(noTabChrome.tabs.sendMessage).not.toHaveBeenCalled();
        expect(() => jest.advanceTimersByTime(500)).not.toThrow();
        expect(noTabChrome.tabs.sendMessage).not.toHaveBeenCalled();
    });
});
