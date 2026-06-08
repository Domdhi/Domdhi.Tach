/**
 * content.js — universal speed controller, injected into every page.
 *
 * Shared constants (speed range, the Story 3.1 settings schema, the per-site cap)
 * come from the single source constants.js, loaded first via the manifest
 * content_scripts array in the browser, or require('./constants') under Node tests.
 * See constants.js for the ADR-002 single-source rationale and the content-script
 * realm-collision it avoids. Canonical schema shape: docs/_project-architecture.md.
 */
const VSC = (typeof module !== 'undefined' && module.exports)
    ? require('./constants')
    : (typeof self !== 'undefined' ? self.VSC : globalThis.VSC);
const { SPEED_MIN, SPEED_MAX, DEFAULT_SETTINGS, MAX_PER_SITE_ENTRIES, clampSpeed } = VSC;

/**
 * Resolve a stored settings object against the defaults (Story 3.1).
 *
 * Pure function. Every key in DEFAULT_SETTINGS resolves to the stored value when
 * present, otherwise to its documented default. Backward-compatible with the
 * legacy single-key store: a store containing only `defaultPlaybackSpeed`
 * preserves that value and fills every other key with its default — no migration
 * and no data loss (we never write, so unknown legacy keys are left untouched).
 * Object/array values are always returned as copies — whether they come from the
 * stored value or the default — so callers get a private object and can mutate
 * freely without corrupting either the shared DEFAULT_SETTINGS reference or the
 * object handed back by chrome.storage.sync.get. (Uniform contract for the 13
 * downstream consumers of this helper.)
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
        theme: s.theme !== undefined
            ? s.theme : DEFAULT_SETTINGS.theme,
        accentColor: s.accentColor !== undefined
            ? s.accentColor : DEFAULT_SETTINGS.accentColor,
    };
}

/**
 * Read the full settings object from chrome.storage.sync, applying defaults
 * for any unset key (Story 3.1). The single read/write access pattern every
 * later feature (per-site, YouTube toggles, presets, theme) builds on.
 *
 * Reads the known keys explicitly (Object.keys(DEFAULT_SETTINGS)) rather than
 * `get(null)` so behavior is identical across the duplicated schema copies.
 */
function getSettings(callback) {
    chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS), (stored) => {
        callback(resolveSettings(stored));
    });
}

/**
 * Enforce the NFR-SC2 cap on a perSiteSpeeds map (Story 3.1). Returns a new
 * object with at most MAX_PER_SITE_ENTRIES entries, keeping the newest entries
 * (insertion order) and dropping the oldest. Never mutates the input.
 */
function capPerSiteSpeeds(perSiteSpeeds) {
    const map = perSiteSpeeds || {};
    // "Oldest = first-inserted" holds because keys are non-numeric domain strings
    // (registrable domains); JS preserves insertion order for non-integer keys.
    const keys = Object.keys(map);
    const kept = keys.length > MAX_PER_SITE_ENTRIES
        ? keys.slice(keys.length - MAX_PER_SITE_ENTRIES)
        : keys;
    const out = {};
    for (const k of kept) out[k] = map[k];
    return out;
}

/**
 * True when a value is a finite number within the allowed speed range
 * (Story 3.5). Single source of truth for "valid speed" on the resolution path,
 * so the per-site and global guards cannot drift apart.
 */
function isValidSpeed(value) {
    const v = parseFloat(value);
    return !isNaN(v) && v >= SPEED_MIN && v <= SPEED_MAX;
}

/**
 * Resolve a hostname to its registrable domain — naive eTLD+1 (Story 3.5).
 *
 * Returns the last two dot-separated labels, which is the registrable domain for
 * ordinary single-suffix TLDs (youtube.com, vimeo.com) and resolves any
 * subdomain (www./m./music.youtube.com → youtube.com).
 *
 * MUST MIRROR popup.js `getDomainFromUrl` (same eTLD+1 logic, same `< 2` label
 * boundary) — like the SPEED_MIN/MAX duplication, keep the two in lockstep.
 *
 * KNOWN LIMITATION: multi-part public suffixes (example.co.uk, site.github.io)
 * are NOT handled — there is no Public Suffix List without a bundler (ADR-002),
 * so "co.uk" would be treated as the registrable domain. Acceptable for the
 * per-site feature's target sites; revisit if multi-part TLD support is needed.
 */
function getRegistrableDomain(hostname) {
    if (!hostname || typeof hostname !== 'string') return '';
    const labels = hostname.split('.').filter(Boolean);
    if (labels.length < 2) return labels.join('.');
    return labels.slice(-2).join('.');
}

/**
 * Resolve the effective speed for a page (Story 3.5). A valid per-site override
 * for the page's registrable domain wins; otherwise the global default applies
 * (precedence: site → global). A missing, non-numeric, or out-of-range per-site
 * value falls back to the global default.
 */
function resolveSpeedForSite(perSiteSpeeds, hostname, globalDefault) {
    const map = perSiteSpeeds || {};
    const domain = getRegistrableDomain(hostname);
    if (domain && Object.prototype.hasOwnProperty.call(map, domain)
            && isValidSpeed(map[domain])) {
        return parseFloat(map[domain]);
    }
    return globalDefault;
}

/**
 * Current playback speed (1.0x = normal speed)
 * This will be overridden by the user's saved setting on init.
 */
let currentPlaybackSpeed = 1.0;
let isInitialized = false;

/**
 * Initialize with saved speed from storage.
 * This is the single initialization path — no duplicate storage reads.
 */
function initializeSpeed() {
    if (isInitialized) return;

    // Story 3.5: read the full settings object and resolve the effective speed
    // for this page — a per-site override for the registrable domain wins,
    // otherwise the global default applies (precedence: site → global).
    getSettings((settings) => {
        const hostname = (typeof location !== 'undefined' && location.hostname)
            ? location.hostname : '';
        const resolved = resolveSpeedForSite(
            settings.perSiteSpeeds, hostname, settings.defaultPlaybackSpeed);
        if (isValidSpeed(resolved)) {
            currentPlaybackSpeed = parseFloat(resolved);
            applyToAllVideos();
        }
        isInitialized = true;
    });
}

/**
 * Set speed for a single video element.
 */
function setVideoSpeed(video, speed) {
    if (!video) return false;

    try {
        const newSpeed = parseFloat(speed);
        if (isNaN(newSpeed) || newSpeed < SPEED_MIN || newSpeed > SPEED_MAX) return false;

        currentPlaybackSpeed = newSpeed;

        if (video.readyState > 0) {
            video.playbackRate = newSpeed;
            video.classList.add('vsc-speed-adjusted');
        }

        return true;
    } catch (error) {
        console.error('Error setting video speed:', error);
        return false;
    }
}

/**
 * Apply currentPlaybackSpeed to a single video, waiting for readiness if needed.
 */
function applyCurrentSpeed(video) {
    if (!video) return false;

    const applyWhenReady = () => {
        if (video.readyState > 0) {
            if (Math.abs(video.playbackRate - currentPlaybackSpeed) > 0.01) {
                video.playbackRate = currentPlaybackSpeed;
                video.classList.add('vsc-speed-adjusted');
            }
            if (video._vscReadyHandler) {
                video.removeEventListener('loadedmetadata', video._vscReadyHandler);
                video.removeEventListener('canplay', video._vscReadyHandler);
                video._vscReadyHandler = null;
            }
        }
    };

    if (video.readyState > 0) {
        applyWhenReady();
    } else if (!video._vscReadyHandler) {
        // C2: attach the readiness listener pair at most ONCE per video. The
        // prior code re-added a (loadedmetadata, canplay) pair on every
        // applyCurrentSpeed call for a still-loading video (applyToAllVideos and
        // onRateChange both call it), stacking duplicate listeners. The handler
        // removes both itself once the video becomes ready.
        video._vscReadyHandler = applyWhenReady;
        video.addEventListener('loadedmetadata', applyWhenReady);
        video.addEventListener('canplay', applyWhenReady);
    }

    return true;
}

/**
 * Apply currentPlaybackSpeed to every video on the page.
 */
function applyToAllVideos() {
    const videos = document.getElementsByTagName('video');
    let success = true;

    for (const video of videos) {
        if (!applyCurrentSpeed(video)) {
            success = false;
        }
    }

    return success;
}

/**
 * Persist a hotkey-resulting speed (Story 3.8; revised).
 *
 * The global `defaultPlaybackSpeed` is OPTIONS-OWNED — hotkeys never write it
 * (matches the popup dial's buildSpeedWrite contract). So:
 *   - per-site preset active for this domain → update that site's saved value
 *     (capped per NFR-SC2);
 *   - otherwise → do nothing. The change still applies live to the page's
 *     videos (the caller owns that); it just isn't persisted, so a reload
 *     resolves back to the per-site value or the options default. To make a
 *     tweak stick, the user turns on "Remember rate for this site" in the popup.
 *
 * Validate-on-write (sweep finding D1): reject out-of-range / non-numeric speeds
 * at the write boundary so storage can never hold a schema-illegal value.
 */
function persistHotkeySpeed(speed) {
    if (!isValidSpeed(speed)) return;
    const hostname = (typeof location !== 'undefined' && location.hostname)
        ? location.hostname : '';
    const domain = getRegistrableDomain(hostname);
    chrome.storage.sync.get(['perSiteSpeeds'], (result) => {
        const map = (result && result.perSiteSpeeds) ? result.perSiteSpeeds : {};
        if (domain && Object.prototype.hasOwnProperty.call(map, domain)) {
            const updated = { ...map, [domain]: speed };
            chrome.storage.sync.set({ perSiteSpeeds: capPerSiteSpeeds(updated) });
        }
        // Un-remembered site → no write (global default is options-owned).
    });
}

/**
 * Apply a hotkey-driven speed change (Story 3.3). No-ops (returns null) when no
 * <video> is present on the page — the command "no-ops silently" in that case.
 * Otherwise clamps to [SPEED_MIN, SPEED_MAX], updates currentPlaybackSpeed,
 * persists it, applies it to every video, and returns the clamped value.
 */
function applyHotkeyChange(target) {
    const videos = document.getElementsByTagName('video');
    if (videos.length === 0) return null;
    // snapToSliderStep keeps hotkey stepping on the 0.05 grid with the 0.01
    // floor, matching the slider drag and the popup +/- buttons exactly, and
    // clamps to [SPEED_MIN, SPEED_MAX].
    const clamped = VSC.snapToSliderStep(target);
    if (isNaN(clamped)) return null;
    currentPlaybackSpeed = clamped;
    persistHotkeySpeed(clamped);
    applyToAllVideos();
    return clamped;
}

/**
 * Prevent the page from overriding our speed by listening for ratechange.
 *
 * KNOWN LIMITATION (legitimate slow-motion override): we cannot distinguish an
 * *unwanted* reset — a site that snaps playbackRate back to 1.0 on load/seek —
 * from a *legitimate* slow-motion segment, i.e. a site that intentionally varies
 * playbackRate (replay tools, instructional players). We always re-assert the
 * user's chosen speed, so an intentional per-segment speed change by a site will
 * be overridden. Holding the user's speed is the primary contract, so this
 * trade-off is accepted; there is no reliable signal to tell the two cases apart.
 */
function setupVideoRateChangeListener(video) {
    if (video._vscRateChangeListener) return;

    const onRateChange = () => {
        // Loop protection (sweep finding C1 — corrected): the REAL guard against
        // an unbounded re-apply loop is the divergence check below — after we
        // write playbackRate, video.playbackRate === currentPlaybackSpeed, so the
        // self-triggered ratechange fails `Math.abs(...) > 0.01` and does not
        // re-apply. The `_vscApplying` flag only coalesces a *synchronous* burst
        // (e.g. a page that re-writes playbackRate inside its own ratechange
        // handler) into a single re-apply; it does NOT (and need not) suppress the
        // async ratechange our own assignment queues — the divergence check does.
        if (video._vscApplying) return;

        if (Math.abs(video.playbackRate - currentPlaybackSpeed) > 0.01) {
            video._vscApplying = true;
            try {
                // C4: re-apply via applyCurrentSpeed (not setVideoSpeed) so a
                // not-yet-ready video gets a readiness re-arm rather than a silent
                // no-op; for the ready case it sets playbackRate directly.
                applyCurrentSpeed(video);
            } finally {
                // Release on the microtask so a SYNCHRONOUS burst of page-driven
                // ratechanges in one task collapses to a single re-apply (the flag
                // stays set across the burst). The async ratechange our own
                // assignment queues runs in a LATER task with the flag already
                // cleared — harmless, because the divergence check above then sees
                // playbackRate already matching and skips it.
                //
                // Sweep C1: the flag coalesces bursts; the divergence check — not
                // this flag — is what prevents the async self-trigger loop.
                // Dropping the microtask (release synchronously) was evaluated and
                // REJECTED: it regresses burst-coalescing (one write PER event) for
                // no real-browser gain, since ratechange dispatches async anyway.
                queueMicrotask(() => { video._vscApplying = false; });
            }
        }
    };

    video.addEventListener('ratechange', onRateChange);
    video._vscRateChangeListener = onRateChange;
}

/**
 * Set up ratechange listeners for all current videos.
 */
function setupAllVideoListeners() {
    const videos = document.getElementsByTagName('video');
    for (const video of videos) {
        setupVideoRateChangeListener(video);
    }
}

/**
 * Single MutationObserver that handles both applying speed and setting up
 * ratechange listeners for dynamically added videos.
 */
const videoObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        if (mutation.addedNodes) {
            for (const node of mutation.addedNodes) {
                if (node.nodeName === 'VIDEO') {
                    applyCurrentSpeed(node);
                    setupVideoRateChangeListener(node);
                } else if (node.getElementsByTagName) {
                    for (const video of node.getElementsByTagName('video')) {
                        applyCurrentSpeed(video);
                        setupVideoRateChangeListener(video);
                    }
                }
            }
        }
    }
    // C3: the previous trailing `setTimeout(applyToAllVideos, 100)` was removed —
    // each added <video> is handled per-node above, and applyCurrentSpeed re-arms
    // via loadedmetadata/canplay when a video is not yet ready, so a blanket
    // re-sweep only risked a re-apply storm on video-heavy pages.
});

videoObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
});

/**
 * Single message listener — handles setSpeed and getSpeed from the popup.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Trust boundary: only accept messages from this extension's own pages.
    if (!sender || sender.id !== chrome.runtime.id) return false;
    if (request.action === 'setSpeed') {
        try {
            const parsedSpeed = parseFloat(request.speed);
            if (isNaN(parsedSpeed) || parsedSpeed < SPEED_MIN || parsedSpeed > SPEED_MAX) {
                sendResponse({ success: false, error: 'Speed out of range' });
                return true;
            }
            currentPlaybackSpeed = parsedSpeed;

            // D2: persist per-site-aware. On a domain with an active per-site
            // preset this writes perSiteSpeeds[domain] (matching the hotkey path);
            // otherwise it writes the global default.
            //
            // persist:false → apply ONLY (no storage write). The popup uses this
            // for its live, per-tick slider/+/- updates and owns the (debounced)
            // write itself — persisting here too would fire one storage.sync write
            // per message and blow the ~120/min write quota during a drag.
            if (request.persist !== false) {
                persistHotkeySpeed(parsedSpeed);
            }

            // Apply to ALL videos on the page
            const success = applyToAllVideos();
            sendResponse({ success });
        } catch (error) {
            console.error('Error setting video speed:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }

    if (request.action === 'getSpeed') {
        sendResponse({ speed: currentPlaybackSpeed });
        return true;
    }

    // Story 3.3 — global hotkey commands routed from the service worker.
    if (request.action === 'stepSpeed') {
        const delta = parseFloat(request.delta);
        const result = applyHotkeyChange(currentPlaybackSpeed + delta);
        sendResponse(result === null
            ? { success: false, noVideo: true, speed: currentPlaybackSpeed }
            : { success: true, speed: result });
        return true;
    }

    if (request.action === 'resetSpeed') {
        const result = applyHotkeyChange(1.0);
        sendResponse(result === null
            ? { success: false, noVideo: true, speed: currentPlaybackSpeed }
            : { success: true, speed: result });
        return true;
    }

    return false;
});

// --- Startup ---
initializeSpeed();
setupAllVideoListeners();
applyToAllVideos();

// Test exports (Node.js only — ignored by browser)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SPEED_MIN,
        SPEED_MAX,
        // Story 3.1 — shared settings schema
        DEFAULT_SETTINGS,
        MAX_PER_SITE_ENTRIES,
        resolveSettings,
        getSettings,
        capPerSiteSpeeds,
        // Story 3.5 — per-site speed resolution
        getRegistrableDomain,
        resolveSpeedForSite,
        // Story 3.3 — hotkey command handling
        clampSpeed,
        persistHotkeySpeed,
        applyHotkeyChange,
        setVideoSpeed,
        applyCurrentSpeed,
        applyToAllVideos,
        setupVideoRateChangeListener,
        // Expose internal state getters/setters for testing
        _getCurrentSpeed: () => currentPlaybackSpeed,
        _setCurrentSpeed: (s) => { currentPlaybackSpeed = s; },
        _setInitialized: (v) => { isInitialized = v; },
        initializeSpeed,
    };
}
