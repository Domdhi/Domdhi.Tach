/**
 * Unit tests for constants.js — the single source of truth for shared constants
 * and the snapToStep helper that keeps coarse stepping on the 0.1 grid.
 *
 * Also contains schema-parity tests (Fix 4): for every key in DEFAULT_SETTINGS,
 * both content.js and content-youtube.js resolveSettings({}) must return a
 * defined value. This locks the redlineSpeed-class omission pattern going forward.
 */
const VSC = require('../src/constants');

// Schema-parity requires the content scripts, which need chrome + MutationObserver
// at module load time. Set those up before requiring either content module.
const { setupChromeMock } = require('./chrome-mock');
setupChromeMock();
global.MutationObserver = global.MutationObserver || class {
    constructor(callback) { this._callback = callback; }
    observe() {}
    disconnect() {}
};

const { resolveSettings: resolveSettingsContent } = require('../src/content');
const ytModule = require('../src/content-youtube');

describe('constants.js — shared values', () => {
    test('SPEED_MIN is the 0.01 floor', () => {
        expect(VSC.SPEED_MIN).toBe(0.01);
    });
    test('SPEED_MAX is 4.0', () => {
        expect(VSC.SPEED_MAX).toBe(4.0);
    });
    test('SPEED_STEP is the 0.1 coarse step (hotkeys + Faster)', () => {
        expect(VSC.SPEED_STEP).toBe(0.1);
    });
    test('SPEED_SLIDER_STEP is the 0.05 grid (the +/- buttons)', () => {
        expect(VSC.SPEED_SLIDER_STEP).toBe(0.05);
    });
    test('SPEED_SLIDER_DRAG_STEP is the 0.25 grid (slider drag)', () => {
        expect(VSC.SPEED_SLIDER_DRAG_STEP).toBe(0.25);
    });
    test('DEFAULT_SETTINGS carries the Story 3.1 schema', () => {
        expect(VSC.DEFAULT_SETTINGS).toEqual({
            defaultPlaybackSpeed: 1.0,
            redlineSpeed: 2.0,
            perSiteSpeeds: {},
            customPresets: [0.5, 0.75, 1.0, 1.25, 1.5, 2.0],
            hideShorts: false,
            hideComments: false,
            hideChatFullscreen: true,
            skipAds: false,
            theme: 'auto',
            accentColor: '#9D4EDD',
        });
    });
    test('MAX_PER_SITE_ENTRIES is 100', () => {
        expect(VSC.MAX_PER_SITE_ENTRIES).toBe(100);
    });
});

describe('snapToStep — coarse stepping stays on the 0.1 grid', () => {
    const snap = VSC.snapToStep;

    test('stepping + up from the 0.01 floor snaps onto the 0.1 grid', () => {
        // 0.01 + 0.1 = 0.11 → nearest 0.1 grid point is 0.1
        expect(snap(0.01 + 0.1)).toBe(0.1);
    });

    test('stepping − down from 0.1 lands on the 0.01 floor', () => {
        // 0.1 - 0.1 = 0 → clamps up to the 0.01 floor
        expect(snap(0.1 - 0.1)).toBe(0.01);
    });

    test('on-grid stepping is unchanged (1.0 ± 0.1)', () => {
        expect(snap(1.0 + 0.1)).toBe(1.1);
        expect(snap(1.0 - 0.1)).toBe(0.9);
    });

    test('walks a clean grid up from the floor', () => {
        // 0.01 → 0.1 → 0.2 → 0.3 → 0.4
        let v = 0.01;
        const seen = [];
        for (let i = 0; i < 4; i++) { v = snap(v + 0.1); seen.push(v); }
        expect(seen).toEqual([0.1, 0.2, 0.3, 0.4]);
    });

    test('clamps to SPEED_MAX and the SPEED_MIN floor', () => {
        expect(snap(4.0 + 0.1)).toBe(4.0);
        expect(snap(0.01 - 0.1)).toBe(0.01);
    });

    test('re-aligns an off-grid (slider 0.01) value onto the 0.1 grid', () => {
        expect(snap(1.16)).toBe(1.2); // 1.16 → nearest 0.1 grid
    });

    test('produces no floating-point dust', () => {
        // 0.1 + 0.2 in JS is 0.30000000000000004 — snap must return exactly 0.3.
        expect(snap(0.1 + 0.2)).toBe(0.3);
        expect(snap(0.65)).toBe(0.7);
    });

    test('returns NaN for non-numeric input (caller treats as no-change)', () => {
        expect(Number.isNaN(snap('nope'))).toBe(true);
        expect(Number.isNaN(snap(NaN))).toBe(true);
    });
});

describe('clampSpeed — sanitizes a raw speed to range at full 0.01 precision', () => {
    const clamp = VSC.clampSpeed;

    test('preserves a 0.01-precision value (no grid snap)', () => {
        // Unlike snapToStep, clampSpeed keeps fine values: 1.07 stays 1.07.
        expect(clamp(1.07)).toBe(1.07);
        expect(VSC.snapToStep(1.07)).toBe(1.1); // contrast: coarse snaps
    });

    test('rounds to 0.01, not to any coarser grid', () => {
        expect(clamp(1.02)).toBe(1.02);
    });

    test('clamps to SPEED_MAX and the SPEED_MIN floor', () => {
        expect(clamp(4.0 + 0.01)).toBe(4.0);
        expect(clamp(0.01 - 0.01)).toBe(0.01);
    });

    test('produces no floating-point dust', () => {
        // 1.1 - 0.01 = 1.0899999999999999 in JS — must round to 1.09.
        expect(clamp(1.1 - 0.01)).toBe(1.09);
    });

    test('returns NaN for non-numeric input (caller treats as no-change)', () => {
        expect(Number.isNaN(clamp('nope'))).toBe(true);
        expect(Number.isNaN(clamp(NaN))).toBe(true);
    });
});

describe('snapToSliderStep — slider drags snap to the clean 0.05 grid', () => {
    const snap = VSC.snapToSliderStep;

    test('rounds to the nearest 0.05 multiple', () => {
        expect(snap(1.02)).toBe(1.0);
        expect(snap(1.03)).toBe(1.05);
        expect(snap(1.51)).toBe(1.5);
        expect(snap(1.06)).toBe(1.05);
    });

    test('clean round speeds are reachable (unlike a raw 0.05-step/0.01-min input)', () => {
        expect(snap(1.0)).toBe(1.0);
        expect(snap(1.5)).toBe(1.5);
        expect(snap(2.0)).toBe(2.0);
    });

    test('clamps to the SPEED_MIN floor and SPEED_MAX ceiling', () => {
        // Snapping near 0 rounds to 0 → clamped up to the 0.01 floor.
        expect(snap(0.01)).toBe(0.01);
        expect(snap(0.03)).toBe(0.05); // first clean grid point above the floor
        expect(snap(4.0)).toBe(4.0);
        expect(snap(5.0)).toBe(4.0);
    });

    test('produces no floating-point dust', () => {
        expect(snap(0.35)).toBe(0.35);
        expect(snap(1.1)).toBe(1.1);
    });

    test('returns NaN for non-numeric input (caller treats as no-change)', () => {
        expect(Number.isNaN(snap('nope'))).toBe(true);
        expect(Number.isNaN(snap(NaN))).toBe(true);
    });
});

describe('snapToSliderDragStep — slider DRAG snaps to the coarse 0.25 grid', () => {
    const snap = VSC.snapToSliderDragStep;

    test('rounds to the nearest 0.25 multiple', () => {
        expect(snap(1.1)).toBe(1.0);  // 0.05 grid would keep 1.10
        expect(snap(1.13)).toBe(1.25);
        expect(snap(1.4)).toBe(1.5);  // 0.05 grid would keep 1.40
        expect(snap(0.6)).toBe(0.5);
    });

    test('clean 0.25 speeds are reachable by dragging', () => {
        expect(snap(0.25)).toBe(0.25);
        expect(snap(0.75)).toBe(0.75);
        expect(snap(1.25)).toBe(1.25);
        expect(snap(2.0)).toBe(2.0);
    });

    test('clamps to the SPEED_MIN floor and SPEED_MAX ceiling', () => {
        expect(snap(0.05)).toBe(0.01); // rounds to 0 → clamped up to the floor
        expect(snap(4.0)).toBe(4.0);
        expect(snap(5.0)).toBe(4.0);
    });

    test('returns NaN for non-numeric input (caller treats as no-change)', () => {
        expect(Number.isNaN(snap('nope'))).toBe(true);
        expect(Number.isNaN(snap(NaN))).toBe(true);
    });
});

describe('applyThemePreference — explicit override vs auto (Story 6.3 plumbing)', () => {
    const apply = VSC.applyThemePreference;

    test('explicit "dark" sets data-theme="dark"', () => {
        const el = document.createElement('div');
        apply(el, 'dark');
        expect(el.getAttribute('data-theme')).toBe('dark');
    });

    test('explicit "light" sets data-theme="light"', () => {
        const el = document.createElement('div');
        apply(el, 'light');
        expect(el.getAttribute('data-theme')).toBe('light');
    });

    test('"auto" removes data-theme so prefers-color-scheme governs', () => {
        const el = document.createElement('div');
        el.setAttribute('data-theme', 'dark'); // pre-existing override
        apply(el, 'auto');
        expect(el.hasAttribute('data-theme')).toBe(false);
    });

    test('the ON->OFF transition: dark then auto clears the override', () => {
        // Reversible-state test (memory test-the-transition-not-steady-state):
        // applying dark then auto must leave NO override, not a stale data-theme.
        const el = document.createElement('div');
        apply(el, 'dark');
        expect(el.getAttribute('data-theme')).toBe('dark');
        apply(el, 'auto');
        expect(el.hasAttribute('data-theme')).toBe(false);
    });

    test('null element is a safe no-op', () => {
        expect(() => apply(null, 'dark')).not.toThrow();
    });
});

// ===================================================================
// Fix 4 — Schema-parity: both content scripts' resolveSettings must
// return a defined value for every key in VSC.DEFAULT_SETTINGS.
//
// Approach: assert over all DEFAULT_SETTINGS keys. Both content.js and
// content-youtube.js are responsible for the same full schema (they
// carry mirrored resolveSettings to avoid a bundler). If a key is
// added to DEFAULT_SETTINGS but omitted from either resolveSettings,
// this test turns red immediately.
//
// Note: content.js exports resolveSettings directly; content-youtube.js
// exports it as ytModule.resolveSettings (the module is `yt` in its own
// test suite). Both are required at the top of this file.
// ===================================================================

describe('Schema-parity — resolveSettings covers all DEFAULT_SETTINGS keys', () => {
    const defaultKeys = Object.keys(VSC.DEFAULT_SETTINGS);

    test('content.js resolveSettings({}) returns a defined value for every DEFAULT_SETTINGS key', () => {
        const resolved = resolveSettingsContent({});
        for (const key of defaultKeys) {
            expect(resolved[key]).not.toBeUndefined();
        }
    });

    test('content-youtube.js resolveSettings({}) returns a defined value for every DEFAULT_SETTINGS key', () => {
        const resolved = ytModule.resolveSettings({});
        for (const key of defaultKeys) {
            expect(resolved[key]).not.toBeUndefined();
        }
    });

    test('both resolveSettings produce the same keys as DEFAULT_SETTINGS (no extras, no missing)', () => {
        const contentKeys = Object.keys(resolveSettingsContent({})).sort();
        const ytKeys = Object.keys(ytModule.resolveSettings({})).sort();
        const schemaKeys = defaultKeys.slice().sort();
        expect(contentKeys).toEqual(schemaKeys);
        expect(ytKeys).toEqual(schemaKeys);
    });
});
