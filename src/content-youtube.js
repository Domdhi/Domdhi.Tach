/**
 * content-youtube.js — YouTube content cleanup module (Epic 5).
 *
 * Scoped to YouTube only (manifest `matches: *://*.youtube.com/*`). Hides Shorts
 * (FR-14) and comments / live-chat (FR-15) based on the synced `hideShorts` /
 * `hideComments` toggles (both default OFF — cleanup is opt-in), and suppresses
 * the live/premiere chat panel in FULLSCREEN via the `hideChatFullscreen` toggle
 * (FR-22, default ON — see applyFullscreenChatStyle). Also optionally auto-skips
 * ads by seeking the ad <video> to its end via the `skipAds` toggle (FR-21,
 * Integration #4, default OFF — see seekAdToEnd).
 *
 * Isolated from the universal content.js (which runs on every site) so YouTube
 * DOM logic never touches the speed controller's shared surface. This module
 * carries its OWN copy of the Story 3.1 settings schema (ADR-002: no bundler, so
 * the schema is DUPLICATED verbatim — keep IDENTICAL with content.js /
 * popup/popup.js / options/options.js; canonical shape in
 * docs/_project-architecture.md → Storage Schema).
 *
 * NFR-R2 (fail safe): YouTube's DOM changes without notice. Every selector query
 * is wrapped so a bad/missing selector NO-OPS and never throws.
 * NFR-P5: newly rendered targets are hidden within 200ms of an SPA re-render via
 * the MutationObserver (debounced below the 200ms budget).
 *
 * REALM ISOLATION: the entire module is wrapped in an IIFE. On a YouTube page this
 * file and content.js inject into the SAME isolated world / shared global lexical
 * scope; a bare top-level `const` here that also exists in content.js (notably
 * `DEFAULT_SETTINGS`) throws "Identifier already declared" and silently kills this
 * whole script (which is why YouTube cleanup + transcript previously did nothing on
 * a real page). The IIFE leaks no top-level binding, so it cannot collide.
 */
(function () {

// Shared settings schema — single source (constants.js, loaded first via the
// manifest content_scripts array; require('./constants') under Node tests).
const VSC = (typeof module !== 'undefined' && module.exports)
    ? require('./constants')
    : (typeof self !== 'undefined' ? self.VSC : globalThis.VSC);
const { DEFAULT_SETTINGS } = VSC;

/**
 * Resolve a stored settings object against the defaults (Story 3.1). Pure.
 * Mirrors content.js resolveSettings — object/array values returned as copies.
 */
function resolveSettings(stored) {
    const s = stored || {};
    return {
        defaultPlaybackSpeed: s.defaultPlaybackSpeed !== undefined
            ? s.defaultPlaybackSpeed : DEFAULT_SETTINGS.defaultPlaybackSpeed,
        redlineSpeed: s.redlineSpeed !== undefined
            ? s.redlineSpeed : DEFAULT_SETTINGS.redlineSpeed,
        perSiteSpeeds: s.perSiteSpeeds !== undefined
            ? { ...s.perSiteSpeeds } : { ...DEFAULT_SETTINGS.perSiteSpeeds },
        customPresets: s.customPresets !== undefined
            ? [...s.customPresets] : [...DEFAULT_SETTINGS.customPresets],
        hideShorts: s.hideShorts !== undefined
            ? s.hideShorts : DEFAULT_SETTINGS.hideShorts,
        hideComments: s.hideComments !== undefined
            ? s.hideComments : DEFAULT_SETTINGS.hideComments,
        hideChatFullscreen: s.hideChatFullscreen !== undefined
            ? s.hideChatFullscreen : DEFAULT_SETTINGS.hideChatFullscreen,
        skipAds: s.skipAds !== undefined
            ? s.skipAds : DEFAULT_SETTINGS.skipAds,
        theme: s.theme !== undefined ? s.theme : DEFAULT_SETTINGS.theme,
        accentColor: s.accentColor !== undefined
            ? s.accentColor : DEFAULT_SETTINGS.accentColor,
    };
}

/**
 * Read the full settings object from chrome.storage.sync, applying defaults for
 * any unset key (Story 3.1 pattern). Reads the known keys explicitly so behavior
 * matches the duplicated schema copies.
 */
function getSettings(callback) {
    chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS), (stored) => {
        callback(resolveSettings(stored));
    });
}

/** Class added to every node this module hides — also the off-switch hook. */
const VSC_YT_HIDDEN_CLASS = 'vsc-yt-hidden';

/**
 * CSS selectors for Shorts shelves / entry points (FR-14, Story 4.2).
 *
 * Mix of stable element selectors and `:has()` refinements. The `:has()` ones
 * target a container by a descendant (e.g. the whole shelf-section wrapping a
 * Shorts shelf, or a sidebar entry whose link is "Shorts") — they are evaluated
 * in Chrome but harmlessly skipped where unsupported, because hideBySelectors
 * wraps every query in try/catch (NFR-R2). Ordering is irrelevant; each selector
 * is applied independently.
 */
const SHORTS_SELECTORS = [
    // The Shorts shelf — the single biggest distraction (home, subs, search).
    'ytd-reel-shelf-renderer',
    'ytd-rich-shelf-renderer[is-shorts]',
    // Newer web-component Shorts shelf.
    'grid-shelf-view-model',
    // The rich section wrapping a Shorts shelf — removes residual spacing too.
    'ytd-rich-section-renderer:has(ytd-reel-shelf-renderer)',
    'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])',
    // Individual Shorts items that appear inline in feeds / search.
    'ytd-video-renderer:has(a[href^="/shorts/"])',
    'ytd-grid-video-renderer:has(a[href^="/shorts/"])',
    // Sidebar / mini-sidebar Shorts entry points.
    'ytd-guide-entry-renderer:has(a[title="Shorts"])',
    'ytd-mini-guide-entry-renderer:has(a[title="Shorts"])',
    'ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
];

/**
 * CSS selectors for the comments section AND the live/premiere live-chat panel
 * (FR-15, Story 4.4).
 *
 * Two distinct targets:
 *  1. The static comments thread under a watch page (`ytd-comments#comments`).
 *  2. The live/premiere LIVE-CHAT panel (`ytd-live-chat-frame`, `#chat-container`,
 *     `iframe#chatframe`). This is the one that stays pinned open on live and
 *     premiere videos AND persists into fullscreen — YouTube re-shows it via its
 *     own styles, which is exactly why hideBySelectors applies
 *     `display:none !important` (a plain class/`display:none` loses to YouTube's
 *     inline/important rules and the panel reappears in fullscreen).
 */
const COMMENTS_SELECTORS = [
    // Static comments thread. (Bare `#comments` dropped per sweep E5-3 — it is
    // subsumed by ytd-comments#comments and only widened the blast radius.)
    'ytd-comments#comments',
    // Live / premiere live-chat panel (incl. the fullscreen-persistent case).
    'ytd-live-chat-frame',
    '#chat-container',
    'iframe#chatframe',
];

/** Live cleanup state — updated from storage on load and on change. */
let currentSettings = {
    hideShorts: DEFAULT_SETTINGS.hideShorts,
    hideComments: DEFAULT_SETTINGS.hideComments,
    hideChatFullscreen: DEFAULT_SETTINGS.hideChatFullscreen,
    skipAds: DEFAULT_SETTINGS.skipAds,
};

/**
 * Fullscreen Top-chat suppression (FR-22, Integration #5). Confirmed live
 * 2026-06-06 on a Premiere; the layout has two gotchas that shape this design:
 *
 * In fullscreen YouTube builds `#full-bleed-container` as a flexbox of
 * `#player-full-bleed-container` (flex:1) and `#panels-full-bleed-container`
 * (~402px — the column that hosts the live/premiere chat, the SAME
 * `ytd-live-chat-frame#chat` reparented there), and sets a `fullscreen` attribute
 * on the `ytd-watch-flexy` ancestor.
 *
 *  GOTCHA 1 — hide the COLUMN, not the chat. Hiding `ytd-live-chat-frame` alone
 *  leaves the 402px panel column reserved and BLACK (the player flex:1 stays at
 *  1518px). We must hide `#panels-full-bleed-container` so flexbox gives the
 *  player the full width. `:has(ytd-live-chat-frame)` scopes the hide to when the
 *  panel actually holds chat (leaves a fullscreen transcript panel alone).
 *
 *  GOTCHA 2 — CSS reflows the container but NOT the <video>. YouTube sizes the
 *  actual <video> element only in response to window 'resize' events. With the
 *  column hidden the player container jumps to 1920px immediately, but <video>
 *  stayed 1518px until a resize fired (then → 1828, full 16:9). So the CSS hide
 *  MUST be paired with a JS resize nudge (nudgePlayerResize) on fullscreenchange.
 *
 * The CSS rule is scoped to `ytd-watch-flexy[fullscreen]`, so it self-reverts the
 * instant YouTube drops the attribute on exit. INDEPENDENT of `hideComments`
 * (which hides chat in ALL modes); this hides chat in fullscreen ONLY, leaving
 * the windowed sidebar chat untouched.
 */
const FS_CHAT_STYLE_ID = 'vsc-yt-fs-chat-style';
const FS_CHAT_CSS =
    'ytd-watch-flexy[fullscreen] #panels-full-bleed-container:has(ytd-live-chat-frame) {\n' +
    '  display: none !important;\n' +
    '}';

/**
 * Inject (enabled) or remove (disabled) the fullscreen-chat suppression style.
 * Idempotent: re-injecting when already present is a no-op, removing when absent
 * is a no-op. The CSS rule itself is fullscreen-scoped, so this style can sit in
 * the document permanently while ON and only takes effect in fullscreen. Never
 * throws (NFR-R2). The symmetric counterpart is the CSS cascade, not a JS revert.
 */
function applyFullscreenChatStyle(enabled, root) {
    const doc = root || (typeof document !== 'undefined' ? document : null);
    if (!doc || !doc.head) return;
    try {
        const existing = doc.getElementById(FS_CHAT_STYLE_ID);
        if (enabled) {
            if (existing) return;
            const style = doc.createElement('style');
            style.id = FS_CHAT_STYLE_ID;
            style.textContent = FS_CHAT_CSS;
            doc.head.appendChild(style);
        } else if (existing) {
            existing.remove();
        }
    } catch (_) {
        // A malformed document / hostile head must never throw out (NFR-R2).
    }
}

/**
 * Delays (ms) at which nudgePlayerResize re-fires the resize event. The first
 * (0) fires immediately; the later ones outlast YouTube's own fullscreen-entry
 * layout pass, which would otherwise re-size <video> back to the chat-present
 * width AFTER our immediate nudge. Verified live: a single late resize corrects
 * 1518 → 1828.
 */
const FS_RESIZE_NUDGE_DELAYS_MS = [0, 200, 500, 800];

/**
 * Make YouTube re-size the <video> to the now-full-width player after the chat
 * column is CSS-collapsed (GOTCHA 2 above). YouTube's player listens for window
 * 'resize'; dispatching it is the documented way to force a re-layout. Fired at
 * several delays so it wins against YouTube's own settling. Never throws
 * (NFR-R2). setTimeoutFn/window are injectable for tests.
 */
function nudgePlayerResize(opts) {
    const o = opts || {};
    const win = o.window || (typeof window !== 'undefined' ? window : null);
    const setT = o.setTimeoutFn
        || (typeof setTimeout !== 'undefined' ? setTimeout : null);
    if (!win || typeof win.dispatchEvent !== 'function') return;
    const fire = () => {
        try { win.dispatchEvent(new Event('resize')); } catch (_) { /* NFR-R2 */ }
    };
    for (const delay of FS_RESIZE_NUDGE_DELAYS_MS) {
        if (delay === 0) { fire(); continue; }
        if (setT) setT(fire, delay);
    }
}

/**
 * fullscreenchange handler: when the fullscreen-chat suppression is enabled, nudge
 * the player to re-size so the freed chat column is filled by the video (the CSS
 * hide alone reflows the container but not <video> — GOTCHA 2). A no-op when the
 * feature is off. Fires on both enter and exit (a redundant resize on exit is
 * harmless and covers YouTube's own exit-layout edge cases). Never throws.
 */
function handleFullscreenChange() {
    try {
        if (currentSettings.hideChatFullscreen) nudgePlayerResize();
    } catch (_) {
        // Never throw out of an event listener (NFR-R2).
    }
}

/**
 * Ad-skipper (Integration #4, `skipAds` toggle — default OFF). Feasibility spike
 * 2026-06-06 (live probe of real Chrome) settled the mechanism:
 *
 *  - Maxing the ad <video> playbackRate is RESET to 1 by YouTube within ~600ms.
 *  - The skip button (`.ytp-skip-ad-button`) REJECTS synthetic clicks — it needs
 *    a trusted (isTrusted) gesture, which a content script cannot forge (the same
 *    wall as programmatic autoplay/fullscreen).
 *  - Seeking the ad <video> to its end IS honored: it ends the creative and walks
 *    through ad pods (multiple ads back-to-back) to the main content.
 *
 * So seek-to-end is the ONLY viable approach. YouTube plays ads on the SAME
 * <video> element as content, adding `.ad-showing` on `.html5-video-player`
 * for the duration of an ad. Full writeup:
 * docs/.output/investigations/2026-06-06-ad-skipper-feasibility-spike.md
 */
const AD_PLAYER_AD_SELECTOR = '.html5-video-player.ad-showing';

/**
 * Don't re-seek a creative we've already sent to its end: once currentTime is
 * within this many seconds of duration, seekAdToEnd no-ops. This is the debounce
 * — after a seek, currentTime≈duration, so the guard fails until the NEXT
 * creative loads (currentTime resets low, duration changes). Handles ad pods with
 * no per-creative bookkeeping.
 */
const AD_SKIP_NEAR_END_S = 1.5;
/** Seek target offset from the end (landing just shy of duration). */
const AD_SKIP_LANDING_S = 0.1;
/** Poll cadence (ms) while skipAds is enabled. The spike's proven interval. */
const AD_SKIP_POLL_MS = 500;

/**
 * If an ad is showing and its <video> is loaded and not already near its end,
 * seek it to the end (which ends the ad). Returns true iff it performed a seek.
 *
 * Guards (each makes it a no-op, returning false):
 *  - no `.html5-video-player.ad-showing` (not in an ad);
 *  - no <video> element;
 *  - duration not a finite number > 1 (covers the transient 0/0 buffering frame
 *    between ad-pod creatives, and NaN before metadata loads);
 *  - currentTime already within AD_SKIP_NEAR_END_S of the end (debounce).
 *
 * Never throws (NFR-R2): any hostile/partial DOM returns false.
 * @param {Element|Document} [root] - defaults to document
 * @returns {boolean}
 */
function seekAdToEnd(root) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope || !scope.querySelector) return false;
    try {
        // Scope the <video> to the matched ad player — NEVER re-query from the
        // document. A watch page can hold a second <video> earlier in DOM order
        // (recommendation hover-preview, miniplayer, Shorts shelf); a bare
        // document.querySelector('video') after the ad-presence check would
        // fast-forward the WRONG video (sweep finding M1).
        const player = scope.querySelector(AD_PLAYER_AD_SELECTOR);
        if (!player) return false; // not an ad
        const video = player.querySelector('video');
        if (!video) return false;
        const dur = video.duration;
        // Number.isFinite rejects NaN (pre-metadata), 0/0 (the buffering frame
        // between pod creatives), AND Infinity (live-stream ads) — the last would
        // otherwise pass `> 1` and seek to Infinity every tick (sweep finding m1).
        if (!Number.isFinite(dur) || !(dur > 1)) return false;
        if (!(video.currentTime < dur - AD_SKIP_NEAR_END_S)) return false; // debounce
        video.currentTime = dur - AD_SKIP_LANDING_S;
        return true;
    } catch (_) {
        return false; // NFR-R2
    }
}

/** Polling handle for the ad-skip loop; null when not running. */
let adSkipTimer = null;

/**
 * Start the ad-skip polling loop (idempotent). Polls seekAdToEnd(document) every
 * AD_SKIP_POLL_MS while running — cheap when no ad is showing (one querySelector
 * that returns null). setIntervalFn is injectable for tests. Never throws.
 */
function startAdSkip(opts) {
    const o = opts || {};
    const setI = o.setIntervalFn
        || (typeof setInterval !== 'undefined' ? setInterval : null);
    if (adSkipTimer !== null || !setI) return; // already running, or no scheduler
    adSkipTimer = setI(() => {
        try { seekAdToEnd(document); } catch (_) { /* NFR-R2 */ }
    }, AD_SKIP_POLL_MS);
}

/**
 * Stop the ad-skip polling loop (idempotent). The symmetric counterpart to
 * startAdSkip — toggling skipAds OFF on a live page must halt polling, not wait
 * for a reload ([[symmetric-live-handler-rule]]). clearIntervalFn injectable for
 * tests. Never throws.
 */
function stopAdSkip(opts) {
    const o = opts || {};
    const clearI = o.clearIntervalFn
        || (typeof clearInterval !== 'undefined' ? clearInterval : null);
    if (adSkipTimer === null) return;
    if (clearI) clearI(adSkipTimer);
    adSkipTimer = null;
}

/**
 * Hide every element matching any selector in `selectors`, under `root`.
 * Returns the number of elements newly hidden. NFR-R2: each selector query is
 * isolated in try/catch so one malformed/unsupported selector can never abort
 * the rest or throw out of the module.
 *
 * Uses `display:none !important` (not just the class) so the rule wins against
 * YouTube's own inline/important styles — important for the live-chat panel,
 * which YouTube re-shows (incl. in fullscreen) via its own styles.
 */
function hideBySelectors(selectors, root) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope || !scope.querySelectorAll) return 0;
    let hidden = 0;
    for (const selector of selectors) {
        let nodes;
        try {
            nodes = scope.querySelectorAll(selector);
        } catch (_) {
            // Invalid/unsupported selector — skip it, never throw (NFR-R2).
            continue;
        }
        for (const node of nodes) {
            try {
                // Re-assert whenever display isn't already OUR 'none' — covers both
                // the first hide and YouTube clearing the inline style back to '' on
                // a re-render (the divergence the MutationObserver re-fires on).
                if (node.style && node.style.getPropertyValue('display') !== 'none') {
                    node.style.setProperty('display', 'none', 'important');
                }
                if (node.classList) node.classList.add(VSC_YT_HIDDEN_CLASS);
                hidden++;
            } catch (_) {
                // A single node failing must not stop the sweep (NFR-R2).
            }
        }
    }
    return hidden;
}

/**
 * Reverse every hide this module applied: remove the inline display override and
 * the marker class from all tagged nodes. The symmetric counterpart to
 * applyCleanup (sweep finding E5-1) — required so toggling a feature OFF on a
 * LIVE page restores content immediately, not only after a reload. The onChanged
 * handler calls this, then applyCleanup re-hides whatever is still enabled.
 * Never throws (NFR-R2).
 */
function unhideAll(root) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope || !scope.querySelectorAll) return 0;
    let nodes;
    try {
        nodes = scope.querySelectorAll('.' + VSC_YT_HIDDEN_CLASS);
    } catch (_) {
        return 0;
    }
    let restored = 0;
    for (const node of nodes) {
        try {
            if (node.style) node.style.removeProperty('display');
            if (node.classList) node.classList.remove(VSC_YT_HIDDEN_CLASS);
            restored++;
        } catch (_) {
            // A single node failing must not stop the restore (NFR-R2).
        }
    }
    return restored;
}

/** Hide Shorts when enabled (FR-14, Story 4.2). */
function hideShorts(root) {
    return hideBySelectors(SHORTS_SELECTORS, root);
}

/** Hide comments + live-chat when enabled (FR-15). Selectors land in Story 4.4. */
function hideComments(root) {
    return hideBySelectors(COMMENTS_SELECTORS, root);
}

/**
 * Apply the active cleanup toggles to `root` (default: document). Branches on
 * currentSettings; with both toggles OFF this is a no-op and the page is left
 * unmodified (an explicit AC). Never throws (NFR-R2).
 */
function applyCleanup(root) {
    let total = 0;
    if (currentSettings.hideShorts) total += hideShorts(root);
    if (currentSettings.hideComments) total += hideComments(root);
    return total;
}

/**
 * Debounce window for the MutationObserver. YouTube is an SPA that mutates the
 * DOM heavily; coalescing bursts keeps us off the main thread while staying well
 * under the NFR-P5 200ms budget for hiding newly rendered targets.
 */
const CLEANUP_DEBOUNCE_MS = 100;
let cleanupTimer = null;

function scheduleCleanup() {
    if (cleanupTimer !== null) return;
    cleanupTimer = setTimeout(() => {
        cleanupTimer = null;
        applyCleanup(document);
    }, CLEANUP_DEBOUNCE_MS);
}

/**
 * MutationObserver shell — re-applies cleanup as YouTube renders/replaces nodes
 * across SPA navigation. Started by init(). Only schedules work when at least
 * one toggle is ON, so an all-OFF page does zero work.
 */
let observer = null;

function startObserver() {
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver(() => {
        if (currentSettings.hideShorts || currentSettings.hideComments) {
            scheduleCleanup();
        }
    });
    if (typeof document !== 'undefined' && document.documentElement) {
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }
}

/**
 * YouTube ships TWO transcript UIs (confirmed live 2026-06-06): an OLDER
 * Polymer one and a NEWER "view-model" rollout. extractTranscript tries each in
 * order, so the extension works regardless of which variant a given video/page
 * is served. Each variant names its segment row, the text node within it, and
 * the timestamp node within it.
 *
 *   OLD: <ytd-transcript-segment-renderer>
 *          <... .segment-timestamp>0:04</...>  <yt-formatted-string .segment-text>…</>
 *   NEW: <transcript-segment-view-model>
 *          <div .ytwTranscriptSegmentViewModelTimestamp>0:05</div>
 *          <div .…TimestampA11yLabel>5 seconds</div>   ← MUST be excluded from text
 *          <span .ytAttributedStringHost>…</span>
 *
 * TRANSCRIPT_SEGMENT_SELECTOR (the old row) is exported so tests assert the
 * contract without hard-coding the string.
 */
const TRANSCRIPT_SEGMENT_SELECTOR = 'ytd-transcript-segment-renderer';
const TRANSCRIPT_TEXT_SELECTOR = '.segment-text';

const TRANSCRIPT_VARIANTS = [
    // Older Polymer transcript UI.
    {
        segment: TRANSCRIPT_SEGMENT_SELECTOR,
        text: TRANSCRIPT_TEXT_SELECTOR,
        timestamp: '.segment-timestamp',
    },
    // Newer view-model transcript UI. The a11y label ("5 seconds") shares the
    // segment, so the text selector deliberately targets only the attributed
    // string span, and readSegmentLine drops any text node inside the timestamp.
    {
        segment: 'transcript-segment-view-model',
        text: 'span.ytAttributedStringHost',
        timestamp: '.ytwTranscriptSegmentViewModelTimestamp',
    },
];

/**
 * Read one segment row to a line, per a TRANSCRIPT_VARIANTS entry. Joins the
 * text node(s), excluding anything inside the timestamp container (NEW-UI a11y
 * label safety). With includeTimestamps, prefixes "<ts>\t". Returns '' on no
 * text. Never throws (the caller wraps it, but we stay defensive — NFR-R2).
 */
function readSegmentLine(seg, variant, includeTimestamps) {
    let textEls = [];
    try { textEls = [...seg.querySelectorAll(variant.text)]; } catch (_) { return ''; }
    const text = textEls
        .filter((el) => !(variant.timestamp && el.closest && el.closest(variant.timestamp)))
        .map((el) => (el.textContent || '').trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) return '';
    if (!includeTimestamps) return text;
    let ts = '';
    try { ts = (seg.querySelector(variant.timestamp)?.textContent || '').trim(); } catch (_) { ts = ''; }
    return ts ? `${ts}\t${text}` : text;
}

/**
 * Read the YouTube transcript panel into plain text, trying each UI variant
 * (old Polymer, then new view-model) until one yields lines. Timestamps are
 * stripped by default; pass { includeTimestamps: true } to prefix each line
 * with its timestamp (tab-separated). Fail-safe (NFR-R2): never throws; ANY
 * failure path returns { available:false, text:'' }.
 * @param {Element|Document} [root] - defaults to document
 * @param {{includeTimestamps?: boolean}} [opts]
 * @returns {{available: boolean, text: string}}
 */
function extractTranscript(root, opts) {
    const includeTimestamps = !!(opts && opts.includeTimestamps);
    try {
        const scope = (root != null && root.querySelectorAll)
            ? root
            : (typeof document !== 'undefined' ? document : null);
        if (!scope) return { available: false, text: '' };

        for (const variant of TRANSCRIPT_VARIANTS) {
            let segments;
            try { segments = scope.querySelectorAll(variant.segment); } catch (_) { continue; }
            if (!segments || segments.length === 0) continue;

            const lines = [];
            for (const seg of segments) {
                try {
                    const line = readSegmentLine(seg, variant, includeTimestamps);
                    if (line) lines.push(line);
                } catch (_) {
                    // A single segment failing must not abort the rest (NFR-R2).
                }
            }
            if (lines.length > 0) return { available: true, text: lines.join('\n') };
        }
        return { available: false, text: '' };
    } catch (_) {
        // Any failure — hostile root, unexpected DOM structure, etc. (NFR-R2).
        return { available: false, text: '' };
    }
}

/**
 * Engagement-panel that hosts the transcript, and the "expanded" visibility
 * value YouTube sets on it once open. The transcript segments
 * (TRANSCRIPT_SEGMENT_SELECTOR) are NOT in the DOM until this panel is opened,
 * and even then they load asynchronously via a continuation request — which is
 * why a single synchronous extractTranscript() saw zero segments and reported
 * "no transcript" on videos that have one (investigation 2026-06-06).
 */
const TRANSCRIPT_PANEL_SELECTOR = '[target-id="engagement-panel-searchable-transcript"]';
const TRANSCRIPT_PANEL_EXPANDED = 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED';

/**
 * Affordances that open the transcript. The exact aria-label button is tried
 * first, then the description-section button. We deliberately do NOT use a fuzzy
 * `aria-label*="transcript"` selector — it also matches the "Close transcript"
 * button, which would TOGGLE an open panel shut.
 */
const SHOW_TRANSCRIPT_BUTTON_SELECTORS = [
    'button[aria-label="Show transcript"]',
    'ytd-video-description-transcript-section-renderer button',
];

/** The description "...more" expander — the Show-transcript button often only
 * renders once the description is expanded, so we click this to reveal it. */
const DESCRIPTION_EXPAND_SELECTOR = '#expand';

/** Poll budget while waiting for the async segment list to populate (~5s). */
const TRANSCRIPT_POLL_TRIES = 20;
const TRANSCRIPT_POLL_INTERVAL_MS = 250;

/**
 * True when the transcript engagement panel is present AND expanded. Used to
 * avoid clicking "Show transcript" a second time (which would TOGGLE it shut)
 * when the user — or a prior tick — already opened it. Never throws (NFR-R2).
 */
function isTranscriptPanelOpen(root) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope || !scope.querySelector) return false;
    try {
        const panel = scope.querySelector(TRANSCRIPT_PANEL_SELECTOR);
        return !!(panel && panel.getAttribute('visibility') === TRANSCRIPT_PANEL_EXPANDED);
    } catch (_) {
        return false;
    }
}

/**
 * Is `el` actually shown? YouTube renders multiple "Show transcript" buttons —
 * a visible one plus hidden/detached duplicates (0×0). Clicking a hidden one
 * no-ops, so the panel never opens (the exact failure on the new-UI video).
 * jsdom has no layout (every rect is 0×0, offsetParent null), so this returns
 * false there — openTranscriptPanel falls back to the first match for tests.
 */
function isElementVisible(el) {
    try {
        if (!el || el.offsetParent === null) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    } catch (_) {
        return false;
    }
}

/**
 * Best-effort: click the "Show transcript" affordance to open the panel.
 * Returns true ONLY when it clicked a show-transcript button (so the caller can
 * stop trying to open — clicking again would toggle the panel shut). Prefers a
 * VISIBLE button over hidden duplicates; if none read as visible (e.g. jsdom, or
 * before layout), falls back to the first match. When no button exists yet, it
 * clicks the description expander to surface it and returns false, letting the
 * poll loop retry on the next tick. Never throws (NFR-R2).
 */
function openTranscriptPanel(root) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope || !scope.querySelectorAll) return false;
    try {
        let firstMatch = null;
        for (const sel of SHOW_TRANSCRIPT_BUTTON_SELECTORS) {
            let btns;
            try { btns = scope.querySelectorAll(sel); } catch (_) { continue; }
            for (const btn of btns) {
                if (!btn || typeof btn.click !== 'function') continue;
                if (!firstMatch) firstMatch = btn;
                if (isElementVisible(btn)) { btn.click(); return true; }
            }
        }
        // No visibly-shown button — click the first match anyway (covers jsdom /
        // pre-layout). If there was none, expand the description to surface it.
        if (firstMatch) { firstMatch.click(); return true; }
        let expand;
        try { expand = scope.querySelector(DESCRIPTION_EXPAND_SELECTOR); } catch (_) { expand = null; }
        if (expand && typeof expand.click === 'function') expand.click();
        return false;
    } catch (_) {
        return false;
    }
}

/**
 * Resolve the transcript to plain text, OPENING the panel and POLLING for the
 * async segment list if it isn't already loaded. Calls `callback` exactly once
 * with the same {available, text} shape extractTranscript returns.
 *
 * Flow: (1) if segments are already present, extract synchronously and return;
 * (2) otherwise open the panel and poll every intervalMs up to maxTries, then
 * (3) give up with {available:false, text:''}. Never throws (NFR-R2).
 *
 * @param {(r:{available:boolean,text:string})=>void} callback
 * @param {{maxTries?:number, intervalMs?:number, setTimeoutFn?:Function, includeTimestamps?:boolean}} [opts]
 *   Injectable for tests; defaults to the module constants + global setTimeout.
 *   includeTimestamps is forwarded to extractTranscript.
 */
function getTranscriptText(callback, opts) {
    const o = opts || {};
    const maxTries = o.maxTries != null ? o.maxTries : TRANSCRIPT_POLL_TRIES;
    const intervalMs = o.intervalMs != null ? o.intervalMs : TRANSCRIPT_POLL_INTERVAL_MS;
    const setT = o.setTimeoutFn
        || (typeof setTimeout !== 'undefined' ? setTimeout : null);
    const extractOpts = { includeTimestamps: !!o.includeTimestamps };

    const done = (r) => { try { callback(r); } catch (_) { /* NFR-R2 */ } };

    // (1) Already loaded — the fast path (also the case where the user had the
    // transcript open before clicking). Resolves synchronously.
    const immediate = extractTranscript(document, extractOpts);
    if (immediate.available) { done(immediate); return; }

    // (2) Open the panel (once) and poll for the segments to render.
    let tries = 0;
    let opened = false;

    const tick = () => {
        const result = extractTranscript(document, extractOpts);
        if (result.available) { done(result); return; }

        if (!opened) {
            opened = isTranscriptPanelOpen(document) || openTranscriptPanel(document);
        }

        tries++;
        if (tries >= maxTries || !setT) { done({ available: false, text: '' }); return; }
        setT(tick, intervalMs);
    };
    tick();
}

/**
 * chrome.runtime.onMessage handler. For message.action === 'getTranscript',
 * open the transcript panel if needed, poll for the async segment list, and
 * sendResponse with the {available,text} result. Returns TRUE to keep the
 * message channel open for the asynchronous sendResponse (the segment list
 * loads after the panel opens — see getTranscriptText). For any other/garbage/
 * null message, do nothing and return false. Must never throw (NFR-R2).
 */
function handleMessage(message, sender, sendResponse) {
    // Trust boundary: only accept messages from this extension's own pages.
    if (!sender || sender.id !== chrome.runtime.id) return false;
    try {
        if (message && message.action === 'getTranscript') {
            getTranscriptText(sendResponse, { includeTimestamps: !!message.includeTimestamps });
            return true; // async sendResponse — keep the port open
        }
    } catch (_) {
        // Never throw out of the message handler (NFR-R2).
    }
    return false;
}

/**
 * Initialize: read settings, run an initial cleanup pass, and start observing.
 * Also re-reads on storage changes so toggling in the options page takes effect
 * on the next observed mutation (and immediately for the current page).
 */
function init() {
    getSettings((settings) => {
        currentSettings.hideShorts = settings.hideShorts;
        currentSettings.hideComments = settings.hideComments;
        currentSettings.hideChatFullscreen = settings.hideChatFullscreen;
        currentSettings.skipAds = settings.skipAds;
        applyCleanup(document);
        applyFullscreenChatStyle(currentSettings.hideChatFullscreen);
        if (currentSettings.skipAds) startAdSkip();
        startObserver();
    });

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'sync') return;
            if (!changes.hideShorts && !changes.hideComments
                && !changes.hideChatFullscreen && !changes.skipAds) return;
            if (changes.hideShorts) currentSettings.hideShorts = changes.hideShorts.newValue;
            if (changes.hideComments) currentSettings.hideComments = changes.hideComments.newValue;
            // Fullscreen-chat is CSS-only and independent of the class-based
            // cleanup below: inject/remove its style on toggle (it self-applies
            // only in fullscreen via the [fullscreen]-scoped rule).
            if (changes.hideChatFullscreen) {
                currentSettings.hideChatFullscreen = changes.hideChatFullscreen.newValue;
                applyFullscreenChatStyle(currentSettings.hideChatFullscreen);
                // GOTCHA 2 (sweep finding M2): hiding the chat column reflows the
                // container but YouTube only re-sizes <video> on a window resize.
                // fullscreenchange fires the nudge on transitions, but toggling the
                // setting WHILE ALREADY in fullscreen needs it here too, or <video>
                // stays narrow with a black gap until the next transition. Inert /
                // idempotent when windowed (just a redundant resize event).
                nudgePlayerResize();
            }
            // Ad-skip is its own polling loop, independent of the class-based
            // cleanup: start/stop it symmetrically on toggle so a live page
            // honors the change without a reload.
            if (changes.skipAds) {
                currentSettings.skipAds = changes.skipAds.newValue;
                if (currentSettings.skipAds) startAdSkip(); else stopAdSkip();
            }
            // Symmetric apply/revert (sweep E5-1): restore everything this module
            // hid, then re-hide whatever is still enabled. Handles ON, OFF, and
            // flipping one of two features live — no page reload required.
            unhideAll(document);
            applyCleanup(document);
        });
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener(handleMessage);
    }

    // Resize the player to fill the freed chat column on every fullscreen
    // transition (GOTCHA 2 — CSS reflows the container, not <video>). Guarded by
    // the toggle inside the handler so an OFF setting is inert.
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('fullscreenchange', handleFullscreenChange);
    }
}

// --- Startup (ignored under Node test import via the guard below) ---
if (typeof chrome !== 'undefined' && chrome.storage) {
    init();
}

// Test exports (Node.js only — ignored by the browser content script). ADR-004.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DEFAULT_SETTINGS,
        resolveSettings,
        getSettings,
        VSC_YT_HIDDEN_CLASS,
        SHORTS_SELECTORS,
        COMMENTS_SELECTORS,
        hideBySelectors,
        hideShorts,
        hideComments,
        applyCleanup,
        unhideAll,
        FS_CHAT_STYLE_ID,
        FS_CHAT_CSS,
        applyFullscreenChatStyle,
        FS_RESIZE_NUDGE_DELAYS_MS,
        nudgePlayerResize,
        handleFullscreenChange,
        AD_PLAYER_AD_SELECTOR,
        AD_SKIP_NEAR_END_S,
        AD_SKIP_LANDING_S,
        AD_SKIP_POLL_MS,
        seekAdToEnd,
        startAdSkip,
        stopAdSkip,
        _isAdSkipRunning: () => adSkipTimer !== null,
        CLEANUP_DEBOUNCE_MS,
        TRANSCRIPT_SEGMENT_SELECTOR,
        TRANSCRIPT_VARIANTS,
        TRANSCRIPT_PANEL_SELECTOR,
        TRANSCRIPT_PANEL_EXPANDED,
        SHOW_TRANSCRIPT_BUTTON_SELECTORS,
        DESCRIPTION_EXPAND_SELECTOR,
        extractTranscript,
        readSegmentLine,
        isElementVisible,
        isTranscriptPanelOpen,
        openTranscriptPanel,
        getTranscriptText,
        handleMessage,
        init,
        // Test seams
        _setSettings: (partial) => { currentSettings = { ...currentSettings, ...partial }; },
        _getSettings: () => ({ ...currentSettings }),
    };
}

})();
