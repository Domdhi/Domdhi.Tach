/**
 * Initialize the popup UI and set up event listeners (runs on DOMContentLoaded).
 *
 * Shared constants come from the single source constants.js — loaded in the popup
 * via <script src="../constants.js"> before this file, or require('../constants')
 * under Node tests. See constants.js for the ADR-002 single-source rationale.
 */

/* ============================================================
   TACH GAUGE GEOMETRY
   Mirrors the arc math from docs/design/tach-popup-mockup.html.
   Sweep: 270° clockwise, START at 225° (lower-left), END at -45° (lower-right).
   viewBox is 0 0 200 130; hub sits at (100,100); arc radius 70.
   These functions are pure (no DOM) so they export cleanly for tests.
   ============================================================ */

var GAUGE_CX = 100, GAUGE_CY = 96, GAUGE_R = 88;
// 180° top arch (wide + short speedometer): start at 180° (left), sweep 180°
// clockwise to 0° (right). Hub sits on the baseline; the needle sweeps the top.
var GAUGE_START_DEG = 180, GAUGE_SWEEP = 180;
// The gauge's visual range. GAUGE_SMIN (0.1) is DELIBERATELY above the global
// SPEED_MIN (0.01, constants.js): the dial face starts at 0.1 and dragging the
// needle clamps there (gaugeFrac/gaugeSpeedFromFrac both floor at GAUGE_SMIN),
// so the dial cannot reach the 0.01 floor. That floor is reachable only via the
// finer controls — the +/- buttons and the slider input (which step down
// 0.10→0.05→0.01). A 0.01-wide dial would be unreadable and near-impossible to
// hit by drag; the coarse 0.1 dial floor is the intentional trade-off.
var GAUGE_SMIN = 0.1, GAUGE_SMAX = 4.0;
// Widest redline path pre-drawn so dashoffset can reveal any portion (0→4.0)
var GAUGE_REDLINE_MAX = 4.0;
// The 1.0x gate sits at this fraction of the 270° sweep. PIECEWISE scale: the
// under-crank band (0.1→1.0) is compressed into [0, GATE], the overdrive band
// (1.0→4.0) stretches across [GATE, 1]. Anchors 1.0x high on the dial (≈128°,
// where a LINEAR scale put 1.5x) so "normal speed" reads near the top and the
// redline owns the larger upper sweep — like a real tach.
var GAUGE_GATE_FRAC = 0.36;

/**
 * Fraction of the gauge sweep for speed v (clamped to [0,1]). Piecewise-linear
 * with the knee at v=1.0 mapped to GAUGE_GATE_FRAC.
 * @param {number} v
 * @returns {number}
 */
function gaugeFrac(v) {
    v = Math.min(GAUGE_SMAX, Math.max(GAUGE_SMIN, v));
    if (v <= 1.0) {
        return GAUGE_GATE_FRAC * (v - GAUGE_SMIN) / (1.0 - GAUGE_SMIN);
    }
    return GAUGE_GATE_FRAC +
        (1 - GAUGE_GATE_FRAC) * (v - 1.0) / (GAUGE_SMAX - 1.0);
}

/**
 * Linear fraction across the SLIDER's own range (its thumb moves linearly, so
 * the track colour split must too — independent of the non-linear gauge).
 * @param {number} v
 * @returns {number}
 */
function gaugeSliderFrac(v) {
    var lo = 0.01, hi = 4.0; // mirror the range input's min/max
    return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}

/**
 * Inverse of gaugeFrac: a sweep fraction [0,1] → speed value. Used by the dial
 * drag to turn a pointer angle back into a speed. Mirrors the piecewise knee.
 * @param {number} frac
 * @returns {number}
 */
function gaugeSpeedFromFrac(frac) {
    frac = Math.min(1, Math.max(0, frac));
    if (frac <= GAUGE_GATE_FRAC) {
        return GAUGE_SMIN + (1.0 - GAUGE_SMIN) * (frac / GAUGE_GATE_FRAC);
    }
    return 1.0 + (GAUGE_SMAX - 1.0) *
        ((frac - GAUGE_GATE_FRAC) / (1 - GAUGE_GATE_FRAC));
}

/**
 * Angle in degrees (screen coords) for a speed value. Clockwise sweep means
 * subtracting from the start angle.
 * @param {number} v
 * @returns {number}
 */
function gaugeAngleDeg(v) {
    return GAUGE_START_DEG - GAUGE_SWEEP * gaugeFrac(v);
}

function gaugeRad(d) { return d * Math.PI / 180; }

/**
 * SVG screen point on the arc for a given angle (degrees).
 * @param {number} deg
 * @returns {[number, number]}
 */
function gaugePt(deg) {
    return [
        GAUGE_CX + GAUGE_R * Math.cos(gaugeRad(deg)),
        GAUGE_CY - GAUGE_R * Math.sin(gaugeRad(deg))
    ];
}

/**
 * Build an SVG arc 'd' attribute from speed a to speed b (a < b).
 * @param {number} a - start speed
 * @param {number} b - end speed
 * @returns {string}
 */
function gaugeArcPath(a, b) {
    var pa = gaugePt(gaugeAngleDeg(a));
    var pb = gaugePt(gaugeAngleDeg(b));
    // large-arc-flag: 1 when the sub-arc spans more than 180°
    var large = (gaugeFrac(b) - gaugeFrac(a)) * GAUGE_SWEEP > 180 ? 1 : 0;
    // sweep-flag 1 = clockwise in SVG screen coords
    return 'M ' + pa[0].toFixed(2) + ' ' + pa[1].toFixed(2) +
           ' A ' + GAUGE_R + ' ' + GAUGE_R + ' 0 ' + large + ' 1 ' +
           pb[0].toFixed(2) + ' ' + pb[1].toFixed(2);
}

/**
 * Gate tick line: a short radial mark across the ring at v=1.0.
 * Returns {x1,y1,x2,y2} in SVG user units.
 */
function gaugeGateLine() {
    var d = gaugeAngleDeg(1.0);
    var inner = GAUGE_R - 7, outer = GAUGE_R + 7;
    return {
        x1: GAUGE_CX + inner * Math.cos(gaugeRad(d)),
        y1: GAUGE_CY - inner * Math.sin(gaugeRad(d)),
        x2: GAUGE_CX + outer * Math.cos(gaugeRad(d)),
        y2: GAUGE_CY - outer * Math.sin(gaugeRad(d))
    };
}

/**
 * Needle endpoint from the hub toward the value angle, length = R-12.
 * @param {number} v
 * @returns {{x:number, y:number}}
 */
function gaugeNeedleEnd(v) {
    var d = gaugeAngleDeg(v), len = GAUGE_R - 12;
    return {
        x: GAUGE_CX + len * Math.cos(gaugeRad(d)),
        y: GAUGE_CY - len * Math.sin(gaugeRad(d))
    };
}

/**
 * Cap-label anchor points (just outside the arc at the start/end caps).
 * @param {number} v - speed value (use GAUGE_SMIN or GAUGE_SMAX)
 * @param {number} dx - pixel nudge
 * @param {number} dy - pixel nudge
 * @returns {{x:number, y:number}}
 */
function gaugeCapLabel(v, dx, dy) {
    var d = gaugeAngleDeg(v), rr = GAUGE_R + 2;
    return {
        x: GAUGE_CX + rr * Math.cos(gaugeRad(d)) + dx,
        y: GAUGE_CY - rr * Math.sin(gaugeRad(d)) + dy
    };
}

const VSC = (typeof module !== 'undefined' && module.exports)
    ? require('../constants')
    : (typeof self !== 'undefined' ? self.VSC : globalThis.VSC);
const { SPEED_MIN, SPEED_MAX, SPEED_STEP, SPEED_SLIDER_STEP, MAX_PER_SITE_ENTRIES } = VSC;

/**
 * Derive the registrable domain (eTLD+1, last two dot-separated labels) from a
 * full URL string (Story 3.6). Mirrors content.js's getRegistrableDomain but
 * accepts a full URL rather than a bare hostname.
 *
 * Returns '' for:
 *  - non-http/https schemes (chrome://, about:, file://, extension://, etc.)
 *  - malformed / non-URL strings ("not a url", "")
 *  - null / undefined
 *
 * KNOWN LIMITATION: multi-part public suffixes (co.uk, github.io) are not
 * handled — there is no Public Suffix List without a bundler (ADR-002). The
 * two-label slice is correct for the vast majority of target sites.
 *
 * @param {string|null|undefined} url - A full URL from chrome.tabs.Tab.url.
 * @returns {string} Registrable domain, e.g. "youtube.com", or '' on failure.
 */
function getDomainFromUrl(url) {
    if (!url || typeof url !== 'string') return '';
    let parsed;
    try {
        parsed = new URL(url);
    } catch (_) {
        return '';
    }
    // Only handle ordinary web pages — discard chrome://, about:, file://, etc.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    const hostname = parsed.hostname;
    if (!hostname) return '';
    const labels = hostname.split('.').filter(Boolean);
    if (labels.length < 2) return labels.join('.');
    return labels.slice(-2).join('.');
}

/**
 * Enforce the NFR-SC2 cap on a perSiteSpeeds map (Story 3.6). Returns a new
 * object with at most MAX_PER_SITE_ENTRIES entries, dropping the oldest
 * (insertion-order) keys. Never mutates the input. Mirrors content.js's
 * capPerSiteSpeeds.
 */
function capPerSiteMap(map) {
    const out = Object.assign({}, map);
    const keys = Object.keys(out);
    if (keys.length > MAX_PER_SITE_ENTRIES) {
        const toDrop = keys.slice(0, keys.length - MAX_PER_SITE_ENTRIES);
        for (const k of toDrop) delete out[k];
    }
    return out;
}

/**
 * True when a value is a finite number within the allowed speed range.
 * Mirror of content.js `isValidSpeed` (ADR-002 — duplicated, keep in sync).
 */
function isValidSpeed(value) {
    const v = parseFloat(value);
    return !isNaN(v) && v >= SPEED_MIN && v <= SPEED_MAX;
}

/**
 * D2 — decide the storage write for a manual popup speed change. The global
 * `defaultPlaybackSpeed` is OPTIONS-OWNED: the popup dial never writes it. So:
 *   - active domain HAS a per-site preset → update `perSiteSpeeds[domain]` (capped);
 *   - otherwise → return null (apply live only; nothing persists). To make a
 *     tweak stick on a site, the user turns on "Remember rate for this site"
 *     (which captures the current dial value as a per-site entry).
 * Validate-on-write (D4): also returns null for an out-of-range speed. Pure.
 *
 * @param {number} speed
 * @param {string} domain - registrable domain of the active tab ('' if unknown)
 * @param {object} perSiteSpeeds - current per-site map from storage
 * @returns {object|null} the object to pass to chrome.storage.sync.set, or null
 *   (null = no persistence: invalid speed, OR an un-remembered site)
 */
function buildSpeedWrite(speed, domain, perSiteSpeeds) {
    if (!isValidSpeed(speed)) return null;
    const map = perSiteSpeeds || {};
    if (domain && Object.prototype.hasOwnProperty.call(map, domain)) {
        const updated = Object.assign({}, map, { [domain]: parseFloat(speed) });
        return { perSiteSpeeds: capPerSiteMap(updated) };
    }
    // Un-remembered site → do NOT touch the global default (options-owned).
    return null;
}

/**
 * True only for an http(s) YouTube WATCH page (Story 5.3). The "Copy Transcript"
 * affordance is gated on this — transcripts only exist on /watch. Pure.
 *
 * Accepts youtube.com / www.youtube.com / m.youtube.com with pathname '/watch'.
 * Returns false for non-watch YouTube pages, non-YouTube sites, and
 * chrome://, about:, file://, or malformed URLs.
 *
 * @param {string|null|undefined} url - A full URL from chrome.tabs.Tab.url.
 * @returns {boolean}
 */
function isYouTubeWatchUrl(url) {
    if (!url || typeof url !== 'string') return false;
    let parsed;
    try {
        parsed = new URL(url);
    } catch (_) {
        return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.replace(/^www\./, '');
    if (host !== 'youtube.com' && host !== 'm.youtube.com') return false;
    return parsed.pathname === '/watch';
}

/**
 * Decide what the popup should do with the content script's getTranscript
 * response (Story 5.3). Pure — the side effects (clipboard write, status text)
 * live in the click handler; this is the unit-testable decision.
 *
 * @param {{available:boolean, text:string}|null|undefined} response
 *   The reply from content-youtube.js handleMessage, or null/undefined when the
 *   content script could not be reached.
 * @returns {{status:'ok'|'none'|'error', message:string, text?:string}}
 *   - ok    → response had a non-empty transcript; `text` is what to copy.
 *   - none  → no transcript available (or empty); copy nothing (AC2).
 *   - error → no response; the content script was unreachable.
 */
function decideTranscriptResult(response) {
    if (!response) {
        return {
            status: 'error',
            message: 'Could not reach the page — reload it and try again.',
        };
    }
    if (response.available && response.text) {
        return { status: 'ok', message: 'Transcript copied!', text: response.text };
    }
    return { status: 'none', message: 'No transcript available for this video' };
}

/**
 * Story 6.2 (FR-12) — resolve the 6 preset speeds to render in the popup.
 *
 * Returns `customPresets` unchanged when it is an array of EXACTLY 6 finite
 * numbers. Falls back to VSC.DEFAULT_SETTINGS.customPresets for any other input
 * (null, undefined, wrong length, non-numeric values). Range clamping is the
 * options page's job (validate-on-write); the popup only renders, and a click
 * still routes through buildSpeedWrite/isValidSpeed + content.js validation, so
 * an out-of-range stored value can't bypass the guards. Pure — fully testable.
 *
 * @param {any} customPresets - Value read from chrome.storage.sync.
 * @returns {number[]} Array of exactly 6 preset speeds.
 */
function getPresetSpeeds(customPresets) {
    if (
        Array.isArray(customPresets) &&
        customPresets.length === 6 &&
        customPresets.every(function(v) { return typeof v === 'number' && isFinite(v); })
    ) {
        return customPresets;
    }
    return VSC.DEFAULT_SETTINGS.customPresets;
}

document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const speedSlider = document.getElementById('speedSlider');
    const currentSpeed = document.getElementById('currentSpeed');
    const decreaseBtn = document.getElementById('decreaseSpeed');
    const increaseBtn = document.getElementById('increaseSpeed');
    const resetBtn = document.getElementById('resetBtn');
    const fasterBtn = document.getElementById('fasterBtn');
    // presetBtns is populated after buildPresetButtons() creates the elements.
    let presetBtns = [];
    const rememberToggle = document.getElementById('rememberSiteToggle');
    const rememberDomainLabel = document.getElementById('rememberSiteDomain');

    // How long to wait after the last speed change before persisting to
    // chrome.storage.sync (which has a ~120 writes/min quota). The live apply to
    // the video is instant; only the write is debounced.
    const PERSIST_DEBOUNCE_MS = 200;

    // ---------- Gauge element references (grabbed once on DOMContentLoaded) ----------
    const gaugeWrap   = document.getElementById('gaugeWrap');
    const gaugeTrack  = document.getElementById('gaugeTrack');
    const gaugeFillEl = document.getElementById('gaugeFill');
    const gaugeRedEl  = document.getElementById('gaugeRedline');
    const gaugeGateEl = document.getElementById('gaugeGate');
    const gaugeCapLoEl= document.getElementById('gaugeCapLo');
    const gaugeCapHiEl= document.getElementById('gaugeCapHi');
    const gaugeNeedleEl = document.getElementById('gaugeNeedle');
    const gaugeTagEl  = document.getElementById('gaugeTag');

    // Detect prefers-reduced-motion once on load; needle snaps (no CSS transition)
    // when true, per the spec §7 and the mockup IIFE.
    const reducedMotion = (
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );

    /**
     * One-time initialisation of the gauge SVG paths and labels.
     * Draws the static geometry: full-sweep track, gate tick, cap labels.
     * The fill, redline, and needle are updated per-speed by updateGauge().
     */
    function initGauge() {
        if (!gaugeTrack) return; // not present in stripped test DOM

        // Full 270° track arc (0.1 → 4.0)
        gaugeTrack.setAttribute('d', gaugeArcPath(GAUGE_SMIN, GAUGE_SMAX));

        // Gate tick at 1.0x
        var gate = gaugeGateLine();
        if (gaugeGateEl) {
            gaugeGateEl.setAttribute('x1', gate.x1.toFixed(2));
            gaugeGateEl.setAttribute('y1', gate.y1.toFixed(2));
            gaugeGateEl.setAttribute('x2', gate.x2.toFixed(2));
            gaugeGateEl.setAttribute('y2', gate.y2.toFixed(2));
        }

        // Cap labels (0.1 at start / 4.0 at end)
        var loCap = gaugeCapLabel(GAUGE_SMIN, 6, 14);
        var hiCap = gaugeCapLabel(GAUGE_SMAX, -6, 14);
        if (gaugeCapLoEl) {
            gaugeCapLoEl.setAttribute('x', loCap.x.toFixed(1));
            gaugeCapLoEl.setAttribute('y', loCap.y.toFixed(1));
        }
        if (gaugeCapHiEl) {
            gaugeCapHiEl.setAttribute('x', hiCap.x.toFixed(1));
            gaugeCapHiEl.setAttribute('y', hiCap.y.toFixed(1));
        }

        // Pre-draw the redline arc at its widest span (1.0 → 4.0) so the
        // dashoffset animation can reveal any sub-portion without a path rebuild.
        if (gaugeRedEl) {
            gaugeRedEl.setAttribute('d', gaugeArcPath(1.0, GAUGE_REDLINE_MAX));
        }

        // Pre-draw the fill arc at its widest (0.1 → 1.0) for the same reason.
        if (gaugeFillEl) {
            gaugeFillEl.setAttribute('d', gaugeArcPath(GAUGE_SMIN, 1.0));
        }
    }

    /**
     * Update the gauge to reflect a new speed value.
     * Called from updateSpeedDisplay on every speed change.
     * All mutations are paint-only (dashoffset, opacity, transform) — no layout.
     *
     * @param {number} v - parsed speed value
     */
    function updateGauge(v) {
        if (!gaugeNeedleEl) return; // stripped test DOM — skip silently

        var over = v > 1.0;
        var fmt = v.toFixed(2) + 'x';

        // --- Needle: rotate around the hub (CX,CY = 100,100) ---
        // The needle SVG is a <line x1="100" y1="100" x2="100" y2="32">.
        // With transform-box:fill-box + transform-origin:50% 100% the rotation
        // pivot is the bottom midpoint of the fill-box (= the hub at 100,100).
        // We need to rotate from the default (pointing up, angle 90° in math
        // coords) to the target angle gaugeAngleDeg(v).
        // The default needle tip is at (100,32) → angle 90° in math.
        // Rotation delta = 90° - gaugeAngleDeg(v), then negate for SVG y-down.
        var targetAngle = gaugeAngleDeg(v);        // in standard math degrees
        var rotationDeg = 90 - targetAngle;         // SVG clockwise rotation
        if (reducedMotion) {
            // Snap: temporarily disable the CSS transition.
            gaugeNeedleEl.style.transition = 'none';
            gaugeNeedleEl.style.transform = 'rotate(' + rotationDeg + 'deg)';
            // Re-enable transition after paint (via rAF-inside-timeout pattern).
            setTimeout(function() {
                gaugeNeedleEl.style.transition = '';
            }, 0);
        } else {
            gaugeNeedleEl.style.transform = 'rotate(' + rotationDeg + 'deg)';
        }
        gaugeNeedleEl.classList.toggle('gauge__needle--redline', over);

        // --- Amethyst fill: 0.1 → min(v, 1.0) via stroke-dashoffset ---
        if (gaugeFillEl) {
            try {
                var fillLen = gaugeFillEl.getTotalLength();
                if (fillLen > 0) {
                    gaugeFillEl.style.strokeDasharray = fillLen;
                    // Fraction of the 0.1→1.0 window that is filled.
                    var fillFrac = gaugeFrac(Math.min(v, 1.0)) / gaugeFrac(1.0);
                    gaugeFillEl.style.strokeDashoffset = fillLen * (1 - fillFrac);
                }
            } catch (e) { /* getTotalLength unavailable in jsdom — skip */ }
        }

        // --- Redline: 1.0 → v via stroke-dashoffset; hidden when v ≤ 1.0 ---
        if (gaugeRedEl) {
            gaugeRedEl.style.opacity = over ? 1 : 0;
            try {
                var redLen = gaugeRedEl.getTotalLength();
                if (redLen > 0) {
                    gaugeRedEl.style.strokeDasharray = redLen;
                    var windowFrac = over
                        ? (gaugeFrac(v) - gaugeFrac(1.0)) / (gaugeFrac(GAUGE_REDLINE_MAX) - gaugeFrac(1.0))
                        : 0;
                    gaugeRedEl.style.strokeDashoffset = redLen * (1 - windowFrac);
                }
            } catch (e) { /* getTotalLength unavailable in jsdom — skip */ }
        }

        // --- OVERDRIVE tag (opacity toggle, height always reserved) ---
        if (gaugeTagEl) {
            if (over) {
                gaugeTagEl.setAttribute('data-state', 'overdrive');
            } else {
                gaugeTagEl.removeAttribute('data-state');
            }
        }

        // --- Gauge ARIA (role=slider): live value + overdrive state ---
        if (gaugeWrap) {
            gaugeWrap.setAttribute('aria-valuenow', v.toFixed(2));
            gaugeWrap.setAttribute('aria-valuetext', fmt + (over ? ' (overdrive)' : ''));
        }

        // --- Throttle slider split: linear (matches the thumb), NOT the dial ---
        var p1Pct = (gaugeSliderFrac(1.0) * 100).toFixed(1) + '%';
        var pvPct = (gaugeSliderFrac(v)   * 100).toFixed(1) + '%';
        speedSlider.style.setProperty('--p1', p1Pct);
        speedSlider.style.setProperty('--pv', pvPct);
    }

    // Update speed display with animation
    function updateSpeedDisplay(speed) {
        const speedValue = parseFloat(speed).toFixed(2);
        currentSpeed.textContent = `${speedValue}x`;

        // Add animation class for the subtle pulse on the value text.
        currentSpeed.classList.add('speed-change');

        // Remove animation class after it completes
        setTimeout(() => {
            currentSpeed.classList.remove('speed-change');
        }, 300);

        // Update slider position
        speedSlider.value = speedValue;

        // Update the tachometer gauge
        updateGauge(parseFloat(speedValue));

        // Update active preset button
        updateActivePreset(speedValue);
    }

    // Initialise the static gauge geometry immediately after DOM is ready.
    initGauge();
    // Render gauge at the initial 1.00x position.
    updateGauge(1.0);

    // Update active preset button
    function updateActivePreset(speed) {
        presetBtns.forEach(btn => {
            const btnSpeed = parseFloat(btn.dataset.speed).toFixed(2);
            const currentSpeedFixed = parseFloat(speed).toFixed(2);
            
            if (btnSpeed === currentSpeedFixed) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    /**
     * Get the currently active tab
     * @returns {Promise<object>} The active tab object
     */
    function getActiveTab() {
        return new Promise(resolve => {
            chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                resolve(tabs[0] || null);
            });
        });
    }

    /**
     * Change the playback speed. Split into two paths so the video tracks the
     * control INSTANTLY while storage writes stay within the sync quota:
     *   - applySpeedLive(): runs on every change — updates the popup label and
     *     fires setSpeed to the active tab's content script immediately (no
     *     storage round-trip in the way, no throttle dropping updates);
     *   - persistSpeedDebounced(): waits until you stop moving, then writes once.
     * @param {number} speed - The playback speed to set (e.g., 1.5 for 1.5x)
     */
    function setVideoSpeed(speed) {
        const newSpeed = parseFloat(speed);
        if (isNaN(newSpeed)) return;
        applySpeedLive(newSpeed);
        persistSpeedDebounced(newSpeed);
    }

    /**
     * Apply a speed NOW: update the popup UI and tell the active tab's content
     * script to set playbackRate. No storage read blocks this, so the video
     * reacts to the slider/buttons with no perceptible lag.
     * @param {number} newSpeed
     */
    function applySpeedLive(newSpeed) {
        updateSpeedDisplay(newSpeed);
        getActiveTab().then(tab => {
            if (!tab || !tab.id) return;
            // persist:false — apply ONLY. The content script sets playbackRate but
            // does NOT write storage; persistSpeedDebounced owns the (single,
            // debounced) write so a slider drag can't blow the sync write quota.
            chrome.tabs.sendMessage(
                tab.id,
                { action: 'setSpeed', speed: newSpeed, persist: false },
                (response) => {
                    if (!response || !response.success) {
                        // Retry once. The no-op callback reads lastError so a
                        // missing receiver (no content script) rejects quietly
                        // instead of logging "Could not establish connection".
                        setTimeout(() => {
                            chrome.tabs.sendMessage(tab.id, {
                                action: 'setSpeed',
                                speed: newSpeed,
                                persist: false
                            }, () => { void chrome.runtime.lastError; });
                        }, 500);
                    }
                }
            );
        });
    }

    /**
     * Persist a speed after a short quiet period. Only chrome.storage.sync WRITES
     * are quota-limited (~120/min), not reads — so we resolve the write target
     * (per-site-aware, D2) IMMEDIATELY on every change and debounce just the
     * set(). That keeps `pendingWrite` ready so flushPersist() can fire the write
     * synchronously if the popup closes before the debounce elapses (the popup's
     * JS context is torn down on close, which would otherwise drop the timer).
     *
     * buildSpeedWrite enforces validate-on-write (D4) — a bad speed yields null
     * and the write is skipped.
     * @param {number} newSpeed
     */
    let persistTimeout;
    let pendingWrite = null;
    function persistSpeedDebounced(newSpeed) {
        getActiveTab().then(tab => {
            const domain = tab ? getDomainFromUrl(tab.url) : '';
            chrome.storage.sync.get(['perSiteSpeeds'], (r) => {
                const map = (r && r.perSiteSpeeds) ? r.perSiteSpeeds : {};
                pendingWrite = buildSpeedWrite(newSpeed, domain, map); // {perSiteSpeeds} or null
                clearTimeout(persistTimeout);
                persistTimeout = setTimeout(flushPersist, PERSIST_DEBOUNCE_MS);
            });
        });
    }

    // Write the pending value now. Idempotent + safe to call from the close
    // handlers; chrome.storage.sync.set is queued to the browser process so it
    // survives the popup teardown once invoked.
    function flushPersist() {
        clearTimeout(persistTimeout);
        if (pendingWrite) {
            chrome.storage.sync.set(pendingWrite);
            pendingWrite = null;
        }
    }

    // Flush on popup close so a change made in the last PERSIST_DEBOUNCE_MS isn't
    // lost (pagehide covers close; visibilitychange covers focus-loss dismissal).
    window.addEventListener('pagehide', flushPersist);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushPersist();
    });

    // Handle slider input. The slider's HTML step is 0.01 (so it can hold the
    // +/- buttons' fine 0.05-grid values + the 0.01 floor); snapToSliderDragStep
    // gives the DRAG a coarse 0.25 "feel" (0.25/0.5/0.75/1.0…) for quick big
    // moves — use the +/- buttons for fine 0.05 adjustments. Apply live on EVERY
    // input event (the storage write is debounced inside setVideoSpeed) so the
    // video tracks the drag instantly.
    speedSlider.addEventListener('input', function() {
        setVideoSpeed(VSC.snapToSliderDragStep(this.value));
    });
    
    // Decrease speed button — steps on the 0.05 grid (same as the slider), with
    // the 0.01 floor reachable: snapToSliderStep rounds to the 0.05 grid and
    // clamps to [SPEED_MIN, SPEED_MAX], so 0.05 → 0.01 (the min) → stays 0.01.
    decreaseBtn.addEventListener('click', function() {
        const newSpeed = VSC.snapToSliderStep(parseFloat(speedSlider.value) - SPEED_SLIDER_STEP);
        setVideoSpeed(newSpeed);
    });

    // Increase speed button — steps on the 0.05 grid (clamps at SPEED_MAX). From
    // the 0.01 floor this snaps back onto the grid (0.01 → 0.05 → 0.10 …).
    increaseBtn.addEventListener('click', function() {
        const newSpeed = VSC.snapToSliderStep(parseFloat(speedSlider.value) + SPEED_SLIDER_STEP);
        setVideoSpeed(newSpeed);
    });
    
    // Reset to 1.0x
    resetBtn.addEventListener('click', function() {
        setVideoSpeed(1.0);
    });
    
    // Redline button → jump to the configurable redline target speed.
    fasterBtn.addEventListener('click', function() {
        const currentSpeed = parseFloat(speedSlider.value);
        let newSpeed = redlineTargetSpeed;

        // If already at/above the target, keep pushing up the 0.25 grid.
        if (currentSpeed >= redlineTargetSpeed) {
            newSpeed = VSC.snapToStep(currentSpeed + SPEED_STEP);
        }

        setVideoSpeed(newSpeed);
    });
    
    // Story 6.2 (FR-12): Build preset buttons dynamically from storage.
    // Reads customPresets, resolves via getPresetSpeeds (falls back to defaults),
    // creates 6 <button class="preset-btn"> elements via createElement (no
    // innerHTML injection), wires each to setVideoSpeed, then re-assigns
    // presetBtns so updateActivePreset sees all 6 generated buttons.
    function buildPresetButtons(speeds) {
        const container = document.querySelector('.preset-speeds');
        if (!container) return;
        // Clear any existing children before building (safe re-call).
        while (container.firstChild) container.removeChild(container.firstChild);
        speeds.forEach(function(value) {
            const btn = document.createElement('button');
            btn.className = 'preset-btn';
            btn.dataset.speed = value;
            btn.textContent = value + 'x';
            btn.addEventListener('click', function() {
                setVideoSpeed(parseFloat(this.dataset.speed));
            });
            container.appendChild(btn);
        });
        // Re-query so presetBtns closure and updateActivePreset see the live buttons.
        presetBtns = Array.from(document.querySelectorAll('.preset-btn'));
    }

    // Target speed for the [ REDLINE ] button; user-configurable in settings.
    let redlineTargetSpeed = VSC.DEFAULT_SETTINGS.redlineSpeed;

    chrome.storage.sync.get(['customPresets', 'redlineSpeed'], function(result) {
        const speeds = getPresetSpeeds(result ? result.customPresets : undefined);
        buildPresetButtons(speeds);
        // After building, apply active state for whatever speed is already showing.
        updateActivePreset(speedSlider.value);
        if (result && result.redlineSpeed != null && isValidSpeed(result.redlineSpeed)) {
            redlineTargetSpeed = parseFloat(result.redlineSpeed);
        }
    });
    
    // Keyboard navigation
    document.addEventListener('keydown', function(e) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            e.preventDefault();
            increaseBtn.click();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            e.preventDefault();
            decreaseBtn.click();
        } else if (e.key === 'r' || e.key === 'R') {
            resetBtn.click();
        } else if (e.key === 'f' || e.key === 'F') {
            fasterBtn.click();
        }
    });

    // ---- Draggable tachometer dial: the gauge IS the analog speed input ----
    // Pointer down/drag on the dial maps the pointer angle about the hub back
    // through the piecewise scale to a speed, then drives the same setVideoSpeed
    // path the buttons/presets use. Keyboard is handled by the global arrow-key
    // listener above (role=slider just makes the dial focusable for a11y).
    (function initGaugeDrag() {
        if (!gaugeWrap) return; // stripped test DOM — skip
        const svg = gaugeWrap.querySelector('.gauge__svg');
        if (!svg) return;
        let dragging = false;

        function speedFromPointer(e) {
            let ux, uy;
            try {
                const pt = svg.createSVGPoint();
                pt.x = e.clientX; pt.y = e.clientY;
                const u = pt.matrixTransform(svg.getScreenCTM().inverse());
                ux = u.x; uy = u.y;
            } catch (_) {
                // Fallback: proportional map (viewBox aspect ≈ rendered aspect).
                const r = svg.getBoundingClientRect();
                ux = (e.clientX - r.left) / r.width * 200;
                uy = (e.clientY - r.top) / r.height * 116;
            }
            // Math-degree angle about the hub (y is down in SVG → negate dy).
            let angle = Math.atan2(-(uy - GAUGE_CY), ux - GAUGE_CX) * 180 / Math.PI;
            angle = Math.min(180, Math.max(0, angle)); // 180° top arch: 180°→0°
            const frac = (GAUGE_START_DEG - angle) / GAUGE_SWEEP;
            return VSC.snapToSliderStep(gaugeSpeedFromFrac(frac));
        }

        function onMove(e) {
            if (!dragging) return;
            e.preventDefault();
            setVideoSpeed(speedFromPointer(e));
        }
        function endDrag(e) {
            if (!dragging) return;
            dragging = false;
            gaugeWrap.classList.remove('gauge--dragging');
            try { gaugeWrap.releasePointerCapture(e.pointerId); } catch (_) {}
        }

        gaugeWrap.addEventListener('pointerdown', function(e) {
            dragging = true;
            gaugeWrap.classList.add('gauge--dragging');
            try { gaugeWrap.setPointerCapture(e.pointerId); } catch (_) {}
            gaugeWrap.focus();
            setVideoSpeed(speedFromPointer(e)); // jump to where you pressed
            e.preventDefault();
        });
        gaugeWrap.addEventListener('pointermove', onMove);
        gaugeWrap.addEventListener('pointerup', endDrag);
        gaugeWrap.addEventListener('pointercancel', endDrag);
    })();

    // Load saved speed when popup opens
    function loadSavedSpeed() {
        // Read BOTH the global default and the per-site map: the popup must show
        // (and re-apply) what is ACTUALLY playing, which is the per-site override
        // when one exists. Reading only defaultPlaybackSpeed meant opening the popup
        // on a per-site-overridden page pushed the global default onto the video via
        // the setSpeed below, clobbering the override (content.js resolveSpeedForSite
        // had correctly applied it on page load).
        chrome.storage.sync.get(['defaultPlaybackSpeed', 'perSiteSpeeds'], function(result) {
            let globalDefault = 1.0;
            // `!= null` (not a truthy test): a stored 0 must reach the range
            // check below and be rejected → fall back to 1.0, rather than being
            // silently skipped by a falsy guard. (0 is below SPEED_MIN anyway,
            // but the guard should express "present?", not "non-zero?".)
            if (result.defaultPlaybackSpeed != null) {
                const parsed = parseFloat(result.defaultPlaybackSpeed);
                if (!isNaN(parsed) && parsed >= SPEED_MIN && parsed <= SPEED_MAX) {
                    globalDefault = parsed;
                }
            }
            const perSiteSpeeds = (result && result.perSiteSpeeds) ? result.perSiteSpeeds : {};

            // Show the global default immediately; the active-tab domain (needed to
            // resolve the per-site override) is only known after the async tab query.
            updateSpeedDisplay(globalDefault);
            speedSlider.value = globalDefault;

            getActiveTab().then(tab => {
                // Resolve the effective speed for this domain (site → global),
                // mirroring content.js resolveSpeedForSite.
                const domain = tab ? getDomainFromUrl(tab.url) : '';
                let savedSpeed = globalDefault;
                if (domain
                        && Object.prototype.hasOwnProperty.call(perSiteSpeeds, domain)
                        && isValidSpeed(perSiteSpeeds[domain])) {
                    savedSpeed = parseFloat(perSiteSpeeds[domain]);
                    updateSpeedDisplay(savedSpeed);
                    speedSlider.value = savedSpeed;
                }
                if (tab && tab.id) {
                    // No-op callback swallows lastError so popup-open on a tab
                    // without a content script (chrome://, not-yet-injected page)
                    // doesn't throw "Uncaught (in promise): Could not establish
                    // connection. Receiving end does not exist."
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'setSpeed',
                        speed: savedSpeed,
                        persist: false // just applying the saved value on open
                    }, () => { void chrome.runtime.lastError; });
                }
            });
        });
    }

    // ---- Story 6.6 (FR-20): Apply user-chosen accent color on load ----
    // Read accentColor from storage; fall back to the DEFAULT_SETTINGS value.
    // applyAccentColor sets --primary-color, --primary-hover, and --on-accent on
    // document.documentElement so every CSS var(--primary-*) in popup.css recolors.
    // This block is self-contained; Story 6.2 (a later wave) may add more here.
    (function loadAccentColor() {
        chrome.storage.sync.get(['accentColor'], function(result) {
            var accent = (result && result.accentColor)
                ? result.accentColor
                : VSC.DEFAULT_SETTINGS.accentColor;
            VSC.applyAccentColor(document.documentElement, accent);
        });
    })();

    // ---- Story 6.3 (FR-13): Apply the saved theme preference on load ----
    // Read `theme` (light/dark/auto) and set the [data-theme] override so
    // popup.css renders dark explicitly; 'auto' falls through to the
    // prefers-color-scheme media query (the dark palette lives in popup.css).
    (function loadThemePreference() {
        chrome.storage.sync.get(['theme'], function(result) {
            var theme = (result && result.theme)
                ? result.theme
                : VSC.DEFAULT_SETTINGS.theme;
            VSC.applyThemePreference(document.documentElement, theme);
        });
    })();

    // Initialize
    loadSavedSpeed();

    // ---- Settings view: gear toggle swaps the popup to the embedded options page ----
    // The settings UI is the standalone options page rendered inside an iframe, so
    // ONE settings implementation (options.html/options.js) backs both the popup
    // gear view and the full-tab options page — no duplicated markup or wiring.
    (function initSettingsView() {
        const openBtn = document.getElementById('openSettingsBtn');
        const closeBtn = document.getElementById('closeSettingsBtn');
        const mainView = document.getElementById('mainView');
        const settingsView = document.getElementById('settingsView');
        const frame = document.getElementById('settingsFrame');
        const title = document.getElementById('popupTitle');
        // Inert if any piece is absent (e.g. the unit-test DOM omits these).
        if (!openBtn || !closeBtn || !mainView || !settingsView) return;

        // Auto-size the iframe to its content so the popup scrolls as ONE unit
        // (no nested iframe scrollbar). Same-origin → contentDocument is readable.
        function sizeFrame() {
            if (!frame) return;
            try {
                const doc = frame.contentDocument;
                if (doc && doc.documentElement) {
                    frame.style.height = doc.documentElement.scrollHeight + 'px';
                }
            } catch (e) { /* cross-origin guard — never hit here, but stay safe */ }
        }
        if (frame) {
            frame.addEventListener('load', function () {
                sizeFrame();
                // Keep the height synced as the embedded content grows/shrinks
                // (per-site list renders, validation messages, theme swaps).
                try {
                    new ResizeObserver(sizeFrame).observe(frame.contentDocument.documentElement);
                } catch (e) { /* ResizeObserver unavailable — load-time size still applies */ }
            });
        }

        function showSettings() {
            // Lazy-load the options page on first open: keeps the initial popup fast
            // and leaves the popup document with a single brand icon until then.
            if (frame && !frame.getAttribute('src')) {
                frame.setAttribute('src', '../options/options.html');
            }
            document.body.classList.add('settings-open');
            mainView.hidden = true;
            settingsView.hidden = false;
            openBtn.hidden = true;
            closeBtn.hidden = false;
            if (title) title.textContent = 'Settings';
        }

        function showMain() {
            document.body.classList.remove('settings-open');
            settingsView.hidden = true;
            mainView.hidden = false;
            closeBtn.hidden = true;
            openBtn.hidden = false;
            if (title) title.textContent = 'TACH';
        }

        openBtn.addEventListener('click', showSettings);
        closeBtn.addEventListener('click', showMain);
    })();

    // ---- Keep the popup's accent/theme live when changed elsewhere ----
    // Edits in the embedded settings iframe (or the full options tab, or a synced
    // device) write chrome.storage.sync; re-apply accent/theme to the popup so its
    // main view reflects the change on return. Guarded — the unit-test chrome mock
    // has no storage.onChanged.
    if (chrome.storage && chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
        chrome.storage.onChanged.addListener(function(changes, area) {
            if (area !== 'sync') return;
            if (changes.accentColor) {
                VSC.applyAccentColor(document.documentElement,
                    changes.accentColor.newValue || VSC.DEFAULT_SETTINGS.accentColor);
            }
            if (changes.theme) {
                VSC.applyThemePreference(document.documentElement,
                    changes.theme.newValue || VSC.DEFAULT_SETTINGS.theme);
            }
            // Preset-slot edits in the settings iframe → rebuild the main-view
            // preset row live (was previously only read once on popup open).
            if (changes.customPresets) {
                buildPresetButtons(getPresetSpeeds(changes.customPresets.newValue));
                updateActivePreset(speedSlider.value);
            }
            // Default-speed edits in the settings iframe → re-resolve and re-show
            // the effective speed (per-site override still wins) without needing a
            // popup close/reopen. loadSavedSpeed re-reads storage, updates the
            // gauge/slider, and re-applies to the active video (persist:false).
            if (changes.defaultPlaybackSpeed) {
                loadSavedSpeed();
            }
            // Redline target edited in settings → update the cached value live.
            if (changes.redlineSpeed) {
                var rs = parseFloat(changes.redlineSpeed.newValue);
                redlineTargetSpeed = (!isNaN(rs) && isValidSpeed(rs))
                    ? rs : VSC.DEFAULT_SETTINGS.redlineSpeed;
            }
        });
    }

    // ---- Story 3.6: "Remember speed for this site" ----

    /**
     * Write perSiteSpeeds[domain] = speed, enforcing the MAX_PER_SITE_ENTRIES cap
     * (drop oldest insertion-order key when the cap would be exceeded). Then
     * persist via chrome.storage.sync.set.
     *
     * @param {string} domain - Registrable domain to write.
     * @param {number} speed  - Speed value to store.
     * @param {object} perSiteSpeeds - Current per-site map from storage.
     */
    function savePerSiteSpeed(domain, speed, perSiteSpeeds) {
        // D4: validate-on-write — never persist an out-of-range speed (the slider
        // HTML min/max is not a sufficient guard on its own).
        if (!isValidSpeed(speed)) return;
        // Copy + set + enforce the NFR-SC2 cap (capPerSiteMap never mutates input).
        const map = Object.assign({}, perSiteSpeeds);
        map[domain] = parseFloat(speed);
        chrome.storage.sync.set({ perSiteSpeeds: capPerSiteMap(map) });
    }

    /**
     * Remove perSiteSpeeds[domain] and persist.
     *
     * @param {string} domain - Registrable domain to remove.
     * @param {object} perSiteSpeeds - Current per-site map from storage.
     */
    function removePerSiteSpeed(domain, perSiteSpeeds) {
        const map = Object.assign({}, perSiteSpeeds);
        delete map[domain];
        chrome.storage.sync.set({ perSiteSpeeds: map });
    }

    /**
     * Initialise the "Remember speed for this site" control.
     * Gets the active tab URL, derives the registrable domain, reads
     * perSiteSpeeds from storage, and wires the toggle.
     */
    function initRememberSiteControl() {
        getActiveTab().then(tab => {
            const domain = tab ? getDomainFromUrl(tab.url) : '';

            // Show the domain label (or a placeholder when unavailable).
            if (rememberDomainLabel) {
                rememberDomainLabel.textContent = domain || 'this site';
            }

            // Disable the control when we can't determine a meaningful domain
            // (e.g. the user is on a chrome:// or about: page).
            if (rememberToggle) {
                if (!domain) {
                    rememberToggle.disabled = true;
                    return;
                }

                // Read the current per-site map and set the initial toggle state.
                chrome.storage.sync.get(['perSiteSpeeds'], (result) => {
                    const perSiteSpeeds = (result && result.perSiteSpeeds)
                        ? result.perSiteSpeeds : {};
                    rememberToggle.checked = Object.prototype.hasOwnProperty.call(
                        perSiteSpeeds, domain);

                    // Wire the toggle change handler.
                    rememberToggle.addEventListener('change', function () {
                        const speed = parseFloat(speedSlider.value);
                        // Re-read storage at change time so we don't clobber
                        // writes that may have happened since popup opened.
                        chrome.storage.sync.get(['perSiteSpeeds'], (r) => {
                            const current = (r && r.perSiteSpeeds)
                                ? r.perSiteSpeeds : {};
                            if (rememberToggle.checked) {
                                savePerSiteSpeed(domain, speed, current);
                            } else {
                                removePerSiteSpeed(domain, current);
                            }
                        });
                    });
                });
            }
        });
    }

    initRememberSiteControl();

    // ---- Story 5.3: "Copy Transcript" on YouTube watch pages ----

    const copyTranscriptBtn = document.getElementById('copyTranscriptBtn');
    const transcriptStatus = document.getElementById('transcriptStatus');
    const includeTimestampsLabel = document.getElementById('includeTimestampsLabel');
    const includeTimestampsToggle = document.getElementById('includeTimestampsToggle');

    /** Update the transcript status line. `kind` drives the CSS color state. */
    function setTranscriptStatus(message, kind) {
        if (!transcriptStatus) return;
        transcriptStatus.textContent = message || '';
        transcriptStatus.dataset.kind = kind || '';
    }

    /**
     * Wire the Copy Transcript button. Surfaced only on a YouTube watch page
     * (AC3: hidden/unsupported elsewhere). On click it asks content-youtube.js
     * for the transcript and, only on an explicit click (NFR-S6), writes it to
     * the clipboard with success / no-transcript / error feedback.
     */
    function initTranscriptControl() {
        if (!copyTranscriptBtn) return;
        getActiveTab().then(tab => {
            if (!tab || !tab.id || !isYouTubeWatchUrl(tab.url)) {
                // Non-YouTube or non-watch page → hide the action entirely (AC3).
                copyTranscriptBtn.hidden = true;
                setTranscriptStatus('', '');
                return;
            }
            copyTranscriptBtn.hidden = false;

            // Surface the "Include timestamps" option and restore the saved
            // preference. The flag is forwarded to content-youtube.js, which
            // prefixes each line with its timestamp when set.
            if (includeTimestampsLabel) includeTimestampsLabel.hidden = false;
            if (includeTimestampsToggle) {
                chrome.storage.sync.get(['includeTimestamps'], (r) => {
                    includeTimestampsToggle.checked = !!(r && r.includeTimestamps);
                });
                includeTimestampsToggle.addEventListener('change', () => {
                    chrome.storage.sync.set({ includeTimestamps: includeTimestampsToggle.checked });
                });
            }

            copyTranscriptBtn.addEventListener('click', () => {
                setTranscriptStatus('Copying…', 'pending');
                chrome.tabs.sendMessage(
                    tab.id,
                    {
                        action: 'getTranscript',
                        includeTimestamps: !!(includeTimestampsToggle && includeTimestampsToggle.checked),
                    },
                    (response) => {
                        // No receiver (content script not injected) → lastError set.
                        if (chrome.runtime && chrome.runtime.lastError) {
                            const r = decideTranscriptResult(undefined);
                            setTranscriptStatus(r.message, 'error');
                            return;
                        }
                        const result = decideTranscriptResult(response);
                        if (result.status === 'ok') {
                            // Clipboard is written ONLY here, on the user's click
                            // (NFR-S6), and only plain text.
                            navigator.clipboard.writeText(result.text).then(() => {
                                setTranscriptStatus(result.message, 'success');
                            }).catch(() => {
                                setTranscriptStatus(
                                    'Copy failed — clipboard unavailable.', 'error');
                            });
                        } else {
                            setTranscriptStatus(result.message, result.status);
                        }
                    }
                );
            });
        });
    }

    initTranscriptControl();

    // Focus the slider for better keyboard navigation
    speedSlider.focus();
});

// Test exports (Node.js only — ignored by browser)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getDomainFromUrl, capPerSiteMap, isValidSpeed, buildSpeedWrite,
        isYouTubeWatchUrl, decideTranscriptResult, getPresetSpeeds,
        // Gauge geometry — exported for unit tests and future coverage.
        gaugeFrac, gaugeAngleDeg, gaugeArcPath, gaugeNeedleEnd, gaugeGateLine, gaugeCapLabel,
    };
}
