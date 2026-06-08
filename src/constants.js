/**
 * constants.js — single source of truth for Tach's cross-file constants.
 *
 * ADR-002 update (supersedes the old "duplicate verbatim" rule): Tach has no
 * bundler, but the speed range and the Story 3.1 settings schema used to be COPIED
 * into content.js / content-youtube.js / popup.js / options.js and were drift-prone
 * (and one copy — `const DEFAULT_SETTINGS` — actively broke the extension; see the
 * collision note below). They now live here once. This file is loaded FIRST in
 * every context:
 *   - content scripts: listed first in each manifest `content_scripts[].js` array
 *   - popup / options pages: <script src="../constants.js"> before their own script
 *   - Node tests: require('./constants') / require('../constants')
 *
 * WHY THE IIFE + `self.VSC` (not a bare top-level `const`):
 * On a YouTube watch page BOTH content.js and content-youtube.js inject into the
 * SAME isolated world, which shares ONE global lexical scope. A bare top-level
 * `const` in two co-injected files (or here, injected twice via two matching
 * content_scripts entries) throws "Identifier 'X' has already been declared",
 * which aborts the WHOLE second script. This IIFE leaks no lexical binding, and it
 * sets `self.VSC` idempotently, so being injected twice on YouTube is harmless.
 * (content-youtube.js is likewise wrapped in an IIFE for the same reason.)
 */
(function () {
    'use strict';

    // Allowed playback-speed range (inclusive) and the +/- button / hotkey step.
    // Floor is 0.01 (fine precision on the popup slider/input/presets — FR-3/FR-12); the coarse
    // Deliberately different step granularities (see each constant):
    //   - the slider DRAG snaps to the coarse SPEED_SLIDER_DRAG_STEP (0.25) grid
    //     via snapToSliderDragStep — big quick moves (0.25/0.5/0.75/1.0…);
    //   - the +/- buttons move on the finer SPEED_SLIDER_STEP (0.05) grid via
    //     snapToSliderStep, with the SPEED_MIN (0.01) floor reachable below the
    //     grid (…0.10 → 0.05 → 0.01). The slider's HTML `step` is 0.01 (NOT 0.05
    //     or 0.25) so it can HOLD the +/- fine values plus the 0.01 floor — a
    //     coarse-step input is offset by the 0.01 min and would re-sanitize
    //     values off the grid;
    //   - the hotkeys and the "Faster" button keep the coarser SPEED_STEP (0.1)
    //     grid via snapToStep (0.01 everywhere would be ~400 clicks).
    var SPEED_MIN = 0.01;
    var SPEED_MAX = 4.0;
    var SPEED_STEP = 0.1;
    var SPEED_SLIDER_STEP = 0.05;
    // Coarse grid the slider DRAG snaps to (the +/- buttons stay on 0.05).
    var SPEED_SLIDER_DRAG_STEP = 0.25;

    /**
     * Snap a speed to the 0.1 button-step grid, clamped to [SPEED_MIN, SPEED_MAX].
     *
     * The +/- buttons and the increase/decrease hotkeys run their result through
     * this so coarse stepping always lands on clean values (…, 0.1, 0.2, 0.3,
     * 1.0, …). SPEED_MIN (0.01) sits BELOW the grid: stepping down from 0.1 lands
     * on the 0.01 floor, and stepping up from the floor snaps back onto the 0.1
     * grid. It also re-aligns an off-grid value the fine slider (0.01 step) may
     * have produced. Returns NaN for non-numeric input so callers can treat it
     * as "no change".
     */
    function snapToStep(value) {
        var v = parseFloat(value);
        if (isNaN(v)) return NaN;
        var snapped = Math.round(v / SPEED_STEP) * SPEED_STEP;
        snapped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, snapped));
        return Math.round(snapped * 100) / 100; // kill floating-point dust
    }

    /**
     * Clamp a speed to [SPEED_MIN, SPEED_MAX] and round to 0.01 precision. Used
     * by snapToSliderStep (after it rounds to the 0.05 grid) to clamp to the
     * floor/ceiling and kill floating-point dust, and as a general "sanitize a
     * raw speed to the valid range at full 0.01 precision" helper. Returns NaN
     * for non-numeric input so callers can treat it as "no change".
     */
    function clampSpeed(value) {
        var v = parseFloat(value);
        if (isNaN(v)) return NaN;
        var c = Math.min(SPEED_MAX, Math.max(SPEED_MIN, v));
        return Math.round(c * 100) / 100; // kill floating-point dust
    }

    /**
     * Snap a dragged slider value to the SPEED_SLIDER_STEP (0.05) grid, clamped
     * to [SPEED_MIN, SPEED_MAX]. The slider's HTML step is 0.01 (so it can hold
     * the +/- buttons' fine values), so the coarse 0.05 "feel" of the drag is
     * produced here instead. Rounding to the 0.05 grid also makes clean values
     * (1.0, 1.5, 2.0 …) reachable by dragging — a raw 0.05-step <input> with a
     * 0.01 min would land on 1.01/1.51 instead. Returns NaN for non-numeric
     * input so callers can treat it as "no change".
     */
    function snapToSliderStep(value) {
        var v = parseFloat(value);
        if (isNaN(v)) return NaN;
        return clampSpeed(Math.round(v / SPEED_SLIDER_STEP) * SPEED_SLIDER_STEP);
    }

    /**
     * Snap a DRAGGED slider value to the coarse SPEED_SLIDER_DRAG_STEP (0.25)
     * grid (0.25/0.5/0.75/1.0…), clamped to [SPEED_MIN, SPEED_MAX]. Used by the
     * slider drag only — the +/- buttons use the finer snapToSliderStep (0.05).
     * Returns NaN for non-numeric input so callers can treat it as "no change".
     */
    function snapToSliderDragStep(value) {
        var v = parseFloat(value);
        if (isNaN(v)) return NaN;
        return clampSpeed(Math.round(v / SPEED_SLIDER_DRAG_STEP) * SPEED_SLIDER_DRAG_STEP);
    }

    // ---- Story 6.6: Accent-color WCAG helpers (inside IIFE — no global leak) ----

    /**
     * Parse a 6-digit hex string into { r, g, b } integer channels.
     * Returns null for invalid input; callers must guard.
     * @param {string} hex - e.g. '#e8590c' or 'e8590c'
     * @returns {{r:number, g:number, b:number}|null}
     */
    function hexToRgb(hex) {
        var h = hex.replace('#', '');
        if (h.length !== 6) return null;
        var r = parseInt(h.slice(0, 2), 16);
        var g = parseInt(h.slice(2, 4), 16);
        var b = parseInt(h.slice(4, 6), 16);
        if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
        return { r: r, g: g, b: b };
    }

    /**
     * Encode { r, g, b } integer channels to a 6-digit lowercase hex string
     * with leading '#'. Clamps each channel to [0, 255].
     * @param {{r:number, g:number, b:number}} rgb
     * @returns {string}
     */
    function rgbToHex(rgb) {
        function ch(v) {
            return ('0' + Math.min(255, Math.max(0, Math.round(v))).toString(16)).slice(-2);
        }
        return '#' + ch(rgb.r) + ch(rgb.g) + ch(rgb.b);
    }

    /**
     * Compute the WCAG relative luminance of a hex color.
     * Formula: L = 0.2126R + 0.7152G + 0.0722B where each channel is linearized.
     * @param {string} hex
     * @returns {number} Luminance in [0, 1]
     */
    function luminance(hex) {
        var rgb = hexToRgb(hex);
        if (!rgb) return 0;
        function lin(c) {
            var cs = c / 255;
            return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
        }
        return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
    }

    /**
     * Compute the WCAG contrast ratio between two hex colors.
     * @param {string} hex1
     * @param {string} hex2
     * @returns {number} Contrast ratio >= 1
     */
    function wcagContrast(hex1, hex2) {
        var l1 = luminance(hex1);
        var l2 = luminance(hex2);
        var hi = Math.max(l1, l2);
        var lo = Math.min(l1, l2);
        return (hi + 0.05) / (lo + 0.05);
    }

    /**
     * Return a 6-digit hex that is STRICTLY darker than the input by scaling
     * each RGB channel by 0.82 and clamping. Used as the white-on-fill button
     * hover shade (see constraint memory popup-primary-button-contrast-fail).
     * @param {string} hex - 6-digit hex color e.g. '#e8590c'
     * @returns {string}
     */
    function deriveAccentHover(hex) {
        var rgb = hexToRgb(hex);
        if (!rgb) return hex;
        return rgbToHex({ r: rgb.r * 0.82, g: rgb.g * 0.82, b: rgb.b * 0.82 });
    }

    /**
     * Return { fill, text } with WCAG AA contrast (>= 4.5:1) between fill and
     * text. Works for any accent including light colors like '#ffd400'/'#ffffff'.
     * Strategy:
     *   1. Try white text on deriveAccentHover(hex). If >= 4.5 → done.
     *   2. Iteratively darken fill ×0.75 per round (up to 10 rounds) for white.
     *   3. If white never reaches 4.5:1, flip text to '#0d1117' on deriveAccentHover(hex).
     * @param {string} hex - 6-digit hex accent color
     * @returns {{ fill: string, text: '#ffffff'|'#0d1117' }}
     */
    function ensureAccentContrast(hex) {
        var fill = deriveAccentHover(hex);
        var WHITE = '#ffffff';
        var DARK = '#0d1117';

        // Step 1: try white text on the hover shade.
        if (wcagContrast(fill, WHITE) >= 4.5) {
            return { fill: fill, text: WHITE };
        }

        // Step 2: iteratively darken the fill until white text passes.
        var rgb = hexToRgb(fill);
        if (!rgb) return { fill: fill, text: DARK };
        var r = rgb.r, g = rgb.g, b = rgb.b;
        for (var i = 0; i < 10; i++) {
            r *= 0.75; g *= 0.75; b *= 0.75;
            var darker = rgbToHex({ r: r, g: g, b: b });
            if (wcagContrast(darker, WHITE) >= 4.5) {
                return { fill: darker, text: WHITE };
            }
        }

        // Step 3: white never reached 4.5:1 — flip to dark text on hover shade.
        return { fill: deriveAccentHover(hex), text: DARK };
    }

    /**
     * Set CSS custom properties on el.style for the accent color:
     *   --primary-color  → hex (the raw accent)
     *   --primary-hover  → deriveAccentHover(hex) (darker shade for fills)
     *   --on-accent      → ensureAccentContrast(hex).text (white or dark)
     * @param {Element} el  - Target DOM element (e.g. document.documentElement)
     * @param {string}  hex - 6-digit hex accent color
     */
    function applyAccentColor(el, hex) {
        if (!el || !hex) return;
        el.style.setProperty('--primary-color', hex);
        el.style.setProperty('--primary-hover', deriveAccentHover(hex));
        el.style.setProperty('--on-accent', ensureAccentContrast(hex).text);
    }

    /**
     * Story 6.3 (FR-13) — apply the user's theme preference to a root element so
     * popup.css can render light/dark. The CSS carries the dark palette under BOTH
     * `[data-theme="dark"]` (explicit override) and `@media (prefers-color-scheme:
     * dark)` (system). This helper bridges the stored `theme` setting to the
     * explicit-override attribute:
     *   - 'dark'  → set data-theme="dark"  (force dark over the system setting)
     *   - 'light' → set data-theme="light" (force light over the system setting)
     *   - 'auto' / anything else → REMOVE data-theme so the media query decides.
     * @param {Element} el    - Target DOM element (e.g. document.documentElement)
     * @param {string}  theme - 'light' | 'dark' | 'auto'
     */
    function applyThemePreference(el, theme) {
        if (!el) return;
        if (theme === 'dark' || theme === 'light') {
            el.setAttribute('data-theme', theme);
        } else {
            el.removeAttribute('data-theme');
        }
    }

    var VSC = {
        SPEED_MIN: SPEED_MIN,
        SPEED_MAX: SPEED_MAX,
        // Coarse step for the increase/decrease hotkeys and the "Faster" button.
        SPEED_STEP: SPEED_STEP,
        // Grid the slider drag AND the +/- buttons snap to (0.05).
        SPEED_SLIDER_STEP: SPEED_SLIDER_STEP,
        SPEED_SLIDER_DRAG_STEP: SPEED_SLIDER_DRAG_STEP,
        snapToStep: snapToStep,
        clampSpeed: clampSpeed,
        snapToSliderStep: snapToSliderStep,
        snapToSliderDragStep: snapToSliderDragStep,

        // NFR-SC2 cap on perSiteSpeeds growth (oldest insertion-order entries are
        // pruned beyond this).
        MAX_PER_SITE_ENTRIES: 100,

        // Canonical settings schema (Story 3.1). The single definition every
        // settings reader resolves a stored object against.
        DEFAULT_SETTINGS: {
            defaultPlaybackSpeed: 1.0,
            // FR-19: target speed the popup's [ REDLINE ] button jumps to (overdrive).
            // User-configurable in options; clicking REDLINE while already at/above
            // it steps further up the 0.25 grid.
            redlineSpeed: 2.0,
            perSiteSpeeds: {},
            customPresets: [0.5, 0.75, 1.0, 1.25, 1.5, 2.0],
            hideShorts: false,
            hideComments: false,
            // FR-22: YouTube-only: suppress the live/premiere chat panel in FULLSCREEN
            // (it auto-appears and persists into fullscreen). Defaults ON — this
            // is the one cleanup behavior that ships enabled, by user request
            // ("never show in fullscreen automatically"); flip it off to keep
            // chat in fullscreen. Windowed chat is never touched by this key.
            hideChatFullscreen: true,
            // FR-21: YouTube-only: auto-skip ads by seeking the ad <video> to its end
            // (the only mechanism that works — maxing playbackRate is reset and
            // the skip button rejects synthetic clicks; see the 2026-06-06
            // feasibility spike). Defaults OFF — opt-in, Web Store caution.
            skipAds: false,
            theme: 'auto',
            // Story 6.6 (FR-20): user-settable UI accent color. Single source —
            // do NOT re-declare this elsewhere. #9D4EDD = Domdhi.OS Deep Amethyst
            // (the SYSTEM/core gem) — the shipped default + owner's reserved color.
            // Deliberately NOT one of the options swatches (the five public gems
            // live there); reachable only via the custom color input.
            accentColor: '#9D4EDD',
        },

        // ---- Story 6.6: Accent-color helpers ----
        // Internal sRGB luminance helpers (local to the IIFE — no global leak).
        // Exposed on VSC so tests can call them; popup/options call applyAccentColor.

        /**
         * Return a 6-digit lowercase hex string (e.g. '#c24a0a') that is
         * STRICTLY darker than the input hex. Scales each RGB channel by 0.82
         * and clamps. Used as the white-on-fill button hover shade, and as the
         * WCAG-safe fill baseline for ensureAccentContrast.
         *
         * @param {string} hex - 6-digit hex color string e.g. '#e8590c'
         * @returns {string} Darker 6-digit hex string.
         */
        deriveAccentHover: deriveAccentHover,

        /**
         * Return { fill, text } such that the WCAG AA sRGB contrast ratio
         * between fill and text is >= 4.5:1. Works for any accent including
         * light colors like '#ffd400' and '#ffffff'.
         *
         * Strategy:
         *  1. Try white text on deriveAccentHover(hex). If ratio >= 4.5 → done.
         *  2. If not, iteratively darken the fill (×0.75 each round, up to 10
         *     rounds) until white text reaches 4.5:1.
         *  3. If white never reaches 4.5:1 (fill would go black), flip text to
         *     '#0d1117' and use deriveAccentHover(hex) as fill.
         *
         * @param {string} hex - 6-digit hex accent color
         * @returns {{ fill: string, text: '#ffffff'|'#0d1117' }}
         */
        ensureAccentContrast: ensureAccentContrast,

        /**
         * Set the CSS custom properties for the accent color on a DOM element.
         * Sets --primary-color, --primary-hover, and --on-accent.
         *
         * @param {Element} el  - Target DOM element (e.g. document.documentElement)
         * @param {string}  hex - 6-digit hex accent color
         */
        applyAccentColor: applyAccentColor,

        /**
         * Apply the theme preference (light/dark/auto) to a root element by
         * toggling the [data-theme] override attribute. 'auto' removes it so the
         * prefers-color-scheme media query governs. See Story 6.3 (FR-13).
         *
         * @param {Element} el    - Target DOM element (e.g. document.documentElement)
         * @param {string}  theme - 'light' | 'dark' | 'auto'
         */
        applyThemePreference: applyThemePreference,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = VSC;                       // Node (jest tests)
    } else if (typeof self !== 'undefined') {
        self.VSC = self.VSC || VSC;                 // content scripts / pages / SW
    } else if (typeof globalThis !== 'undefined') {
        globalThis.VSC = globalThis.VSC || VSC;     // fallback
    }
})();
