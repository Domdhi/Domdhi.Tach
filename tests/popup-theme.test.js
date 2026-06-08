/**
 * tests/popup-theme.test.js — Story 6.3 (FR-13): Dark theme for the popup.
 *
 * Two test groups:
 *
 * 1. applyThemePreference contract (DOM behaviour)
 *    VSC.applyThemePreference is the runtime bridge between the stored theme
 *    setting and the CSS selectors. The dark/light CSS palette keys off
 *    [data-theme] on <html>, so this contract must be exact.
 *    Includes: steady-state (dark, light, auto) and the ON→OFF transition
 *    (dark then auto) to guard that reversing the override leaves NO attribute.
 *
 * 2. Static source assertions on the CSS
 *    jsdom does not evaluate media queries, so computed colours are not
 *    testable here. Instead we read the raw CSS and assert that the required
 *    selectors and dark token values exist — proving the palette is wired and
 *    neither path is a no-op. The design-token palette was extracted into the
 *    shared ../theme.css (linked before popup.css), so palette assertions read
 *    theme.css; the component rules (.btn-primary, .preset-btn.active) still
 *    live in popup.css and are asserted there.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const VSC = require('../src/constants');

// ---------------------------------------------------------------------------
// Group 1 — applyThemePreference contract in a DOM context
// ---------------------------------------------------------------------------
describe('VSC.applyThemePreference — data-theme attribute contract', () => {
    let el;

    beforeEach(() => {
        // Fresh element for each test — no cross-test state.
        el = document.createElement('html');
    });

    test('applying "dark" sets data-theme="dark"', () => {
        VSC.applyThemePreference(el, 'dark');
        expect(el.getAttribute('data-theme')).toBe('dark');
    });

    test('applying "light" sets data-theme="light"', () => {
        VSC.applyThemePreference(el, 'light');
        expect(el.getAttribute('data-theme')).toBe('light');
    });

    test('applying "auto" removes any existing data-theme attribute', () => {
        // Start with an attribute present so we test removal, not just absence.
        el.setAttribute('data-theme', 'dark');
        VSC.applyThemePreference(el, 'auto');
        expect(el.hasAttribute('data-theme')).toBe(false);
    });

    test('applying an unknown value removes data-theme (treated as auto)', () => {
        el.setAttribute('data-theme', 'light');
        VSC.applyThemePreference(el, 'system');
        expect(el.hasAttribute('data-theme')).toBe(false);
    });

    // Memory pattern [test-the-transition-not-steady-state]: test the ON→OFF
    // transition, not only steady state. This guards that flipping from an
    // explicit override back to 'auto' leaves NO residual attribute — if it
    // did, the media query would be permanently suppressed.
    test('ON→OFF transition: dark then auto leaves NO data-theme attribute', () => {
        VSC.applyThemePreference(el, 'dark');
        expect(el.getAttribute('data-theme')).toBe('dark'); // precondition
        VSC.applyThemePreference(el, 'auto');
        expect(el.hasAttribute('data-theme')).toBe(false);
    });

    test('light then auto also removes data-theme', () => {
        VSC.applyThemePreference(el, 'light');
        expect(el.getAttribute('data-theme')).toBe('light'); // precondition
        VSC.applyThemePreference(el, 'auto');
        expect(el.hasAttribute('data-theme')).toBe(false);
    });

    test('dark then light switches attribute value (no removal in between)', () => {
        VSC.applyThemePreference(el, 'dark');
        VSC.applyThemePreference(el, 'light');
        expect(el.getAttribute('data-theme')).toBe('light');
    });

    test('null element is a no-op (does not throw)', () => {
        expect(() => VSC.applyThemePreference(null, 'dark')).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Group 2 — Static source assertions on popup.css
// ---------------------------------------------------------------------------
describe('theme.css / popup.css — dark palette source assertions (Story 6.3 / FR-13)', () => {
    let css;        // theme.css — the shared design-token palette (single source)
    let popupCss;   // popup.css — popup component styles

    beforeAll(() => {
        // Palette tokens were extracted to the shared theme.css.
        css = fs.readFileSync(path.join(__dirname, '..', 'src', 'theme.css'), 'utf-8');
        popupCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup', 'popup.css'), 'utf-8');
    });

    // --- structural selectors ---

    test('contains a prefers-color-scheme: dark media query', () => {
        expect(css).toMatch(/prefers-color-scheme\s*:\s*dark/);
    });

    test('system-dark rule scopes to :root:not([data-theme="light"]) so explicit light wins', () => {
        expect(css).toMatch(/:root:not\(\[data-theme="light"\]\)/);
    });

    test('contains an explicit [data-theme="dark"] selector for forced-dark override', () => {
        expect(css).toMatch(/\[data-theme="dark"\]/);
    });

    test('contains an explicit [data-theme="light"] selector for forced-light override (beats system dark)', () => {
        expect(css).toMatch(/\[data-theme="light"\]/);
    });

    // --- dark surface token values (Domdhi.OS terminal substrate) ---

    test('dark background token = obsidian void #020202 is present', () => {
        expect(css).toMatch(/#020202/i);
    });

    test('dark raised-card surface token = drawer #0a0a0a is present', () => {
        expect(css).toMatch(/#0a0a0a/i);
    });

    test('dark border token = white/16 wire-hard is present', () => {
        expect(css).toMatch(/rgba\(255,\s*255,\s*255,\s*0\.16\)/i);
    });

    test('dark text-primary phosphor white #ededed is present', () => {
        expect(css).toMatch(/#ededed/i);
    });

    test('dark text-secondary zinc-500 #71717a is present', () => {
        expect(css).toMatch(/#71717a/i);
    });

    // --- accent fallback tokens (Media violet) ---

    test('default accent --primary-color: #9D4EDD (System amethyst) is present', () => {
        expect(css).toMatch(/#9D4EDD/i);
    });

    test('dark accent hover --primary-hover: #b370e8 is present', () => {
        expect(css).toMatch(/#b370e8/i);
    });

    test('on-accent = void #020202 (dark text on neon fill) is present', () => {
        expect(css).toMatch(/--on-accent\s*:\s*#020202/i);
    });

    // --- CSS custom property names are actually assigned in the dark blocks ---

    test('--background is assigned obsidian void in the dark palette block', () => {
        expect(css).toMatch(/--background\s*:\s*#020202/i);
    });

    test('--surface is assigned drawer black in the dark palette block', () => {
        expect(css).toMatch(/--surface\s*:\s*#0a0a0a/i);
    });

    test('--text-primary is assigned phosphor white in the dark palette block', () => {
        expect(css).toMatch(/--text-primary\s*:\s*#ededed/i);
    });

    // --- preset-btn and btn-primary use var(--on-accent) for text ---
    // Wave 2 switched these; guard that they have NOT been reverted to a hardcoded colour.

    test('.preset-btn.active uses var(--on-accent) for text color', () => {
        // Find the .preset-btn.active block and assert it references --on-accent.
        expect(popupCss).toMatch(/\.preset-btn\.active[\s\S]*?color\s*:\s*var\(--on-accent\)/);
    });

    test('.btn-primary uses var(--on-accent) for text color', () => {
        expect(popupCss).toMatch(/\.btn-primary[\s\S]*?color\s*:\s*var\(--on-accent\)/);
    });
});
