/**
 * Unit tests for options.js pure helpers — Story 3.7 ("Per-Site Preset Management").
 *
 * Covered here: the pure, exported removePerSiteEntry(map, domain) helper.
 *
 * NOT YET COVERED (tracked test debt): renderPerSiteList's DOM output and the
 * Remove-button → storage round-trip (DOMContentLoaded-coupled). The existing
 * Playwright e2e suite does NOT exercise perSiteSpeeds; a per-site DOM/e2e spec
 * is owed. Do not claim that wiring is covered until that test exists.
 */
const { setupChromeMock } = require('./chrome-mock');
setupChromeMock();

const { removePerSiteEntry, setPerSiteEntry, sanitizePresetValue } = require('../src/options/options');

// ---- Story 4.3: YouTube cleanup toggles (FR-14/FR-15) ----
//
// The toggle wiring lives inside options.js's DOMContentLoaded handler. We
// exercise it for real by building the options DOM, dispatching DOMContentLoaded
// (jsdom doesn't re-fire it for late-added listeners), then asserting the
// load-reflect and change-persist behavior against the chrome.storage mock.

describe('Story 4.3 — YouTube cleanup toggles', () => {
    let chrome;

    /** Build the options page DOM the handler queries, then run the handler. */
    function bootOptionsPage() {
        document.body.innerHTML = `
            <input type="number" id="speedInput">
            <button id="saveBtn"></button>
            <div id="status"></div>
            <div id="perSiteList"></div>
            <input type="checkbox" id="hideShortsToggle">
            <input type="checkbox" id="hideCommentsToggle">
            <input type="checkbox" id="hideChatFullscreenToggle">
            <input type="checkbox" id="skipAdsToggle">`;
        document.dispatchEvent(new Event('DOMContentLoaded'));
    }

    beforeEach(() => {
        chrome = setupChromeMock();
    });

    test('both toggles default to OFF when nothing is stored', (done) => {
        bootOptionsPage();
        // storage reads are async (callback) — let them settle.
        setTimeout(() => {
            expect(document.getElementById('hideShortsToggle').checked).toBe(false);
            expect(document.getElementById('hideCommentsToggle').checked).toBe(false);
            done();
        }, 0);
    });

    test('toggles render reflecting stored values', (done) => {
        chrome._setStorageData('hideShorts', true);
        chrome._setStorageData('hideComments', true);
        bootOptionsPage();
        setTimeout(() => {
            expect(document.getElementById('hideShortsToggle').checked).toBe(true);
            expect(document.getElementById('hideCommentsToggle').checked).toBe(true);
            done();
        }, 0);
    });

    test('checking Hide Shorts persists hideShorts:true to storage.sync', (done) => {
        bootOptionsPage();
        setTimeout(() => {
            const toggle = document.getElementById('hideShortsToggle');
            toggle.checked = true;
            toggle.dispatchEvent(new Event('change'));
            const lastSet = chrome.storage.sync.set.mock.calls.slice(-1)[0][0];
            expect(lastSet).toEqual({ hideShorts: true });
            done();
        }, 0);
    });

    test('Hide-chat-in-fullscreen defaults to ON when nothing is stored', (done) => {
        bootOptionsPage();
        setTimeout(() => {
            // Unlike the other two, this key's default is ON — an unset store
            // must reflect a CHECKED box (initYouTubeToggle falls back to
            // DEFAULT_SETTINGS[key], not a blanket OFF).
            expect(document.getElementById('hideChatFullscreenToggle').checked).toBe(true);
            done();
        }, 0);
    });

    test('unchecking Hide-chat-in-fullscreen persists hideChatFullscreen:false', (done) => {
        bootOptionsPage();
        setTimeout(() => {
            const toggle = document.getElementById('hideChatFullscreenToggle');
            expect(toggle.checked).toBe(true); // default ON
            toggle.checked = false;
            toggle.dispatchEvent(new Event('change'));
            const lastSet = chrome.storage.sync.set.mock.calls.slice(-1)[0][0];
            expect(lastSet).toEqual({ hideChatFullscreen: false });
            done();
        }, 0);
    });

    test('Skip-ads defaults to OFF when nothing is stored', (done) => {
        bootOptionsPage();
        setTimeout(() => {
            expect(document.getElementById('skipAdsToggle').checked).toBe(false);
            done();
        }, 0);
    });

    test('checking Skip ads persists skipAds:true to storage.sync', (done) => {
        bootOptionsPage();
        setTimeout(() => {
            const toggle = document.getElementById('skipAdsToggle');
            toggle.checked = true;
            toggle.dispatchEvent(new Event('change'));
            const lastSet = chrome.storage.sync.set.mock.calls.slice(-1)[0][0];
            expect(lastSet).toEqual({ skipAds: true });
            done();
        }, 0);
    });

    test('unchecking Hide Comments persists hideComments:false to storage.sync', (done) => {
        chrome._setStorageData('hideComments', true);
        bootOptionsPage();
        setTimeout(() => {
            const toggle = document.getElementById('hideCommentsToggle');
            expect(toggle.checked).toBe(true); // reflected stored ON
            toggle.checked = false;
            toggle.dispatchEvent(new Event('change'));
            const lastSet = chrome.storage.sync.set.mock.calls.slice(-1)[0][0];
            expect(lastSet).toEqual({ hideComments: false });
            done();
        }, 0);
    });
});

// ---- Story 6.6: User-settable accent color (FR-14) — PURE HELPERS ----
//
// These tests pin the contrast-safe accent contract in constants.js. They are
// authored by Main Agent (TDD) — the 6.6 dev agent implements to pass them and
// must NOT weaken them. The DOM-picker wiring tests live in their own describe
// block below (dev-authored, exact element IDs pinned by the dispatch).
//
// Independent WCAG sRGB contrast calc so the assertions don't circularly import
// the helper they verify.
const VSC_ACCENT = require('../src/constants');

function _srgbChannel(c) {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}
function _luminance(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return 0.2126 * _srgbChannel(r) + 0.7152 * _srgbChannel(g) + 0.0722 * _srgbChannel(b);
}
function _wcagContrast(hex1, hex2) {
    const l1 = _luminance(hex1);
    const l2 = _luminance(hex2);
    const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
}

describe('Story 6.6 — accent color contract (constants.js pure helpers)', () => {
    test('DEFAULT_SETTINGS.accentColor defaults to System amethyst #9D4EDD', () => {
        expect(VSC_ACCENT.DEFAULT_SETTINGS.accentColor).toBe('#9D4EDD');
    });

    test('deriveAccentHover(hex) returns a strictly darker shade', () => {
        const hover = VSC_ACCENT.deriveAccentHover('#e8590c');
        expect(/^#[0-9a-fA-F]{6}$/.test(hover)).toBe(true);
        expect(_luminance(hover)).toBeLessThan(_luminance('#e8590c'));
    });

    test('ensureAccentContrast picks a fill+text combo that meets WCAG AA (>=4.5:1) for any accent', () => {
        // Includes a deliberately LIGHT accent (yellow) that white text fails on —
        // the helper must darken the fill or flip text to dark to stay >= 4.5:1.
        for (const accent of ['#e8590c', '#2563eb', '#16a34a', '#9333ea', '#dc2626', '#ffd400', '#ffffff']) {
            const { fill, text } = VSC_ACCENT.ensureAccentContrast(accent);
            expect(/^#[0-9a-fA-F]{6}$/.test(fill)).toBe(true);
            expect(['#ffffff', '#0d1117']).toContain(text);
            expect(_wcagContrast(fill, text)).toBeGreaterThanOrEqual(4.5);
        }
    });

    test('applyAccentColor sets --primary-color / --primary-hover on the target element', () => {
        const el = document.createElement('div');
        VSC_ACCENT.applyAccentColor(el, '#e8590c');
        expect(el.style.getPropertyValue('--primary-color')).toBe('#e8590c');
        // hover is the darker derived shade
        expect(el.style.getPropertyValue('--primary-hover')).toBe(VSC_ACCENT.deriveAccentHover('#e8590c'));
    });
});

// ---- Story 6.6: Accent picker DOM wiring ----
//
// These tests exercise the DOMContentLoaded handler in options.js for the
// accent color picker. They follow the same jsdom pattern as Story 4.3 above:
// build the DOM (including all elements the handler queries), dispatch
// DOMContentLoaded, then assert inside setTimeout(..., 0).

describe('Story 6.6 — accent picker DOM wiring', () => {
    let chrome;

    /**
     * Build the full options-page DOM the handler queries — including the speed
     * input, save button, status, per-site list, YouTube toggle checkboxes, AND
     * the Story 6.6 accent markup. Then fire DOMContentLoaded so options.js
     * registers all its handlers.
     */
    function bootOptionsPageWithAccent(initialStorageAccent) {
        if (initialStorageAccent !== undefined) {
            chrome._setStorageData('accentColor', initialStorageAccent);
        }
        document.body.innerHTML = `
            <input type="number" id="speedInput">
            <button id="saveBtn"></button>
            <div id="status"></div>
            <div id="perSiteList"></div>
            <input type="checkbox" id="hideShortsToggle">
            <input type="checkbox" id="hideCommentsToggle">
            <input type="checkbox" id="hideChatFullscreenToggle">
            <input type="checkbox" id="skipAdsToggle">
            <button type="button" class="accent-swatch" data-color="#e8590c"></button>
            <button type="button" class="accent-swatch" data-color="#2563eb"></button>
            <button type="button" class="accent-swatch" data-color="#16a34a"></button>
            <button type="button" class="accent-swatch" data-color="#9333ea"></button>
            <button type="button" class="accent-swatch" data-color="#dc2626"></button>
            <input type="color" id="accentColorInput">`;
        document.dispatchEvent(new Event('DOMContentLoaded'));
    }

    beforeEach(() => {
        chrome = setupChromeMock();
    });

    test('clicking a swatch persists { accentColor: <data-color> } to chrome.storage.sync', (done) => {
        bootOptionsPageWithAccent();
        setTimeout(() => {
            const blueSwatches = Array.from(document.querySelectorAll('.accent-swatch'))
                .filter(b => b.dataset.color === '#2563eb');
            expect(blueSwatches.length).toBeGreaterThan(0);
            blueSwatches[0].dispatchEvent(new Event('click'));
            const lastSet = chrome.storage.sync.set.mock.calls.slice(-1)[0][0];
            expect(lastSet).toEqual({ accentColor: '#2563eb' });
            done();
        }, 0);
    });

    test('changing accentColorInput persists { accentColor: <value> } to chrome.storage.sync', (done) => {
        bootOptionsPageWithAccent();
        setTimeout(() => {
            const input = document.getElementById('accentColorInput');
            input.value = '#9333ea';
            input.dispatchEvent(new Event('change'));
            const lastSet = chrome.storage.sync.set.mock.calls.slice(-1)[0][0];
            expect(lastSet).toEqual({ accentColor: '#9333ea' });
            done();
        }, 0);
    });

    test('on load with a stored accentColor, --primary-color reflects it on documentElement', (done) => {
        bootOptionsPageWithAccent('#16a34a');
        setTimeout(() => {
            const val = document.documentElement.style.getPropertyValue('--primary-color');
            expect(val).toBe('#16a34a');
            done();
        }, 0);
    });

    test('on load with no stored accent, --primary-color is set to the DEFAULT_SETTINGS.accentColor', (done) => {
        bootOptionsPageWithAccent(); // no stored accent
        setTimeout(() => {
            const val = document.documentElement.style.getPropertyValue('--primary-color');
            // DEFAULT_SETTINGS.accentColor = '#9D4EDD'
            expect(val).toBe('#9D4EDD');
            done();
        }, 0);
    });

    test('null guard: bootOptionsPage with no accent markup still passes (no throw)', (done) => {
        // Simulate the DOM without accent elements — the null guards must fire and
        // the handler must not throw.
        document.body.innerHTML = `
            <input type="number" id="speedInput">
            <button id="saveBtn"></button>
            <div id="status"></div>
            <div id="perSiteList"></div>
            <input type="checkbox" id="hideShortsToggle">
            <input type="checkbox" id="hideCommentsToggle">
            <input type="checkbox" id="hideChatFullscreenToggle">
            <input type="checkbox" id="skipAdsToggle">`;
        expect(() => {
            document.dispatchEvent(new Event('DOMContentLoaded'));
        }).not.toThrow();
        done();
    });
});

// ---- Story 6.1: Editable preset grid (FR-12) — PURE clamp/round helper ----
// Main-Agent-authored contract (TDD). The 6.1 dev agent implements
// sanitizePresetValue to pass these (validate-on-write) and must NOT weaken them.
// DOM grid load/persist/reset tests are dev-authored in their own block below.
describe('Story 6.1 — sanitizePresetValue (validate-on-write clamp + round)', () => {
    test('passes through an in-range value, rounded to 2 decimals', () => {
        expect(sanitizePresetValue(1.85, 1.0)).toBe(1.85);
        expect(sanitizePresetValue(1.236, 1.0)).toBe(1.24);
    });

    test('clamps above SPEED_MAX down to 4.0 and below SPEED_MIN up to 0.01', () => {
        expect(sanitizePresetValue(9.0, 1.0)).toBe(4.0);
        expect(sanitizePresetValue(0.001, 1.0)).toBe(0.01);
    });

    test('returns the fallback for a non-numeric / empty entry (never persists invalid)', () => {
        expect(sanitizePresetValue('nope', 1.5)).toBe(1.5);
        expect(sanitizePresetValue('', 0.75)).toBe(0.75);
        expect(sanitizePresetValue(NaN, 2.0)).toBe(2.0);
    });
});

// ---- Story 6.1: Editable preset grid (FR-12) — DOM wiring ----
//
// These tests exercise the DOMContentLoaded handler in options.js for the
// preset grid. They follow the same jsdom pattern as Story 4.3 / Story 6.6:
// build the DOM including all elements the handler queries, dispatch
// DOMContentLoaded, then assert inside setTimeout(..., 0).
describe('Story 6.1 — preset grid DOM wiring', () => {
    let chrome;

    const VSC_CONSTS = require('../src/constants');
    const DEFAULTS = VSC_CONSTS.DEFAULT_SETTINGS.customPresets;

    /**
     * Build the full options-page DOM that the DOMContentLoaded handler queries,
     * including the 6 .preset-input elements and the reset button, plus all
     * elements the existing handler code also queries (speedInput, saveBtn,
     * status, perSiteList, the 4 toggle checkboxes, and accent markup).
     */
    function bootOptionsPageWithPresets() {
        document.body.innerHTML = `
            <input type="number" id="speedInput">
            <button id="saveBtn"></button>
            <div id="status"></div>
            <div id="perSiteList"></div>
            <input type="checkbox" id="hideShortsToggle">
            <input type="checkbox" id="hideCommentsToggle">
            <input type="checkbox" id="hideChatFullscreenToggle">
            <input type="checkbox" id="skipAdsToggle">
            <input type="number" class="preset-input" id="preset0" data-index="0">
            <input type="number" class="preset-input" id="preset1" data-index="1">
            <input type="number" class="preset-input" id="preset2" data-index="2">
            <input type="number" class="preset-input" id="preset3" data-index="3">
            <input type="number" class="preset-input" id="preset4" data-index="4">
            <input type="number" class="preset-input" id="preset5" data-index="5">
            <button type="button" id="resetPresetsBtn">Reset to defaults</button>
            <button type="button" class="accent-swatch" data-color="#e8590c"></button>
            <input type="color" id="accentColorInput">`;
        document.dispatchEvent(new Event('DOMContentLoaded'));
    }

    beforeEach(() => {
        chrome = setupChromeMock();
    });

    test('load-reflect: stored customPresets populate the 6 inputs', (done) => {
        const stored = [0.5, 0.75, 1.0, 1.5, 2.0, 3.0];
        chrome._setStorageData('customPresets', stored);
        bootOptionsPageWithPresets();
        setTimeout(() => {
            const inputs = document.querySelectorAll('.preset-input');
            expect(inputs.length).toBe(6);
            stored.forEach((val, i) => {
                expect(parseFloat(inputs[i].value)).toBe(val);
            });
            done();
        }, 0);
    });

    test('load-reflect: no stored customPresets shows DEFAULT_SETTINGS defaults', (done) => {
        // Nothing seeded in storage — must fall back to defaults.
        bootOptionsPageWithPresets();
        setTimeout(() => {
            const inputs = document.querySelectorAll('.preset-input');
            DEFAULTS.forEach((val, i) => {
                expect(parseFloat(inputs[i].value)).toBe(val);
            });
            done();
        }, 0);
    });

    test('clamp-on-save: value 9 is clamped to 4.0 and persisted for that slot', (done) => {
        bootOptionsPageWithPresets();
        setTimeout(() => {
            const inputs = document.querySelectorAll('.preset-input');
            // Set the first input to an out-of-range value and fire 'change'.
            inputs[0].value = '9';
            inputs[0].dispatchEvent(new Event('change'));
            // The clamped value should be reflected back onto the input.
            expect(parseFloat(inputs[0].value)).toBe(4.0);
            // The persisted array must also have the clamped value at index 0.
            const lastSet = chrome.storage.sync.set.mock.calls.slice(-1)[0][0];
            expect(lastSet.customPresets[0]).toBe(4.0);
            done();
        }, 0);
    });

    test('clamp-on-save: non-numeric entry reverts to the prior value for that slot', (done) => {
        const stored = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
        chrome._setStorageData('customPresets', stored);
        bootOptionsPageWithPresets();
        setTimeout(() => {
            const inputs = document.querySelectorAll('.preset-input');
            // Slot 2 was loaded as 1.0; set it to non-numeric and fire 'change'.
            inputs[2].value = 'abc';
            inputs[2].dispatchEvent(new Event('change'));
            // The input must revert (the fallback for a non-numeric slot when its
            // displayed value is also non-parseable is DEFAULT_SETTINGS.customPresets[2] = 1.0).
            expect(parseFloat(inputs[2].value)).toBe(1.0);
            // Nothing invalid must be persisted.
            const lastSet = chrome.storage.sync.set.mock.calls.slice(-1)[0][0];
            expect(isFinite(lastSet.customPresets[2])).toBe(true);
            done();
        }, 0);
    });

    test('reset: clicking reset button persists DEFAULT_SETTINGS.customPresets', (done) => {
        // Seed custom presets so we test the BEFORE→AFTER transition.
        chrome._setStorageData('customPresets', [0.3, 0.6, 0.9, 1.2, 1.8, 3.5]);
        bootOptionsPageWithPresets();
        setTimeout(() => {
            const btn = document.getElementById('resetPresetsBtn');
            btn.dispatchEvent(new Event('click'));
            // All 6 inputs must show the default values.
            const inputs = document.querySelectorAll('.preset-input');
            DEFAULTS.forEach((val, i) => {
                expect(parseFloat(inputs[i].value)).toBe(val);
            });
            // Storage must have been written with the defaults.
            const lastSet = chrome.storage.sync.set.mock.calls.slice(-1)[0][0];
            expect(lastSet.customPresets).toEqual(DEFAULTS);
            done();
        }, 0);
    });

    test('null guard: bootOptionsPage with no preset markup still passes (no throw)', (done) => {
        // Omit all .preset-input elements — null guards in options.js must fire silently.
        document.body.innerHTML = `
            <input type="number" id="speedInput">
            <button id="saveBtn"></button>
            <div id="status"></div>
            <div id="perSiteList"></div>
            <input type="checkbox" id="hideShortsToggle">
            <input type="checkbox" id="hideCommentsToggle">
            <input type="checkbox" id="hideChatFullscreenToggle">
            <input type="checkbox" id="skipAdsToggle">`;
        expect(() => {
            document.dispatchEvent(new Event('DOMContentLoaded'));
        }).not.toThrow();
        done();
    });
});

describe('Story 3.7 — removePerSiteEntry (per-site preset removal)', () => {
    test('removes the specified domain and returns a new object', () => {
        const input = { 'youtube.com': 2.0, 'netflix.com': 1.5 };
        const result = removePerSiteEntry(input, 'youtube.com');
        expect(result).toEqual({ 'netflix.com': 1.5 });
    });

    test('does not mutate the original object', () => {
        const input = { 'youtube.com': 2.0, 'netflix.com': 1.5 };
        removePerSiteEntry(input, 'youtube.com');
        expect(input).toEqual({ 'youtube.com': 2.0, 'netflix.com': 1.5 });
    });

    test('returns an empty object when the last entry is removed', () => {
        const input = { 'youtube.com': 1.75 };
        const result = removePerSiteEntry(input, 'youtube.com');
        expect(result).toEqual({});
    });

    test('returns a copy of the object unchanged when the domain is not present', () => {
        const input = { 'netflix.com': 1.5 };
        const result = removePerSiteEntry(input, 'youtube.com');
        expect(result).toEqual({ 'netflix.com': 1.5 });
        // Must still be a new object, not the same reference
        expect(result).not.toBe(input);
    });

    test('handles an empty perSiteSpeeds object gracefully', () => {
        const result = removePerSiteEntry({}, 'youtube.com');
        expect(result).toEqual({});
    });
});

describe('setPerSiteEntry (per-site preset edit)', () => {
    const { SPEED_MIN, SPEED_MAX } = require('../src/constants');

    test('updates an existing domain to a new sanitized speed (new object)', () => {
        const input = { 'youtube.com': 2.0, 'netflix.com': 1.5 };
        const result = setPerSiteEntry(input, 'youtube.com', '1.25');
        expect(result).toEqual({ 'youtube.com': 1.25, 'netflix.com': 1.5 });
    });

    test('adds a new domain when not already present', () => {
        const result = setPerSiteEntry({ 'netflix.com': 1.5 }, 'youtube.com', 3);
        expect(result).toEqual({ 'netflix.com': 1.5, 'youtube.com': 3 });
    });

    test('does not mutate the original object', () => {
        const input = { 'youtube.com': 2.0 };
        setPerSiteEntry(input, 'youtube.com', 1.1);
        expect(input).toEqual({ 'youtube.com': 2.0 });
    });

    test('clamps above SPEED_MAX down to the ceiling', () => {
        const result = setPerSiteEntry({}, 'youtube.com', 99);
        expect(result['youtube.com']).toBe(SPEED_MAX);
    });

    test('clamps below SPEED_MIN up to the floor', () => {
        const result = setPerSiteEntry({}, 'youtube.com', 0);
        expect(result['youtube.com']).toBe(SPEED_MIN);
    });

    test('rounds to 0.01 precision', () => {
        const result = setPerSiteEntry({}, 'youtube.com', 1.239);
        expect(result['youtube.com']).toBe(1.24);
    });

    test('non-finite value leaves the entry unchanged (copy, no corruption)', () => {
        const input = { 'youtube.com': 2.0 };
        const result = setPerSiteEntry(input, 'youtube.com', 'nope');
        expect(result).toEqual({ 'youtube.com': 2.0 });
        expect(result).not.toBe(input);
    });
});

// ---- Story 6.4: Theme preference selector in options (FR-13) ----
//
// The popup CONSUMER (applyThemePreference + popup.js bootstrap) shipped in
// Wave 3; this story adds the options-side selector that persists `theme`.
// jsdom DOMContentLoaded re-dispatch pattern (same as Story 4.3/6.6 above).

describe('Story 6.4 — theme selector DOM wiring', () => {
    let chrome;

    function bootOptionsPageWithTheme(initialTheme) {
        if (initialTheme !== undefined) chrome._setStorageData('theme', initialTheme);
        document.body.innerHTML = `
            <input type="number" id="speedInput">
            <button id="saveBtn"></button>
            <div id="status"></div>
            <div id="perSiteList"></div>
            <select id="themeSelect">
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="auto">Auto</option>
            </select>`;
        document.dispatchEvent(new Event('DOMContentLoaded'));
    }

    beforeEach(() => {
        chrome = setupChromeMock();
    });

    test('reflects the stored theme on load', (done) => {
        bootOptionsPageWithTheme('dark');
        setTimeout(() => {
            expect(document.getElementById('themeSelect').value).toBe('dark');
            done();
        }, 0);
    });

    test('defaults the selector to "auto" when nothing is stored', (done) => {
        bootOptionsPageWithTheme(undefined);
        setTimeout(() => {
            expect(document.getElementById('themeSelect').value).toBe('auto');
            done();
        }, 0);
    });

    test('selecting a theme persists it to chrome.storage.sync', (done) => {
        bootOptionsPageWithTheme(undefined);
        setTimeout(() => {
            const sel = document.getElementById('themeSelect');
            sel.value = 'dark';
            sel.dispatchEvent(new Event('change'));
            const lastSet = chrome.storage.sync.set.mock.calls.slice(-1)[0][0];
            expect(lastSet).toEqual({ theme: 'dark' });
            done();
        }, 0);
    });

    test('the auto->dark->auto transition persists each change', (done) => {
        // Reversible-state coverage (memory test-the-transition-not-steady-state).
        bootOptionsPageWithTheme('auto');
        setTimeout(() => {
            const sel = document.getElementById('themeSelect');
            sel.value = 'dark';
            sel.dispatchEvent(new Event('change'));
            expect(chrome.storage.sync.set.mock.calls.slice(-1)[0][0]).toEqual({ theme: 'dark' });
            sel.value = 'auto';
            sel.dispatchEvent(new Event('change'));
            expect(chrome.storage.sync.set.mock.calls.slice(-1)[0][0]).toEqual({ theme: 'auto' });
            done();
        }, 0);
    });
});
