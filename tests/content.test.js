/**
 * Unit tests for content.js — core speed logic
 */
const { setupChromeMock } = require('./chrome-mock');

// We need to set up chrome mock BEFORE requiring content.js because
// content.js runs initialization code at module load time.
setupChromeMock();

// content.js also calls document.getElementsByTagName and MutationObserver at load time
// jsdom provides document, but we need MutationObserver:
global.MutationObserver = class {
    constructor(callback) { this._callback = callback; }
    observe() {}
    disconnect() {}
};

const {
    SPEED_MIN,
    SPEED_MAX,
    setVideoSpeed,
    applyCurrentSpeed,
    applyToAllVideos,
    setupVideoRateChangeListener,
    _getCurrentSpeed,
    _setCurrentSpeed,
    _setInitialized,
    initializeSpeed,
    // Story 3.1 — shared settings schema
    DEFAULT_SETTINGS,
    MAX_PER_SITE_ENTRIES,
    resolveSettings,
    getSettings,
    capPerSiteSpeeds,
    // Story 3.5 — per-site speed resolution
    getRegistrableDomain,
    resolveSpeedForSite,
} = require('../src/content');

// Capture the message handler that content.js registered at load time.
// Must happen BEFORE any setupChromeMock() call replaces global.chrome.
const _initialAddListenerCalls = chrome.runtime.onMessage.addListener.mock.calls;
const _messageHandler = _initialAddListenerCalls.length > 0
    ? _initialAddListenerCalls[0][0]
    : null;

// ---- Helpers ----

/** Create a minimal mock <video> element. */
function createMockVideo(readyState = 1) {
    const video = document.createElement('video');
    // readyState is read-only on real elements; override via defineProperty
    Object.defineProperty(video, 'readyState', { value: readyState, writable: true });
    video.playbackRate = 1.0;
    return video;
}

// ---- Tests ----

describe('Speed range constants', () => {
    test('SPEED_MIN equals 0.01', () => {
        expect(SPEED_MIN).toBe(0.01);
    });

    test('SPEED_MAX equals 4.0', () => {
        expect(SPEED_MAX).toBe(4.0);
    });
});

describe('setVideoSpeed', () => {
    beforeEach(() => {
        _setCurrentSpeed(1.0);
    });

    test('applies a valid speed to a video element', () => {
        const video = createMockVideo();
        const result = setVideoSpeed(video, 2.0);

        expect(result).toBe(true);
        expect(video.playbackRate).toBe(2.0);
        expect(_getCurrentSpeed()).toBe(2.0);
    });

    test('accepts SPEED_MIN boundary', () => {
        const video = createMockVideo();
        expect(setVideoSpeed(video, SPEED_MIN)).toBe(true);
        expect(video.playbackRate).toBe(SPEED_MIN);
    });

    test('accepts SPEED_MAX boundary', () => {
        const video = createMockVideo();
        expect(setVideoSpeed(video, SPEED_MAX)).toBe(true);
        expect(video.playbackRate).toBe(SPEED_MAX);
    });

    test('rejects speed below SPEED_MIN', () => {
        const video = createMockVideo();
        const result = setVideoSpeed(video, 0.005); // below the 0.01 floor

        expect(result).toBe(false);
        expect(video.playbackRate).toBe(1.0); // unchanged
        expect(_getCurrentSpeed()).toBe(1.0);
    });

    test('rejects speed above SPEED_MAX', () => {
        const video = createMockVideo();
        const result = setVideoSpeed(video, 5.0);

        expect(result).toBe(false);
        expect(video.playbackRate).toBe(1.0); // unchanged
        expect(_getCurrentSpeed()).toBe(1.0);
    });

    test('rejects NaN speed', () => {
        const video = createMockVideo();
        expect(setVideoSpeed(video, NaN)).toBe(false);
    });

    test('rejects non-numeric string', () => {
        const video = createMockVideo();
        expect(setVideoSpeed(video, 'fast')).toBe(false);
    });

    test('accepts numeric string', () => {
        const video = createMockVideo();
        expect(setVideoSpeed(video, '1.75')).toBe(true);
        expect(video.playbackRate).toBe(1.75);
    });

    test('returns false when video is null', () => {
        expect(setVideoSpeed(null, 1.5)).toBe(false);
    });

    test('does not set playbackRate when readyState is 0', () => {
        const video = createMockVideo(0);
        const result = setVideoSpeed(video, 2.0);

        expect(result).toBe(true); // function returns true — speed is valid
        expect(video.playbackRate).toBe(1.0); // but playbackRate not set yet
        expect(_getCurrentSpeed()).toBe(2.0); // internal state updated
    });

    test('adds vsc-speed-adjusted class on ready video', () => {
        const video = createMockVideo();
        setVideoSpeed(video, 1.5);
        expect(video.classList.contains('vsc-speed-adjusted')).toBe(true);
    });

    test('rejects zero speed', () => {
        const video = createMockVideo();
        expect(setVideoSpeed(video, 0)).toBe(false);
    });

    test('rejects negative speed', () => {
        const video = createMockVideo();
        expect(setVideoSpeed(video, -1)).toBe(false);
    });

    test('rejects speed of 16.0 (far above maximum)', () => {
        const video = createMockVideo();
        expect(setVideoSpeed(video, 16.0)).toBe(false);
    });

    test('returns false when video is undefined', () => {
        expect(setVideoSpeed(undefined, 1.5)).toBe(false);
    });

    test('rejects null speed value', () => {
        const video = createMockVideo();
        expect(setVideoSpeed(video, null)).toBe(false);
    });

    test('rejects undefined speed value', () => {
        const video = createMockVideo();
        expect(setVideoSpeed(video, undefined)).toBe(false);
    });
});

describe('applyCurrentSpeed', () => {
    beforeEach(() => {
        _setCurrentSpeed(2.0);
    });

    test('applies current speed to a ready video', () => {
        const video = createMockVideo(1);
        video.playbackRate = 1.0;

        applyCurrentSpeed(video);

        expect(video.playbackRate).toBe(2.0);
    });

    test('returns false for null video', () => {
        expect(applyCurrentSpeed(null)).toBe(false);
    });

    test('returns true for valid video (even if not ready)', () => {
        const video = createMockVideo(0);
        expect(applyCurrentSpeed(video)).toBe(true);
    });

    test('does not change playbackRate if already matching', () => {
        const video = createMockVideo(1);
        video.playbackRate = 2.0;

        // playbackRate already matches currentPlaybackSpeed (2.0)
        applyCurrentSpeed(video);
        // Should still be 2.0 (no-op)
        expect(video.playbackRate).toBe(2.0);
    });
});

describe('applyToAllVideos', () => {
    beforeEach(() => {
        _setCurrentSpeed(1.5);
        // Clear any videos from previous tests
        document.body.innerHTML = '';
    });

    test('applies speed to all video elements on the page', () => {
        const v1 = createMockVideo();
        const v2 = createMockVideo();
        document.body.appendChild(v1);
        document.body.appendChild(v2);

        applyToAllVideos();

        expect(v1.playbackRate).toBe(1.5);
        expect(v2.playbackRate).toBe(1.5);
    });

    test('returns true when no videos on the page', () => {
        expect(applyToAllVideos()).toBe(true);
    });
});

describe('initializeSpeed', () => {
    beforeEach(() => {
        setupChromeMock();
        _setCurrentSpeed(1.0);
        _setInitialized(false);
    });

    test('loads speed from chrome.storage.sync', () => {
        chrome._setStorageData('defaultPlaybackSpeed', 2.5);
        initializeSpeed();

        expect(chrome.storage.sync.get).toHaveBeenCalled();
        // The callback runs synchronously in our mock
        expect(_getCurrentSpeed()).toBe(2.5);
    });

    test('ignores invalid saved speed', () => {
        chrome._setStorageData('defaultPlaybackSpeed', 99);
        initializeSpeed();

        // 99 is out of range — speed should remain at 1.0
        expect(_getCurrentSpeed()).toBe(1.0);
    });

    test('does not re-initialize when already initialized', () => {
        _setInitialized(true);
        chrome._setStorageData('defaultPlaybackSpeed', 3.0);
        initializeSpeed();

        // Should not have read storage
        expect(_getCurrentSpeed()).toBe(1.0);
    });
});

// ===================================================================
// Message handler behavior (from architecture spec)
//
// The onMessage listener was registered when content.js was required.
// We extract it from the mock's call history.
// ===================================================================

describe('Message handler — setSpeed', () => {
    const messageHandler = _messageHandler;

    beforeAll(() => {
        expect(messageHandler).not.toBeNull();
        expect(typeof messageHandler).toBe('function');
    });

    beforeEach(() => {
        setupChromeMock();
        _setCurrentSpeed(1.0);
    });

    test('should return {success: true} for valid speed', (done) => {
        messageHandler(
            { action: 'setSpeed', speed: 2.0 },
            { id: 'tach-test-ext', tab: { id: 1 } },
            (response) => {
                expect(response).toBeDefined();
                expect(response.success).toBe(true);
                done();
            }
        );
    });

    test('should return {success: false} for speed below range (0.005)', (done) => {
        messageHandler(
            { action: 'setSpeed', speed: 0.005 }, // below the 0.01 floor
            { id: 'tach-test-ext', tab: { id: 1 } },
            (response) => {
                expect(response).toBeDefined();
                expect(response.success).toBe(false);
                done();
            }
        );
    });

    test('should return {success: false} for speed above range (10.0)', (done) => {
        messageHandler(
            { action: 'setSpeed', speed: 10.0 },
            { id: 'tach-test-ext', tab: { id: 1 } },
            (response) => {
                expect(response).toBeDefined();
                expect(response.success).toBe(false);
                done();
            }
        );
    });

    test('should return {success: false} for NaN speed string', (done) => {
        messageHandler(
            { action: 'setSpeed', speed: 'notanumber' },
            { id: 'tach-test-ext', tab: { id: 1 } },
            (response) => {
                expect(response).toBeDefined();
                expect(response.success).toBe(false);
                done();
            }
        );
    });

    test('valid setSpeed on an un-remembered site applies but does NOT write the default', (done) => {
        // The global default is options-owned: a speed change on a site without a
        // per-site preset applies live but persists nothing (reverts on reload).
        messageHandler(
            { action: 'setSpeed', speed: 1.75 },
            { id: 'tach-test-ext', tab: { id: 1 } },
            (response) => {
                expect(response.success).toBe(true);
                expect(chrome.storage.sync.set).not.toHaveBeenCalled();
                done();
            }
        );
    });

    test('should update currentPlaybackSpeed on valid setSpeed', (done) => {
        messageHandler(
            { action: 'setSpeed', speed: 3.0 },
            { id: 'tach-test-ext', tab: { id: 1 } },
            () => {
                expect(_getCurrentSpeed()).toBe(3.0);
                done();
            }
        );
    });

    test('should NOT update currentPlaybackSpeed on invalid setSpeed', (done) => {
        messageHandler(
            { action: 'setSpeed', speed: -5 },
            { id: 'tach-test-ext', tab: { id: 1 } },
            () => {
                expect(_getCurrentSpeed()).toBe(1.0);
                done();
            }
        );
    });

    test('should return true (keep channel open) for setSpeed action', () => {
        const result = messageHandler(
            { action: 'setSpeed', speed: 2.0 },
            { id: 'tach-test-ext', tab: { id: 1 } },
            () => {}
        );
        expect(result).toBe(true);
    });

    test('sender-guard: rejects a foreign sender and does not call sendResponse', () => {
        // Fix 1 — sender.id !== chrome.runtime.id must reject non-extension senders.
        const sendResponse = jest.fn();
        const result = messageHandler(
            { action: 'setSpeed', speed: 2.0 },
            { id: 'someone-else' },
            sendResponse
        );
        expect(sendResponse).not.toHaveBeenCalled();
        expect(result).toBeFalsy();
        // Speed must not have changed — the handler took no action.
        expect(_getCurrentSpeed()).toBe(1.0);
    });
});

describe('Message handler — getSpeed', () => {
    const messageHandler = _messageHandler;

    beforeAll(() => {
        expect(messageHandler).not.toBeNull();
        expect(typeof messageHandler).toBe('function');
    });

    beforeEach(() => {
        setupChromeMock();
        _setCurrentSpeed(1.0);
    });

    test('should return an object with a numeric speed property', (done) => {
        messageHandler(
            { action: 'getSpeed' },
            { id: 'tach-test-ext', tab: { id: 1 } },
            (response) => {
                expect(response).toBeDefined();
                expect(typeof response.speed).toBe('number');
                done();
            }
        );
    });

    test('should return the current playback speed', (done) => {
        _setCurrentSpeed(2.5);
        messageHandler(
            { action: 'getSpeed' },
            { id: 'tach-test-ext', tab: { id: 1 } },
            (response) => {
                expect(response.speed).toBe(2.5);
                done();
            }
        );
    });

    test('should return default speed (1.0) when no speed has been set', (done) => {
        messageHandler(
            { action: 'getSpeed' },
            { id: 'tach-test-ext', tab: { id: 1 } },
            (response) => {
                expect(response.speed).toBe(1.0);
                done();
            }
        );
    });

    test('should return true (keep channel open) for getSpeed action', () => {
        const result = messageHandler(
            { action: 'getSpeed' },
            { id: 'tach-test-ext', tab: { id: 1 } },
            () => {}
        );
        expect(result).toBe(true);
    });
});

// ===================================================================
// Sweep finding D2 — setSpeed (manual popup change) persists per-site-aware
//
// The setSpeed handler now routes persistence through persistHotkeySpeed, so a
// manual speed change on a "remembered" domain updates perSiteSpeeds[domain]
// (matching the hotkey path) instead of the global default. jsdom domain is
// 'localhost'.
// ===================================================================

describe('Story D2 — setSpeed persists per-site-aware', () => {
    const messageHandler = _messageHandler;

    beforeEach(() => {
        setupChromeMock();
        _setCurrentSpeed(1.0);
        document.body.innerHTML = '';
        document.body.appendChild(createMockVideo());
    });

    function wroteKey(key) {
        return chrome.storage.sync.set.mock.calls.some(
            ([arg]) => Object.prototype.hasOwnProperty.call(arg, key));
    }

    test('domain WITH a per-site preset → setSpeed updates perSiteSpeeds[domain], not global', (done) => {
        chrome._setStorageData('perSiteSpeeds', { localhost: 2.0 });
        messageHandler({ action: 'setSpeed', speed: 2.5 }, { id: 'tach-test-ext', tab: { id: 1 } }, () => {
            expect(chrome.storage.sync.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    perSiteSpeeds: expect.objectContaining({ localhost: 2.5 }),
                }));
            expect(wroteKey('defaultPlaybackSpeed')).toBe(false);
            done();
        });
    });

    test('domain WITHOUT a per-site preset → setSpeed writes NOTHING (default is options-owned)', (done) => {
        messageHandler({ action: 'setSpeed', speed: 1.75 }, { id: 'tach-test-ext', tab: { id: 1 } }, () => {
            expect(wroteKey('defaultPlaybackSpeed')).toBe(false);
            expect(wroteKey('perSiteSpeeds')).toBe(false);
            done();
        });
    });

    // Sweep finding (260606-1750): the popup's live per-tick slider/+/- updates
    // send persist:false so they apply WITHOUT writing storage — the popup owns
    // the single debounced write. Without this, a drag fires one sync write per
    // message and blows the ~120/min quota.
    test('setSpeed with persist:false applies the speed but writes NOTHING', (done) => {
        messageHandler({ action: 'setSpeed', speed: 2.25, persist: false }, { id: 'tach-test-ext', tab: { id: 1 } }, (resp) => {
            expect(resp.success).toBe(true);
            expect(_getCurrentSpeed()).toBe(2.25); // applied in-memory
            expect(chrome.storage.sync.set).not.toHaveBeenCalled(); // but NOT persisted
            done();
        });
    });

    test('setSpeed without a persist flag still persists on a REMEMBERED site (back-compat)', (done) => {
        chrome._setStorageData('perSiteSpeeds', { localhost: 1.0 });
        messageHandler({ action: 'setSpeed', speed: 1.6 }, { id: 'tach-test-ext', tab: { id: 1 } }, () => {
            expect(chrome.storage.sync.set).toHaveBeenCalledWith(
                expect.objectContaining({ perSiteSpeeds: expect.objectContaining({ localhost: 1.6 }) }));
            done();
        });
    });
});

// ===================================================================
// Story 3.3 — Hotkey command handling (stepSpeed / resetSpeed)
//
// background.js routes chrome.commands events to the active tab as
// { action: 'stepSpeed', delta } or { action: 'resetSpeed' }. The content
// script steps (±0.25, clamped), or resets to 1.0x, persists to the global
// defaultPlaybackSpeed, and no-ops silently when no <video> is present.
// ===================================================================

describe('Story 3.3 — Message handler: stepSpeed / resetSpeed', () => {
    const messageHandler = _messageHandler;

    beforeEach(() => {
        setupChromeMock();
        _setCurrentSpeed(1.0);
        document.body.innerHTML = '';
    });

    function addVideo() {
        const v = createMockVideo();
        document.body.appendChild(v);
        return v;
    }

    test('stepSpeed +0.1 increases current speed and applies it', (done) => {
        const v = addVideo();
        _setCurrentSpeed(1.0);
        messageHandler({ action: 'stepSpeed', delta: 0.1 }, { id: 'tach-test-ext', tab: { id: 1 } }, (resp) => {
            expect(resp.success).toBe(true);
            expect(resp.speed).toBe(1.1);
            expect(_getCurrentSpeed()).toBe(1.1);
            expect(v.playbackRate).toBe(1.1);
            done();
        });
    });

    test('stepSpeed -0.1 decreases current speed', (done) => {
        addVideo();
        _setCurrentSpeed(1.5);
        messageHandler({ action: 'stepSpeed', delta: -0.1 }, { id: 'tach-test-ext', tab: { id: 1 } }, (resp) => {
            expect(resp.speed).toBe(1.4);
            done();
        });
    });

    test('stepSpeed clamps at SPEED_MAX', (done) => {
        addVideo();
        _setCurrentSpeed(SPEED_MAX);
        messageHandler({ action: 'stepSpeed', delta: 0.25 }, { id: 'tach-test-ext', tab: { id: 1 } }, (resp) => {
            expect(resp.speed).toBe(SPEED_MAX);
            done();
        });
    });

    test('stepSpeed clamps at SPEED_MIN', (done) => {
        addVideo();
        _setCurrentSpeed(SPEED_MIN);
        messageHandler({ action: 'stepSpeed', delta: -0.25 }, { id: 'tach-test-ext', tab: { id: 1 } }, (resp) => {
            expect(resp.speed).toBe(SPEED_MIN);
            done();
        });
    });

    test('resetSpeed sets speed to 1.0x', (done) => {
        addVideo();
        _setCurrentSpeed(2.5);
        messageHandler({ action: 'resetSpeed' }, { id: 'tach-test-ext', tab: { id: 1 } }, (resp) => {
            expect(resp.success).toBe(true);
            expect(resp.speed).toBe(1.0);
            expect(_getCurrentSpeed()).toBe(1.0);
            done();
        });
    });

    test('stepSpeed on an un-remembered site applies live but does NOT persist the default', (done) => {
        const v = addVideo();
        _setCurrentSpeed(1.0);
        messageHandler({ action: 'stepSpeed', delta: 0.1 }, { id: 'tach-test-ext', tab: { id: 1 } }, (resp) => {
            expect(resp.success).toBe(true);
            expect(v.playbackRate).toBe(1.1); // applied live
            expect(chrome.storage.sync.set).not.toHaveBeenCalledWith(
                expect.objectContaining({ defaultPlaybackSpeed: expect.anything() }));
            done();
        });
    });

    test('stepSpeed no-ops silently when no <video> is present', (done) => {
        _setCurrentSpeed(1.0);
        messageHandler({ action: 'stepSpeed', delta: 0.25 }, { id: 'tach-test-ext', tab: { id: 1 } }, (resp) => {
            expect(resp.success).toBe(false);
            expect(_getCurrentSpeed()).toBe(1.0);
            expect(chrome.storage.sync.set).not.toHaveBeenCalled();
            done();
        });
    });

    test('resetSpeed no-ops silently when no <video> is present', (done) => {
        _setCurrentSpeed(2.0);
        messageHandler({ action: 'resetSpeed' }, { id: 'tach-test-ext', tab: { id: 1 } }, (resp) => {
            expect(resp.success).toBe(false);
            expect(_getCurrentSpeed()).toBe(2.0);
            expect(chrome.storage.sync.set).not.toHaveBeenCalled();
            done();
        });
    });

    test('stepSpeed returns true (keeps the message channel open)', () => {
        addVideo();
        const result = messageHandler({ action: 'stepSpeed', delta: 0.25 }, { id: 'tach-test-ext', tab: { id: 1 } }, () => {});
        expect(result).toBe(true);
    });

    test('resetSpeed returns true (keeps the message channel open)', () => {
        addVideo();
        const result = messageHandler({ action: 'resetSpeed' }, { id: 'tach-test-ext', tab: { id: 1 } }, () => {});
        expect(result).toBe(true);
    });
});

// ---- Story 0.5: Harden rate-change protection edge cases ----

describe('setupVideoRateChangeListener — rate-change protection', () => {
    beforeEach(() => {
        setupChromeMock();
        _setCurrentSpeed(1.0);
    });

    // AC1 — re-apply on ratechange
    test('re-applies the user speed when the page resets playbackRate', () => {
        _setCurrentSpeed(2.0);
        const video = createMockVideo(1);
        setupVideoRateChangeListener(video);

        // Page forces playbackRate back to 1.0, then notifies via ratechange.
        video.playbackRate = 1.0;
        video.dispatchEvent(new Event('ratechange'));

        expect(video.playbackRate).toBe(2.0);
    });

    test('does not fight a ratechange that already matches the chosen speed', () => {
        _setCurrentSpeed(2.0);
        const video = createMockVideo(1);
        video.playbackRate = 2.0;
        setupVideoRateChangeListener(video);

        let writes = 0;
        const realRate = video.playbackRate;
        Object.defineProperty(video, 'playbackRate', {
            get: () => realRate,
            set: () => { writes += 1; },
            configurable: true,
        });

        video.dispatchEvent(new Event('ratechange'));
        expect(writes).toBe(0); // no re-apply when already in sync
    });

    test('registers only one ratechange listener per video (idempotent)', () => {
        const video = createMockVideo(1);
        const addSpy = jest.spyOn(video, 'addEventListener');
        setupVideoRateChangeListener(video);
        setupVideoRateChangeListener(video); // second call should be a no-op
        const rateChangeRegistrations = addSpy.mock.calls.filter(
            (c) => c[0] === 'ratechange'
        ).length;
        expect(rateChangeRegistrations).toBe(1);
    });

    // AC2 — rapid burst does not enter an infinite re-apply loop (guarded)
    test('a synchronous burst of ratechange events re-applies at most once (re-entrancy guard)', () => {
        _setCurrentSpeed(2.0);
        const video = createMockVideo(1);

        // Note: jsdom does NOT emit a 'ratechange' when playbackRate is assigned,
        // so we simulate the in-browser self-trigger by dispatching events manually
        // and counting writes. Simulate a hostile page that pins playbackRate at
        // 1.0: the getter always reports 1.0 (so every event looks divergent).
        const writes = [];
        Object.defineProperty(video, 'playbackRate', {
            get: () => 1.0,
            set: (v) => { writes.push(v); },
            configurable: true,
        });

        setupVideoRateChangeListener(video);

        // Fire a burst of 25 ratechange events in one synchronous task.
        for (let i = 0; i < 25; i += 1) {
            video.dispatchEvent(new Event('ratechange'));
        }

        // Without a guard this would re-apply 25 times; the guard collapses the
        // synchronous burst to a single re-apply.
        const reApplies = writes.filter((v) => v === 2.0).length;
        expect(reApplies).toBe(1);
    });

    test('re-entrancy guard releases so a later genuine reset is still caught', async () => {
        _setCurrentSpeed(2.0);
        const video = createMockVideo(1);
        setupVideoRateChangeListener(video);

        video.playbackRate = 1.0;
        video.dispatchEvent(new Event('ratechange'));
        expect(video.playbackRate).toBe(2.0);

        // Let the microtask that releases the guard run.
        await Promise.resolve();

        // A genuinely later page reset must still be re-applied.
        video.playbackRate = 1.0;
        video.dispatchEvent(new Event('ratechange'));
        expect(video.playbackRate).toBe(2.0);
    });

    // AC3 — limitation documented near the handler
    test('content.js documents the legitimate slow-motion limitation near the ratechange handler', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'content.js'), 'utf8');
        expect(src).toMatch(/slow-motion/i);
        expect(src).toMatch(/limitation/i);
    });
});

// ===================================================================
// Story 3.1 — Shared Settings Schema & Storage Helper
//
// AC1: defaults map covers all six planned keys with documented defaults.
// AC2: reading an unset key returns its default; backward-compatible with
//      the legacy single-key (defaultPlaybackSpeed) store — no data loss.
// AC3: unit test asserts defaults resolve for an empty store AND a store
//      containing only the legacy defaultPlaybackSpeed.
// AC4: helper respects NFR-SC2 — perSiteSpeeds growth capped/pruned with a
//      documented limit (MAX_PER_SITE_ENTRIES).
// ===================================================================

describe('Story 3.1 — DEFAULT_SETTINGS (AC1: all planned keys + documented defaults)', () => {
    test('exposes all planned keys', () => {
        expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual(
            ['accentColor', 'customPresets', 'defaultPlaybackSpeed', 'hideChatFullscreen', 'hideComments', 'hideShorts', 'perSiteSpeeds', 'redlineSpeed', 'skipAds', 'theme'].sort()
        );
    });

    test('defaultPlaybackSpeed default is 1.0', () => {
        expect(DEFAULT_SETTINGS.defaultPlaybackSpeed).toBe(1.0);
    });

    test('perSiteSpeeds default is an empty object', () => {
        expect(DEFAULT_SETTINGS.perSiteSpeeds).toEqual({});
    });

    test('customPresets default is the built-in preset set', () => {
        expect(DEFAULT_SETTINGS.customPresets).toEqual([0.5, 0.75, 1.0, 1.25, 1.5, 2.0]);
    });

    test('hideShorts and hideComments default to false', () => {
        expect(DEFAULT_SETTINGS.hideShorts).toBe(false);
        expect(DEFAULT_SETTINGS.hideComments).toBe(false);
    });

    test('hideChatFullscreen defaults to true (ships enabled, by user request)', () => {
        expect(DEFAULT_SETTINGS.hideChatFullscreen).toBe(true);
    });

    test('skipAds defaults to false (ships disabled — Web Store caution)', () => {
        expect(DEFAULT_SETTINGS.skipAds).toBe(false);
    });

    test('theme defaults to "auto"', () => {
        expect(DEFAULT_SETTINGS.theme).toBe('auto');
    });

    test('accentColor defaults to System amethyst "#9D4EDD"', () => {
        expect(DEFAULT_SETTINGS.accentColor).toBe('#9D4EDD');
    });
});

describe('Story 3.1 — resolveSettings (AC2/AC3: defaults + backward-compat)', () => {
    test('AC3 empty store: every key resolves to its documented default', () => {
        const s = resolveSettings({});
        expect(s).toEqual(DEFAULT_SETTINGS);
    });

    test('AC3 empty store: null/undefined input resolves to defaults (no throw)', () => {
        expect(resolveSettings(undefined)).toEqual(DEFAULT_SETTINGS);
        expect(resolveSettings(null)).toEqual(DEFAULT_SETTINGS);
    });

    test('AC3 legacy-only store: legacy defaultPlaybackSpeed is preserved', () => {
        const s = resolveSettings({ defaultPlaybackSpeed: 1.75 });
        expect(s.defaultPlaybackSpeed).toBe(1.75);
    });

    test('AC2 legacy-only store: all other keys fall back to defaults (no data loss)', () => {
        const s = resolveSettings({ defaultPlaybackSpeed: 1.75 });
        expect(s.perSiteSpeeds).toEqual({});
        expect(s.customPresets).toEqual([0.5, 0.75, 1.0, 1.25, 1.5, 2.0]);
        expect(s.hideShorts).toBe(false);
        expect(s.hideComments).toBe(false);
        expect(s.theme).toBe('auto');
    });

    test('AC2 a set key overrides its default; unset keys still default', () => {
        const s = resolveSettings({ perSiteSpeeds: { 'youtube.com': 2.0 }, theme: 'dark' });
        expect(s.perSiteSpeeds).toEqual({ 'youtube.com': 2.0 });
        expect(s.theme).toBe('dark');
        expect(s.defaultPlaybackSpeed).toBe(1.0); // unset → default
    });

    test('returned object-valued defaults are copies, not the shared DEFAULT_SETTINGS reference', () => {
        const s = resolveSettings({});
        s.perSiteSpeeds['x.com'] = 3.0;
        s.customPresets.push(99);
        expect(DEFAULT_SETTINGS.perSiteSpeeds).toEqual({}); // not mutated
        expect(DEFAULT_SETTINGS.customPresets).toEqual([0.5, 0.75, 1.0, 1.25, 1.5, 2.0]);
    });

    test('stored object/array values are returned as copies, not by reference', () => {
        const stored = { perSiteSpeeds: { 'youtube.com': 2.0 }, customPresets: [1.0, 2.0] };
        const s = resolveSettings(stored);
        s.perSiteSpeeds['vimeo.com'] = 1.5;
        s.customPresets.push(3.0);
        // caller's mutation must NOT leak back into the stored object
        expect(stored.perSiteSpeeds).toEqual({ 'youtube.com': 2.0 });
        expect(stored.customPresets).toEqual([1.0, 2.0]);
    });
});

describe('Story 3.1 — getSettings (reads storage, applies defaults)', () => {
    beforeEach(() => {
        setupChromeMock();
    });

    test('empty store → callback receives full default settings', (done) => {
        getSettings((settings) => {
            expect(settings).toEqual(DEFAULT_SETTINGS);
            done();
        });
    });

    test('legacy-only store → defaultPlaybackSpeed preserved, rest defaulted', (done) => {
        chrome._setStorageData('defaultPlaybackSpeed', 2.5);
        getSettings((settings) => {
            expect(settings.defaultPlaybackSpeed).toBe(2.5);
            expect(settings.perSiteSpeeds).toEqual({});
            expect(settings.theme).toBe('auto');
            done();
        });
    });
});

describe('Story 3.1 — capPerSiteSpeeds (AC4: NFR-SC2 documented cap)', () => {
    test('MAX_PER_SITE_ENTRIES is a documented positive limit', () => {
        expect(typeof MAX_PER_SITE_ENTRIES).toBe('number');
        expect(MAX_PER_SITE_ENTRIES).toBeGreaterThan(0);
    });

    test('under the cap: returns all entries unchanged', () => {
        const map = { 'a.com': 1.5, 'b.com': 2.0 };
        expect(capPerSiteSpeeds(map)).toEqual(map);
    });

    test('over the cap: prunes to exactly MAX_PER_SITE_ENTRIES entries', () => {
        const map = {};
        for (let i = 0; i < MAX_PER_SITE_ENTRIES + 25; i++) {
            map[`site${i}.com`] = 1.0 + (i % 3) * 0.25;
        }
        const capped = capPerSiteSpeeds(map);
        expect(Object.keys(capped).length).toBe(MAX_PER_SITE_ENTRIES);
    });

    test('over the cap: keeps the newest entries (drops oldest by insertion order)', () => {
        const map = {};
        for (let i = 0; i < MAX_PER_SITE_ENTRIES + 5; i++) {
            map[`site${i}.com`] = 1.0;
        }
        const capped = capPerSiteSpeeds(map);
        // oldest five dropped
        expect(capped['site0.com']).toBeUndefined();
        expect(capped['site4.com']).toBeUndefined();
        // newest retained
        expect(capped[`site${MAX_PER_SITE_ENTRIES + 4}.com`]).toBe(1.0);
    });

    test('handles empty / undefined input without throwing', () => {
        expect(capPerSiteSpeeds({})).toEqual({});
        expect(capPerSiteSpeeds(undefined)).toEqual({});
    });
});

// ===================================================================
// Story 3.5 — Per-Site Speed Resolution in Content Script (FR-11)
//
// AC1: perSiteSpeeds["youtube.com"]=2.0 → a youtube.com page applies 2.0x.
// AC2: no per-site value for vimeo.com → global default applies (site → global).
// AC3: resolution uses the document's registrable domain; both branches tested.
// ===================================================================

describe('Story 3.5 — getRegistrableDomain (AC3: registrable domain)', () => {
    test('returns the bare domain unchanged', () => {
        expect(getRegistrableDomain('youtube.com')).toBe('youtube.com');
    });

    test('strips subdomains to the registrable (eTLD+1) domain', () => {
        expect(getRegistrableDomain('www.youtube.com')).toBe('youtube.com');
        expect(getRegistrableDomain('m.youtube.com')).toBe('youtube.com');
        expect(getRegistrableDomain('music.youtube.com')).toBe('youtube.com');
    });

    test('single-label hosts (localhost) return as-is', () => {
        expect(getRegistrableDomain('localhost')).toBe('localhost');
    });

    test('empty / nullish host returns empty string (no throw)', () => {
        expect(getRegistrableDomain('')).toBe('');
        expect(getRegistrableDomain(undefined)).toBe('');
        expect(getRegistrableDomain(null)).toBe('');
    });
});

describe('Story 3.5 — resolveSpeedForSite (AC1/AC2: site → global precedence)', () => {
    test('AC1: a per-site override for the domain applies', () => {
        const perSite = { 'youtube.com': 2.0 };
        expect(resolveSpeedForSite(perSite, 'youtube.com', 1.0)).toBe(2.0);
    });

    test('AC1: per-site override resolves through a subdomain (www.youtube.com)', () => {
        const perSite = { 'youtube.com': 2.0 };
        expect(resolveSpeedForSite(perSite, 'www.youtube.com', 1.0)).toBe(2.0);
    });

    test('AC2: no per-site value for the domain falls back to global default', () => {
        const perSite = { 'youtube.com': 2.0 };
        expect(resolveSpeedForSite(perSite, 'vimeo.com', 1.0)).toBe(1.0);
    });

    test('AC2: empty perSiteSpeeds falls back to global default', () => {
        expect(resolveSpeedForSite({}, 'vimeo.com', 1.25)).toBe(1.25);
        expect(resolveSpeedForSite(undefined, 'vimeo.com', 1.25)).toBe(1.25);
    });

    test('a non-numeric / invalid stored per-site value falls back to global', () => {
        expect(resolveSpeedForSite({ 'youtube.com': 'fast' }, 'youtube.com', 1.0)).toBe(1.0);
        expect(resolveSpeedForSite({ 'youtube.com': NaN }, 'youtube.com', 1.0)).toBe(1.0);
    });
});

describe('Story 3.5 — initializeSpeed applies per-site resolution on load', () => {
    // jsdom serves pages from http://localhost/, so location.hostname === 'localhost'.
    beforeEach(() => {
        setupChromeMock();
        _setCurrentSpeed(1.0);
        _setInitialized(false);
    });

    test('AC1: a per-site override for the current domain is applied on init', () => {
        chrome._setStorageData('defaultPlaybackSpeed', 1.0);
        chrome._setStorageData('perSiteSpeeds', { localhost: 2.0 });
        initializeSpeed();
        expect(_getCurrentSpeed()).toBe(2.0);
    });

    test('AC2: no per-site override for the current domain → global default applies', () => {
        chrome._setStorageData('defaultPlaybackSpeed', 1.5);
        chrome._setStorageData('perSiteSpeeds', { 'youtube.com': 2.0 });
        initializeSpeed();
        expect(_getCurrentSpeed()).toBe(1.5);
    });
});

// ===================================================================
// Story 3.8 — Per-site-aware hotkey persistence
//
// When a per-site preset is active for the current registrable domain, a hotkey
// speed change updates perSiteSpeeds[domain] (not the global default). When no
// per-site preset is active, behavior is unchanged from Story 3.3 (global
// defaultPlaybackSpeed updates). jsdom serves http://localhost/ so the current
// domain is 'localhost'.
// ===================================================================

describe('Story 3.8 — Per-site-aware hotkey persistence', () => {
    const messageHandler = _messageHandler;

    beforeEach(() => {
        setupChromeMock();
        _setCurrentSpeed(1.0);
        document.body.innerHTML = '';
        document.body.appendChild(createMockVideo());
    });

    function wroteKey(key) {
        return chrome.storage.sync.set.mock.calls.some(
            ([arg]) => Object.prototype.hasOwnProperty.call(arg, key));
    }

    test('AC1: per-site preset active → stepSpeed updates perSiteSpeeds[domain], not the global default', (done) => {
        chrome._setStorageData('perSiteSpeeds', { localhost: 2.0 });
        _setCurrentSpeed(2.0);
        messageHandler({ action: 'stepSpeed', delta: 0.1 }, { id: 'tach-test-ext', tab: { id: 1 } }, () => {
            expect(chrome.storage.sync.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    perSiteSpeeds: expect.objectContaining({ localhost: 2.1 }),
                }));
            expect(wroteKey('defaultPlaybackSpeed')).toBe(false);
            done();
        });
    });

    test('AC1: per-site preset active → resetSpeed writes 1.0x to perSiteSpeeds[domain]', (done) => {
        chrome._setStorageData('perSiteSpeeds', { localhost: 3.0 });
        _setCurrentSpeed(3.0);
        messageHandler({ action: 'resetSpeed' }, { id: 'tach-test-ext', tab: { id: 1 } }, () => {
            expect(chrome.storage.sync.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    perSiteSpeeds: expect.objectContaining({ localhost: 1.0 }),
                }));
            expect(wroteKey('defaultPlaybackSpeed')).toBe(false);
            done();
        });
    });

    test('AC2: no per-site preset for THIS domain → nothing persists (default is options-owned)', (done) => {
        chrome._setStorageData('perSiteSpeeds', { 'youtube.com': 2.0 }); // not the jsdom domain
        _setCurrentSpeed(1.0);
        messageHandler({ action: 'stepSpeed', delta: 0.1 }, { id: 'tach-test-ext', tab: { id: 1 } }, () => {
            expect(wroteKey('defaultPlaybackSpeed')).toBe(false);
            expect(wroteKey('perSiteSpeeds')).toBe(false);
            done();
        });
    });

    test('AC2: empty perSiteSpeeds → nothing persists', (done) => {
        _setCurrentSpeed(1.0);
        messageHandler({ action: 'stepSpeed', delta: 0.1 }, { id: 'tach-test-ext', tab: { id: 1 } }, () => {
            expect(wroteKey('defaultPlaybackSpeed')).toBe(false);
            done();
        });
    });

    test('per-site write preserves other saved domains', (done) => {
        chrome._setStorageData('perSiteSpeeds', { localhost: 1.0, 'vimeo.com': 1.5 });
        _setCurrentSpeed(1.0);
        messageHandler({ action: 'stepSpeed', delta: 0.1 }, { id: 'tach-test-ext', tab: { id: 1 } }, () => {
            const call = chrome.storage.sync.set.mock.calls.find(
                ([arg]) => Object.prototype.hasOwnProperty.call(arg, 'perSiteSpeeds'));
            expect(call[0].perSiteSpeeds).toEqual({ localhost: 1.1, 'vimeo.com': 1.5 });
            done();
        });
    });
});
