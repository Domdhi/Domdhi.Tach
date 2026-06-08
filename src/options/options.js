/**
 * options.js — default-speed + per-site + YouTube-cleanup settings page.
 *
 * Shared constants come from the single source constants.js — loaded via
 * <script src="../constants.js"> before this file, or require('../constants')
 * under Node tests. See constants.js for the ADR-002 single-source rationale.
 */
const VSC = (typeof module !== 'undefined' && module.exports)
    ? require('../constants')
    : (typeof self !== 'undefined' ? self.VSC : globalThis.VSC);
const { SPEED_MIN, SPEED_MAX, DEFAULT_SETTINGS } = VSC;

/**
 * Returns a new perSiteSpeeds object with the given domain removed.
 * Does not mutate the input object.
 *
 * @param {Object} perSiteSpeeds - Current per-site speeds map { [domain]: number }
 * @param {string} domain - Domain key to remove
 * @returns {Object} New object without that domain key
 */
function removePerSiteEntry(perSiteSpeeds, domain) {
    const updated = Object.assign({}, perSiteSpeeds);
    delete updated[domain];
    return updated;
}

/**
 * Story 6.1 (FR-12) — validate-on-write clamp + round for a single preset slot.
 *
 * Parse `value`; if it is a finite number, clamp it to [SPEED_MIN, SPEED_MAX]
 * (sourced from VSC — no hardcoded literals) and round to 2 decimal places.
 * If it is NOT a finite number (empty string, NaN, 'nope', etc.) return `fallback`
 * unchanged so the slot never receives an invalid value.
 *
 * @param {*}      value    - Raw value from an input element (string or number)
 * @param {number} fallback - Prior valid value to return when parsing fails
 * @returns {number} Sanitized value
 */
function sanitizePresetValue(value, fallback) {
    var v = parseFloat(value);
    if (!isFinite(v)) return fallback;
    v = Math.min(SPEED_MAX, Math.max(SPEED_MIN, v));
    return Math.round(v * 100) / 100;
}

/**
 * Returns a new perSiteSpeeds map with `domain` set to a sanitized speed.
 * The speed is clamped to [SPEED_MIN, SPEED_MAX] and rounded to 0.01 (reusing
 * sanitizePresetValue). If the value is not a finite number the map is returned
 * unchanged (a copy) so an invalid edit never corrupts a saved entry. Does not
 * mutate the input.
 *
 * @param {Object} perSiteSpeeds - Current per-site speeds map { [domain]: number }
 * @param {string} domain - Domain key to set
 * @param {*}      speed  - Raw value (string from the edit input, or number)
 * @returns {Object} New map with the domain set (or an unchanged copy)
 */
function setPerSiteEntry(perSiteSpeeds, domain, speed) {
    const updated = Object.assign({}, perSiteSpeeds);
    const v = parseFloat(speed);
    if (!isFinite(v)) return updated;
    updated[domain] = sanitizePresetValue(v, v);
    return updated;
}

// ---- Inline icon helpers (CSP-safe: built via createElementNS, no innerHTML) ----
const SVG_NS = 'http://www.w3.org/2000/svg';
// 24x24 Material-style glyph paths, drawn in currentColor so each button's CSS
// color (accent for edit/save, error red for delete) flows through.
const ICON_PATHS = {
    edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    save: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    cancel: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
};

/** Build an inline SVG node for the named icon (no user data — fixed paths). */
function makeIcon(kind) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICON_PATHS[kind]);
    svg.appendChild(path);
    return svg;
}

/** Build an icon-only <button> with an accessible label. */
function makeIconButton(kind, label, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'per-site-icon-btn' + (extraClass ? ' ' + extraClass : '');
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.appendChild(makeIcon(kind));
    return btn;
}

document.addEventListener('DOMContentLoaded', function() {
    // When rendered inside the popup's settings iframe (this page is framed), use
    // the compact layout (options.css .embedded rules). Standalone tab → full page.
    // Reference comparison is safe cross-frame; both frames are same-origin here.
    if (window.top !== window.self) {
        document.documentElement.classList.add('embedded');
    }

    // Version/branding line (moved here from the popup footer). Guarded — the
    // unit-test DOM omits #optionsAbout.
    const aboutEl = document.getElementById('optionsAbout');
    if (aboutEl && chrome.runtime && chrome.runtime.getManifest) {
        aboutEl.textContent = 'Tach v' + chrome.runtime.getManifest().version;
    }

    const speedInput = document.getElementById('speedInput');
    const saveBtn = document.getElementById('saveBtn');
    const status = document.getElementById('status');
    const redlineInput = document.getElementById('redlineInput');
    const saveRedlineBtn = document.getElementById('saveRedlineBtn');
    const redlineStatus = document.getElementById('redlineStatus');
    const perSiteList = document.getElementById('perSiteList');
    const hideShortsToggle = document.getElementById('hideShortsToggle');
    const hideCommentsToggle = document.getElementById('hideCommentsToggle');
    const hideChatFullscreenToggle = document.getElementById('hideChatFullscreenToggle');
    const skipAdsToggle = document.getElementById('skipAdsToggle');

    // ---- Story 6.6 (FR-20): Accent color picker ----
    // Null-guard every lookup: existing tests whose DOM omits these elements must
    // still pass. The null-guards ensure the handler is inert in that case.
    const accentColorInput = document.getElementById('accentColorInput');
    const accentSwatches = document.querySelectorAll('.accent-swatch');

    // On load: read stored accentColor (or fall back to default), reflect it in
    // the color input, and apply to the page so the options page itself recolors.
    chrome.storage.sync.get(['accentColor'], function(result) {
        const accent = (result && result.accentColor)
            ? result.accentColor
            : DEFAULT_SETTINGS.accentColor;
        if (accentColorInput) accentColorInput.value = accent;
        VSC.applyAccentColor(document.documentElement, accent);
    });

    // The native color picker fires 'input' continuously while the user drags —
    // writing storage on each one blows past chrome.storage.sync's
    // MAX_WRITE_OPERATIONS_PER_MINUTE (~120/min) quota AND, since Story-6 icon
    // sync, spams storage.onChanged → toolbar-icon repaints. So:
    //   'input'  → live-preview only (recolor the page, NO write)
    //   'change' → commit (fires once when the picker closes) → persist + apply
    if (accentColorInput) {
        accentColorInput.addEventListener('input', function() {
            VSC.applyAccentColor(document.documentElement, accentColorInput.value);
        });
        accentColorInput.addEventListener('change', function() {
            const color = accentColorInput.value;
            chrome.storage.sync.set({ accentColor: color });
            VSC.applyAccentColor(document.documentElement, color);
        });
    }

    // Persist + apply when a preset swatch is clicked.
    if (accentSwatches && accentSwatches.length) {
        accentSwatches.forEach(function(swatch) {
            swatch.addEventListener('click', function() {
                const color = swatch.dataset.color;
                if (accentColorInput) accentColorInput.value = color;
                chrome.storage.sync.set({ accentColor: color });
                VSC.applyAccentColor(document.documentElement, color);
            });
        });
    }

    // ---- Story 6.4 (FR-13): Theme preference selector ----
    // Reflect the saved `theme` (light/dark/auto) on load and persist changes.
    // The popup consumes `theme` via VSC.applyThemePreference (Story 6.3); this
    // is only the options-side control. Null-guarded so other test DOMs that omit
    // the selector still boot.
    const themeSelect = document.getElementById('themeSelect');
    // Apply the saved theme to THIS page on load (mirrors popup.js's
    // loadThemePreference) so the options surface itself honors light/dark/auto —
    // previously the selector only persisted `theme` for the popup to consume, so
    // the options page stayed permanently light. VSC.applyThemePreference sets
    // [data-theme] on <html>; theme.css carries the dark palette.
    chrome.storage.sync.get('theme', function(data) {
        const theme = (typeof data.theme === 'string')
            ? data.theme : DEFAULT_SETTINGS.theme;
        if (themeSelect) themeSelect.value = theme;
        VSC.applyThemePreference(document.documentElement, theme);
    });
    if (themeSelect) {
        themeSelect.addEventListener('change', function() {
            chrome.storage.sync.set({ theme: themeSelect.value });
            // Re-theme the page live so the choice previews immediately.
            VSC.applyThemePreference(document.documentElement, themeSelect.value);
        });
    }

    /**
     * Story 4.3 — wire a YouTube cleanup toggle (FR-14/FR-15/FR-21/FR-22). The checkbox
     * reflects the stored boolean, falling back to the key's OWN default in
     * DEFAULT_SETTINGS when nothing (or a non-boolean) is stored — so default-OFF
     * keys (hideShorts/hideComments) read off when unset, and the default-ON
     * hideChatFullscreen reads on when unset. Persists its change immediately to
     * chrome.storage.sync; content-youtube.js honors the new value on the next
     * navigation (and live, via its storage.onChanged listener).
     *
     * @param {HTMLInputElement|null} toggle - the checkbox element
     * @param {string} key - settings key ('hideShorts' | 'hideComments' | 'hideChatFullscreen' | 'skipAds')
     */
    function initYouTubeToggle(toggle, key) {
        if (!toggle) return;
        chrome.storage.sync.get(key, function(data) {
            toggle.checked = typeof data[key] === 'boolean'
                ? data[key] : DEFAULT_SETTINGS[key];
        });
        toggle.addEventListener('change', function() {
            chrome.storage.sync.set({ [key]: toggle.checked });
        });
    }

    initYouTubeToggle(hideShortsToggle, 'hideShorts');
    initYouTubeToggle(hideCommentsToggle, 'hideComments');
    initYouTubeToggle(hideChatFullscreenToggle, 'hideChatFullscreen');
    initYouTubeToggle(skipAdsToggle, 'skipAds');

    // ---- Story 6.1 (FR-12): Editable preset grid ----
    // Null-guard all lookups so tests whose DOM omits these elements continue to pass.
    const presetInputs = Array.from(document.querySelectorAll('.preset-input'));
    const resetPresetsBtn = document.getElementById('resetPresetsBtn');

    if (presetInputs.length) {
        // On load: read customPresets from storage, fall back to DEFAULT_SETTINGS defaults.
        chrome.storage.sync.get(['customPresets'], function(result) {
            const presets = (result && Array.isArray(result.customPresets) && result.customPresets.length === 6)
                ? result.customPresets
                : DEFAULT_SETTINGS.customPresets;
            presetInputs.forEach(function(input, i) {
                input.value = presets[i];
            });
        });

        // On each input 'change': validate-on-write — sanitize, reflect back, persist all 6.
        presetInputs.forEach(function(input, i) {
            input.addEventListener('change', function() {
                // Read the current displayed values as the fallbacks for each slot.
                const currentValues = presetInputs.map(function(inp) {
                    return parseFloat(inp.value);
                });
                // Sanitize every slot so the full array is always valid.
                const sanitized = presetInputs.map(function(inp, j) {
                    // Use the current stored/displayed value as the fallback for that slot.
                    const fallback = isFinite(currentValues[j])
                        ? sanitizePresetValue(currentValues[j], DEFAULT_SETTINGS.customPresets[j])
                        : DEFAULT_SETTINGS.customPresets[j];
                    return sanitizePresetValue(inp.value, fallback);
                });
                // Reflect sanitized values back to the UI so out-of-range entries snap.
                presetInputs.forEach(function(inp, j) {
                    inp.value = sanitized[j];
                });
                // Persist all 6 (chrome.storage.sync — syncs across devices, ADR-003).
                chrome.storage.sync.set({ customPresets: sanitized });
            });
        });

        // Reset button: restore all inputs and storage to the default preset array.
        if (resetPresetsBtn) {
            resetPresetsBtn.addEventListener('click', function() {
                const defaults = DEFAULT_SETTINGS.customPresets;
                presetInputs.forEach(function(inp, i) {
                    inp.value = defaults[i];
                });
                chrome.storage.sync.set({ customPresets: defaults.slice() });
            });
        }
    }

    /**
     * Renders the per-site presets list into #perSiteList.
     * Builds DOM via createElement/textContent to avoid injection risks.
     *
     * @param {Object} perSiteSpeeds - Current per-site speeds map
     */
    function renderPerSiteList(perSiteSpeeds) {
        perSiteList.textContent = '';

        const domains = Object.keys(perSiteSpeeds);
        if (domains.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'per-site-empty';
            empty.textContent = 'No per-site presets saved.';
            perSiteList.appendChild(empty);
            return;
        }

        domains.forEach(function(domain) {
            perSiteList.appendChild(buildPerSiteRow(domain, perSiteSpeeds[domain]));
        });
    }

    /** Reusable left side of a row: the truncating domain label. */
    function makeDomainLabel(domain) {
        const domainEl = document.createElement('span');
        domainEl.className = 'per-site-domain';
        domainEl.textContent = domain;
        domainEl.title = domain; // full value on hover when truncated
        return domainEl;
    }

    /**
     * Build a per-site row in VIEW mode:
     *   [domain ...]  [1.50x]  [✎ edit] [🗑 delete]
     * Edit swaps the row in place (swapToEditMode); delete removes the entry.
     */
    function buildPerSiteRow(domain, speed) {
        const row = document.createElement('div');
        row.className = 'per-site-row';

        const speedEl = document.createElement('span');
        speedEl.className = 'per-site-speed';
        speedEl.textContent = parseFloat(speed).toFixed(2) + 'x';

        const actions = document.createElement('div');
        actions.className = 'per-site-actions';

        const editBtn = makeIconButton('edit', 'Edit speed for ' + domain, 'per-site-edit');
        editBtn.addEventListener('click', function() {
            swapToEditMode(row, domain, speed);
        });

        const deleteBtn = makeIconButton('delete', 'Delete ' + domain, 'per-site-delete');
        deleteBtn.addEventListener('click', function() {
            chrome.storage.sync.get('perSiteSpeeds', function(data) {
                const updated = removePerSiteEntry(data.perSiteSpeeds || {}, domain);
                chrome.storage.sync.set({ perSiteSpeeds: updated }, function() {
                    renderPerSiteList(updated);
                });
            });
        });

        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        row.appendChild(makeDomainLabel(domain));
        row.appendChild(speedEl);
        row.appendChild(actions);
        return row;
    }

    /**
     * Swap `row` into EDIT mode in place:
     *   [domain ...]  [<number input>]  [✓ save] [✕ cancel]
     * Save sanitizes + persists (setPerSiteEntry) then re-renders the list;
     * Cancel restores the original view row (no write). Enter saves, Esc cancels.
     */
    function swapToEditMode(row, domain, speed) {
        row.textContent = '';

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'per-site-speed-input';
        input.min = SPEED_MIN;
        input.max = SPEED_MAX;
        input.step = '0.01';
        input.value = parseFloat(speed).toFixed(2);
        input.setAttribute('aria-label', 'Speed for ' + domain);

        const actions = document.createElement('div');
        actions.className = 'per-site-actions';

        const saveBtn = makeIconButton('save', 'Save speed for ' + domain, 'per-site-save');
        const cancelBtn = makeIconButton('cancel', 'Cancel editing ' + domain, 'per-site-cancel');

        function commit() {
            chrome.storage.sync.get('perSiteSpeeds', function(data) {
                const updated = setPerSiteEntry(data.perSiteSpeeds || {}, domain, input.value);
                chrome.storage.sync.set({ perSiteSpeeds: updated }, function() {
                    renderPerSiteList(updated);
                });
            });
        }
        function cancel() {
            row.replaceWith(buildPerSiteRow(domain, speed));
        }

        saveBtn.addEventListener('click', commit);
        cancelBtn.addEventListener('click', cancel);
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });

        actions.appendChild(saveBtn);
        actions.appendChild(cancelBtn);

        row.appendChild(makeDomainLabel(domain));
        row.appendChild(input);
        row.appendChild(actions);
        input.focus();
        input.select();
    }

    // Load saved default speed
    chrome.storage.sync.get('defaultPlaybackSpeed', function(data) {
        // `!= null` (not truthy) so a stored 0 is treated as present, mirroring
        // the redlineSpeed load just below. Writes validate, so 0 should never
        // persist; this only governs how an unexpected value is surfaced.
        if (data.defaultPlaybackSpeed != null) {
            speedInput.value = data.defaultPlaybackSpeed;
        } else {
            speedInput.value = 1.0;
        }
    });

    // Load saved redline-button speed (falls back to the schema default).
    if (redlineInput) {
        chrome.storage.sync.get('redlineSpeed', function(data) {
            redlineInput.value = (data && data.redlineSpeed != null)
                ? data.redlineSpeed
                : DEFAULT_SETTINGS.redlineSpeed;
        });
    }

    // Save redline-button speed (same validate-on-write clamp as the default speed).
    if (saveRedlineBtn && redlineInput && redlineStatus) {
        saveRedlineBtn.addEventListener('click', function() {
            const speed = parseFloat(redlineInput.value);
            if (isNaN(speed) || speed < SPEED_MIN || speed > SPEED_MAX) {
                redlineStatus.hidden = false;
                redlineStatus.dataset.kind = 'error';
                redlineStatus.textContent = 'Please enter a value between ' + SPEED_MIN + ' and ' + SPEED_MAX;
                return;
            }
            chrome.storage.sync.set({ redlineSpeed: speed }, function() {
                redlineStatus.hidden = false;
                redlineStatus.dataset.kind = 'success';
                redlineStatus.textContent = 'Settings saved successfully!';
                setTimeout(function() { redlineStatus.hidden = true; }, 2000);
            });
        });
    }

    // Load and render per-site presets
    chrome.storage.sync.get('perSiteSpeeds', function(data) {
        renderPerSiteList(data.perSiteSpeeds || {});
    });

    // Save speed
    saveBtn.addEventListener('click', function() {
        const speed = parseFloat(speedInput.value);
        if (isNaN(speed) || speed < SPEED_MIN || speed > SPEED_MAX) {
            // Color comes from .status[data-kind] in options.css (token-driven,
            // AA-safe in dark) — not a hardcoded 'red' that fails contrast on the
            // dark surface. See memory dark-mode-reuses-light-status-colors-fail-aa.
            status.hidden = false;
            status.dataset.kind = 'error';
            status.textContent = 'Please enter a value between ' + SPEED_MIN + ' and ' + SPEED_MAX;
            return;
        }

        chrome.storage.sync.set({defaultPlaybackSpeed: speed}, function() {
            status.hidden = false;
            status.dataset.kind = 'success';
            status.textContent = 'Settings saved successfully!';

            // Reset status message after 2 seconds
            setTimeout(function() {
                status.hidden = true;
            }, 2000);
        });
    });
});

// Test-only export — inert in the extension (ADR-002: no bundler/modules)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { removePerSiteEntry, setPerSiteEntry, sanitizePresetValue };
}
