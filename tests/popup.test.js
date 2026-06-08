/**
 * Unit tests for popup.js pure helpers — Story 3.6 ("Remember Speed for This Site").
 *
 * Covered here: the pure, exported helpers — getDomainFromUrl(url) (active-tab
 * domain extraction) and capPerSiteMap(map) (NFR-SC2 cap enforcement).
 *
 * The DOMContentLoaded-coupled wiring (initRememberSiteControl's toggle ON/OFF
 * storage round-trip and initial checked-state) is exercised end-to-end by
 * `e2e/per-site-speed.spec.js` (real browser + real chrome.storage) rather than
 * via a brittle jsdom DOMContentLoaded harness. The pure write-decision logic
 * (buildSpeedWrite, D2/D4) is unit-tested below.
 */
const { setupChromeMock } = require('./chrome-mock');
setupChromeMock();

const {
    getDomainFromUrl, capPerSiteMap, isValidSpeed, buildSpeedWrite,
    isYouTubeWatchUrl, decideTranscriptResult, getPresetSpeeds,
} = require('../src/popup/popup');
const VSC_PRESETS = require('../src/constants');

describe('Story 3.6 — getDomainFromUrl (active-tab domain extraction)', () => {
    test('extracts the registrable domain from a full URL', () => {
        expect(getDomainFromUrl('https://www.youtube.com/watch?v=abc')).toBe('youtube.com');
        expect(getDomainFromUrl('https://youtube.com/')).toBe('youtube.com');
    });

    test('strips subdomains to eTLD+1', () => {
        expect(getDomainFromUrl('https://m.youtube.com/')).toBe('youtube.com');
        expect(getDomainFromUrl('https://music.youtube.com/')).toBe('youtube.com');
    });

    test('returns empty string for non-web / invalid URLs (chrome://, about:, junk)', () => {
        expect(getDomainFromUrl('chrome://extensions')).toBe('');
        expect(getDomainFromUrl('about:blank')).toBe('');
        expect(getDomainFromUrl('not a url')).toBe('');
        expect(getDomainFromUrl('')).toBe('');
        expect(getDomainFromUrl(undefined)).toBe('');
        expect(getDomainFromUrl(null)).toBe('');
    });
});

describe('Story 3.6 — capPerSiteMap (NFR-SC2 cap on perSiteSpeeds)', () => {
    test('under the cap: returns all entries unchanged (new object)', () => {
        const map = { 'a.com': 1.5, 'b.com': 2.0 };
        const out = capPerSiteMap(map);
        expect(out).toEqual(map);
        expect(out).not.toBe(map); // copy, not the same reference
    });

    test('over the cap: prunes to exactly MAX_PER_SITE_ENTRIES, dropping oldest', () => {
        const map = {};
        for (let i = 0; i < 100 + 5; i++) map[`site${i}.com`] = 1.0;
        const out = capPerSiteMap(map);
        expect(Object.keys(out).length).toBe(100);
        // oldest five dropped
        expect(out['site0.com']).toBeUndefined();
        expect(out['site4.com']).toBeUndefined();
        // newest retained
        expect(out['site104.com']).toBe(1.0);
    });

    test('does not mutate the input map', () => {
        const map = {};
        for (let i = 0; i < 100 + 3; i++) map[`s${i}.com`] = 1.0;
        capPerSiteMap(map);
        expect(Object.keys(map).length).toBe(103); // input untouched
    });
});

describe('popup isValidSpeed (D4 validate-on-write)', () => {
    test('accepts in-range speeds', () => {
        expect(isValidSpeed(0.25)).toBe(true);
        expect(isValidSpeed(2.0)).toBe(true);
        expect(isValidSpeed(4.0)).toBe(true);
    });
    test('accepts the new 0.01 floor', () => {
        expect(isValidSpeed(0.01)).toBe(true);
    });

    test('rejects out-of-range and non-numeric', () => {
        expect(isValidSpeed(0.005)).toBe(false); // below the 0.01 floor
        expect(isValidSpeed(5.0)).toBe(false);
        expect(isValidSpeed('nope')).toBe(false);
        expect(isValidSpeed(NaN)).toBe(false);
    });
});

// ---- Story 6.2: Render custom presets in popup (FR-12) — PURE HELPER ----
// Main-Agent-authored contract (TDD). The 6.2 dev agent implements getPresetSpeeds
// to pass these and must NOT weaken them. DOM-render tests are dev-authored below.
describe('Story 6.2 — getPresetSpeeds (pure preset resolver)', () => {
    test('returns a saved 6-length array of valid speeds unchanged', () => {
        const saved = [0.5, 1.0, 1.85, 2.0, 3.0, 4.0];
        expect(getPresetSpeeds(saved)).toEqual(saved);
    });

    test('falls back to DEFAULT_SETTINGS.customPresets when missing/undefined', () => {
        expect(getPresetSpeeds(undefined)).toEqual(VSC_PRESETS.DEFAULT_SETTINGS.customPresets);
        expect(getPresetSpeeds(null)).toEqual(VSC_PRESETS.DEFAULT_SETTINGS.customPresets);
    });

    test('falls back when the saved array is not exactly 6 valid numbers', () => {
        expect(getPresetSpeeds([1.0, 2.0])).toEqual(VSC_PRESETS.DEFAULT_SETTINGS.customPresets); // wrong length
        expect(getPresetSpeeds([1, 2, 3, 'x', 5, 6])).toEqual(VSC_PRESETS.DEFAULT_SETTINGS.customPresets); // non-numeric
    });

    test('always returns exactly 6 values', () => {
        expect(getPresetSpeeds([0.5, 0.75, 1.0, 1.25, 1.5, 2.0]).length).toBe(6);
        expect(getPresetSpeeds(undefined).length).toBe(6);
    });
});

describe('buildSpeedWrite (D2 per-site-aware popup persistence + D4 validation)', () => {
    test('D2: domain WITH an active per-site preset → writes perSiteSpeeds[domain], not global', () => {
        const out = buildSpeedWrite(2.25, 'youtube.com', { 'youtube.com': 2.0, 'vimeo.com': 1.5 });
        expect(out).toEqual({ perSiteSpeeds: { 'youtube.com': 2.25, 'vimeo.com': 1.5 } });
        expect(out.defaultPlaybackSpeed).toBeUndefined();
    });

    test('D2: domain WITHOUT a per-site preset → null (default is options-owned, no write)', () => {
        // The dial never writes the global default; an un-remembered site applies
        // live only. Persisting requires the "Remember rate for this site" toggle.
        expect(buildSpeedWrite(1.75, 'youtube.com', { 'vimeo.com': 1.5 })).toBeNull();
    });

    test('D2: empty/unknown domain → null (no write)', () => {
        expect(buildSpeedWrite(1.5, '', { 'a.com': 2.0 })).toBeNull();
        expect(buildSpeedWrite(1.5, '', {})).toBeNull();
    });

    test('D4: out-of-range speed → null (caller skips the write)', () => {
        expect(buildSpeedWrite(9.0, 'youtube.com', { 'youtube.com': 2.0 })).toBeNull();
        expect(buildSpeedWrite(0.005, '', {})).toBeNull(); // below the 0.01 floor
        expect(buildSpeedWrite('nan', 'youtube.com', { 'youtube.com': 2.0 })).toBeNull();
    });

    test('per-site write enforces the NFR-SC2 cap', () => {
        const map = {};
        for (let i = 0; i < 100; i++) map[`s${i}.com`] = 1.0;
        map['target.com'] = 1.0; // 101 entries, target is active
        const out = buildSpeedWrite(2.0, 'target.com', map);
        expect(Object.keys(out.perSiteSpeeds).length).toBe(100);
        expect(out.perSiteSpeeds['target.com']).toBe(2.0);
        expect(out.perSiteSpeeds['s0.com']).toBeUndefined(); // oldest dropped
    });
});

// ---- Story 5.3: "Copy Transcript" popup affordance (FR-16) ----
//
// Coverage scope (honesty — project memory: a unit test must not claim coverage
// it lacks): the two PURE helpers below are the load-bearing decision logic and
// are fully unit-tested here. The DOMContentLoaded wiring (button show/hide,
// click → sendMessage → navigator.clipboard.writeText → status text) is NOT
// covered by any automated layer — there is no YouTube e2e suite — and is
// verified MANUALLY on a real watch page. Do not add a comment claiming e2e
// covers it.

describe('Story 5.3 — isYouTubeWatchUrl (watch-page gating)', () => {
    test('true only for a youtube.com /watch page', () => {
        expect(isYouTubeWatchUrl('https://www.youtube.com/watch?v=abc')).toBe(true);
        expect(isYouTubeWatchUrl('https://youtube.com/watch?v=abc')).toBe(true);
        expect(isYouTubeWatchUrl('https://m.youtube.com/watch?v=abc')).toBe(true);
    });

    test('false for YouTube non-watch pages (home, shorts, channel)', () => {
        expect(isYouTubeWatchUrl('https://www.youtube.com/')).toBe(false);
        expect(isYouTubeWatchUrl('https://www.youtube.com/shorts/xyz')).toBe(false);
        expect(isYouTubeWatchUrl('https://www.youtube.com/@someChannel')).toBe(false);
    });

    test('false for non-YouTube sites and non-web/junk URLs', () => {
        expect(isYouTubeWatchUrl('https://vimeo.com/watch')).toBe(false);
        expect(isYouTubeWatchUrl('https://notyoutube.com/watch')).toBe(false);
        expect(isYouTubeWatchUrl('chrome://extensions')).toBe(false);
        expect(isYouTubeWatchUrl('not a url')).toBe(false);
        expect(isYouTubeWatchUrl('')).toBe(false);
        expect(isYouTubeWatchUrl(undefined)).toBe(false);
        expect(isYouTubeWatchUrl(null)).toBe(false);
    });
});

describe('Story 5.3 — decideTranscriptResult (response → action decision)', () => {
    test('AC1: available transcript with text → ok + copied text + success message', () => {
        const r = decideTranscriptResult({ available: true, text: 'line one\nline two' });
        expect(r.status).toBe('ok');
        expect(r.text).toBe('line one\nline two');
        expect(r.message).toMatch(/copied/i);
    });

    test('AC2: available:false → none, no text, "No transcript available" message', () => {
        const r = decideTranscriptResult({ available: false, text: '' });
        expect(r.status).toBe('none');
        expect(r.text).toBeUndefined();
        expect(r.message).toBe('No transcript available for this video');
    });

    test('AC2: available:true but empty text is also treated as none (nothing to copy)', () => {
        const r = decideTranscriptResult({ available: true, text: '' });
        expect(r.status).toBe('none');
        expect(r.message).toBe('No transcript available for this video');
    });

    test('no response (content script unreachable) → error, nothing copied', () => {
        const r = decideTranscriptResult(undefined);
        expect(r.status).toBe('error');
        expect(r.text).toBeUndefined();
        expect(typeof r.message).toBe('string');
        expect(r.message.length).toBeGreaterThan(0);
    });

    test('null response → error (does not throw)', () => {
        expect(() => decideTranscriptResult(null)).not.toThrow();
        expect(decideTranscriptResult(null).status).toBe('error');
    });
});

// ---- Story 6.2: Render custom presets in popup (FR-12) — DOM rendering ----
//
// Coverage: DOMContentLoaded-coupled preset rendering. The handler reads
// customPresets from chrome.storage.sync, resolves via getPresetSpeeds, and
// builds 6 <button class="preset-btn"> elements into .preset-speeds.
// Tests dispatch DOMContentLoaded against a built DOM and assert in setTimeout(0)
// because the storage reads are async callbacks.
//
// Coverage honesty: active-state applied on load is verified (matching speed gets
// `active` class). Click → setVideoSpeed path is verified by observing
// chrome.tabs.sendMessage being called with the expected speed. The clipboard,
// transcript, and per-site wiring are NOT covered here (see their own describes).

describe('Story 6.2 — popup preset rendering (DOM)', () => {
    let chrome;

    /**
     * Build the minimal popup DOM the DOMContentLoaded handler queries, seed
     * chrome-mock storage, then dispatch the event to exercise the real handler.
     * chrome-mock.js already provides chrome.runtime.getManifest() → {version:'1.0.0'}.
     */
    function bootPopup() {
        document.body.innerHTML = `
            <div class="preset-speeds"></div>
            <input type="range" id="speedSlider" min="0.01" max="4.00" step="0.01" value="1.00">
            <div id="currentSpeed">1.00x</div>
            <button id="decreaseSpeed"></button>
            <button id="increaseSpeed"></button>
            <button id="resetBtn"></button>
            <button id="fasterBtn"></button>
            <input type="checkbox" id="rememberSiteToggle">
            <span id="rememberSiteDomain"></span>
            <button id="copyTranscriptBtn" hidden></button>
            <div id="transcriptStatus"></div>
            <label id="includeTimestampsLabel" hidden>
                <input type="checkbox" id="includeTimestampsToggle">
            </label>`;
        document.dispatchEvent(new Event('DOMContentLoaded'));
    }

    beforeEach(() => {
        chrome = setupChromeMock();
    });

    test('renders 6 preset buttons from saved customPresets', (done) => {
        const saved = [0.25, 0.5, 1.0, 1.5, 2.0, 3.0];
        chrome._setStorageData('customPresets', saved);
        bootPopup();
        setTimeout(() => {
            const btns = document.querySelectorAll('.preset-btn');
            expect(btns.length).toBe(6);
            const speeds = Array.from(btns).map(b => parseFloat(b.dataset.speed));
            expect(speeds).toEqual(saved);
            done();
        }, 0);
    });

    test('renders default presets when no customPresets stored', (done) => {
        // Nothing seeded — storage returns empty object.
        bootPopup();
        setTimeout(() => {
            const btns = document.querySelectorAll('.preset-btn');
            expect(btns.length).toBe(6);
            const speeds = Array.from(btns).map(b => parseFloat(b.dataset.speed));
            expect(speeds).toEqual(VSC_PRESETS.DEFAULT_SETTINGS.customPresets);
            done();
        }, 0);
    });

    test('each button textContent is formatted as "<value>x"', (done) => {
        bootPopup();
        setTimeout(() => {
            const btns = document.querySelectorAll('.preset-btn');
            btns.forEach(btn => {
                const speed = parseFloat(btn.dataset.speed);
                expect(btn.textContent).toBe(speed + 'x');
            });
            done();
        }, 0);
    });

    test('the button matching the current speed gets the active class on load', (done) => {
        // defaultPlaybackSpeed is 1.0 by default (mock returns nothing → loadSavedSpeed
        // falls back to 1.0). The default preset list contains 1.0, so that button
        // should receive the active class.
        bootPopup();
        setTimeout(() => {
            const btns = document.querySelectorAll('.preset-btn');
            const activeBtn = Array.from(btns).find(b => b.classList.contains('active'));
            // At least one button should be active when the current speed matches a preset.
            expect(activeBtn).toBeTruthy();
            expect(parseFloat(activeBtn.dataset.speed)).toBeCloseTo(1.0);
            done();
        }, 0);
    });

    test('clicking a generated preset triggers a speed apply (sendMessage with that speed)', (done) => {
        const saved = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
        chrome._setStorageData('customPresets', saved);
        // Seed a tab so sendMessage is called.
        chrome.tabs.query.mockImplementation((q, cb) => cb([{ id: 42, url: 'https://example.com/' }]));
        bootPopup();
        setTimeout(() => {
            const btns = document.querySelectorAll('.preset-btn');
            // Click the 1.5x button (index 4 in the saved list).
            btns[4].click();
            // sendMessage is called asynchronously inside setVideoSpeed → getActiveTab → then.
            // Allow one more tick for the Promise resolution.
            setTimeout(() => {
                const calls = chrome.tabs.sendMessage.mock.calls;
                const speedCall = calls.find(c => c[1] && c[1].action === 'setSpeed' && c[1].speed === 1.5);
                expect(speedCall).toBeTruthy();
                done();
            }, 0);
        }, 0);
    });

    // Regression: opening the popup must apply the PER-SITE override, not reset the
    // page to the global default. loadSavedSpeed reads perSiteSpeeds and resolves
    // site → global (mirroring content.js resolveSpeedForSite). Previously it read
    // only defaultPlaybackSpeed and pushed the global default onto the video via
    // setSpeed, clobbering the override.
    test('loadSavedSpeed applies the per-site override (not the global default) on open', (done) => {
        chrome._setStorageData('defaultPlaybackSpeed', 1.0);
        chrome._setStorageData('perSiteSpeeds', { 'example.com': 2.5 });
        chrome.tabs.query.mockImplementation((q, cb) => cb([{ id: 7, url: 'https://www.example.com/watch' }]));
        bootPopup();
        setTimeout(() => {
            const applied = chrome.tabs.sendMessage.mock.calls
                .filter(c => c[1] && c[1].action === 'setSpeed')
                .map(c => c[1].speed);
            // The per-site speed is what gets applied; the global default never is.
            expect(applied).toContain(2.5);
            expect(applied).not.toContain(1.0);
            // And the display reflects the per-site speed.
            expect(document.getElementById('currentSpeed').textContent).toBe('2.50x');
            done();
        }, 0);
    });

    // Guard the other branch: with NO per-site entry for the domain, the global
    // default is applied (the resolver falls through site → global).
    test('loadSavedSpeed applies the global default when the domain has no per-site entry', (done) => {
        chrome._setStorageData('defaultPlaybackSpeed', 1.75);
        chrome._setStorageData('perSiteSpeeds', { 'other.com': 2.5 });
        chrome.tabs.query.mockImplementation((q, cb) => cb([{ id: 9, url: 'https://www.example.com/watch' }]));
        bootPopup();
        setTimeout(() => {
            const applied = chrome.tabs.sendMessage.mock.calls
                .filter(c => c[1] && c[1].action === 'setSpeed')
                .map(c => c[1].speed);
            expect(applied).toContain(1.75);
            expect(applied).not.toContain(2.5);
            done();
        }, 0);
    });
});
