/**
 * Set default playback speed when the extension is first installed
 * This runs once when the extension is installed or updated
 */
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        // Set default playback speed to 1.0 (normal speed)
        chrome.storage.sync.set({ defaultPlaybackSpeed: 1.0 }, () => {
            console.log('Default playback speed set to 1.0');
        });
    }
    // Repaint the toolbar icon in the user's accent color (on install AND update —
    // an update may carry a previously-saved accentColor).
    updateToolbarIcon();
});

/**
 * Dynamic toolbar icon — recolor the action icon to follow the user's accent.
 *
 * The baked PNGs (manifest `icons`/`action.default_icon`) keep a fixed orange
 * glyph and act as the pre-paint fallback. Here the service worker redraws the
 * SAME glyph (charcoal rounded-rect + play triangle + 3 motion bars, geometry
 * mirrored from create_icons.js) in the accent color via OffscreenCanvas — the
 * SW has no DOM, so a <canvas> element is unavailable — and hands raw ImageData
 * to chrome.action.setIcon (needs no permission beyond the declared "action").
 *
 * The accent literal is hardcoded rather than imported from constants.js: the
 * service worker stays minimal (ADR-001). It mirrors DEFAULT_SETTINGS.accentColor.
 */
const ICON_SIZES = [16, 32, 48];
const ICON_BG = '#020202';            // Domdhi obsidian void (matches create_icons.js)
const DEFAULT_ICON_ACCENT = '#9D4EDD'; // Deep Amethyst (System) — mirrors DEFAULT_SETTINGS.accentColor

/**
 * Resolve the stored accentColor to a hex the icon can be drawn in. Returns the
 * stored value only when it is a valid 6-digit hex; otherwise the default accent.
 * @param {*} stored - raw accentColor value from storage (may be missing/invalid)
 * @returns {string} 6-digit hex color
 */
function resolveIconAccent(stored) {
    if (typeof stored === 'string' && /^#[0-9a-fA-F]{6}$/.test(stored)) {
        return stored;
    }
    return DEFAULT_ICON_ACCENT;
}

/**
 * Decide whether a storage change warrants an icon repaint: only a sync-area
 * change that touches accentColor. Tolerates null/undefined changes.
 * @param {Object} changes  - chrome.storage.onChanged changes map
 * @param {string} areaName - 'sync' | 'local' | 'managed' | 'session'
 * @returns {boolean}
 */
function shouldUpdateIcon(changes, areaName) {
    return areaName === 'sync'
        && !!changes
        && Object.prototype.hasOwnProperty.call(changes, 'accentColor');
}

/**
 * Trace a rounded-rect path. Uses ctx.roundRect where available (Chrome SW),
 * falling back to arcTo corners.
 */
function roundRectPath(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/**
 * Draw the icon-D glyph at `size` px in `accentHex` and return its ImageData.
 * Geometry mirrors create_icons.js so the dynamic icon matches the baked PNGs.
 * Browser-only — relies on OffscreenCanvas.
 * @param {number} size
 * @param {string} accentHex
 * @returns {ImageData}
 */
function drawIcon(size, accentHex) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');

    const r = 0; // brutalist hard square — zero radius
    const pad = Math.floor(size * 0.15);
    const drawW = size - pad * 2;
    const linesW = Math.floor(drawW * 0.42);
    const triLeft = pad + linesW + Math.max(1, Math.floor(size * 0.04));
    const triRight = size - pad;
    const triTop = Math.floor(size * 0.2);
    const triBot = size - Math.floor(size * 0.2);
    const triMidY = size / 2;
    const barLong = linesW;
    const barShort = Math.floor(linesW * 0.75);
    const barH = Math.max(1, Math.floor(size * 0.08));

    // Charcoal rounded-rect background.
    ctx.fillStyle = ICON_BG;
    roundRectPath(ctx, 0, 0, size, size, r);
    ctx.fill();

    // Accent-colored glyph: 3 motion bars + a right-pointing play triangle.
    ctx.fillStyle = accentHex;
    const barYs = [triTop, triMidY, triBot];
    const barWs = [barShort, barLong, barShort];
    for (let i = 0; i < 3; i++) {
        ctx.fillRect(pad, barYs[i] - barH / 2, barWs[i], barH);
    }
    ctx.beginPath();
    ctx.moveTo(triLeft, triTop);
    ctx.lineTo(triRight, triMidY);
    ctx.lineTo(triLeft, triBot);
    ctx.closePath();
    ctx.fill();

    return ctx.getImageData(0, 0, size, size);
}

/**
 * Build the multi-size ImageData map chrome.action.setIcon expects.
 * @param {string} accentHex
 * @returns {Object<number, ImageData>}
 */
function buildIconImageData(accentHex) {
    const imageData = {};
    for (const size of ICON_SIZES) {
        imageData[size] = drawIcon(size, accentHex);
    }
    return imageData;
}

/**
 * Read the stored accent and repaint the toolbar icon. No-ops (never throws)
 * where the rendering APIs are unavailable — node/jsdom tests, or a context
 * without OffscreenCanvas / chrome.action.setIcon.
 */
function updateToolbarIcon() {
    if (typeof OffscreenCanvas === 'undefined') return;
    if (typeof chrome === 'undefined' || !chrome.action || !chrome.action.setIcon) return;

    chrome.storage.sync.get('accentColor', (data) => {
        const accent = resolveIconAccent(data && data.accentColor);
        let imageData;
        try {
            imageData = buildIconImageData(accent);
        } catch (e) {
            return; // drawing failed — keep the baked PNG fallback
        }
        chrome.action.setIcon({ imageData }, () => {
            void chrome.runtime.lastError;
        });
    });
}

// Repaint on browser startup (SW respawns) and whenever the accent changes.
if (typeof chrome !== 'undefined' && chrome.runtime
    && chrome.runtime.onStartup && chrome.runtime.onStartup.addListener) {
    chrome.runtime.onStartup.addListener(updateToolbarIcon);
}
if (typeof chrome !== 'undefined' && chrome.storage
    && chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (shouldUpdateIcon(changes, areaName)) updateToolbarIcon();
    });
}

/**
 * Story 3.3 — Global keyboard shortcut handling.
 *
 * Each declared command (manifest.json `commands`) maps to the message the
 * active tab's content script should act on. The content script owns the actual
 * stepping / clamping / persistence — the service worker stays minimal and only
 * routes the event to the active tab (ADR-001).
 */
// delta mirrors SPEED_SLIDER_STEP (0.05) in constants.js so the hotkeys step on
// the SAME 0.05 grid as the slider + the popup's +/- buttons. (The service
// worker hardcodes the literal rather than importing constants — see ADR-001:
// the SW stays minimal; the content script does the snapping/clamping.)
const COMMAND_MESSAGES = {
    'increase-speed': { action: 'stepSpeed', delta: 0.05 },
    'decrease-speed': { action: 'stepSpeed', delta: -0.05 },
    'reset-speed': { action: 'resetSpeed' },
};

/**
 * Map a command name to the content-script message, or null when unknown.
 */
function commandToMessage(command) {
    return COMMAND_MESSAGES[command] || null;
}

/**
 * Route a fired command to the active tab's content script. No-ops silently for
 * an unknown command or when there is no addressable active tab. The sendMessage
 * callback reads chrome.runtime.lastError so pages without our content script
 * (chrome://, the Web Store, etc.) do not surface an unchecked-error warning.
 */
function handleCommand(command) {
    const message = commandToMessage(command);
    if (!message) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || !tab.id) return;
        chrome.tabs.sendMessage(tab.id, message, () => {
            void chrome.runtime.lastError;
        });
    });
}

if (typeof chrome !== 'undefined' && chrome.commands && chrome.commands.onCommand) {
    chrome.commands.onCommand.addListener(handleCommand);
}

// Test exports (Node.js only — ignored by the browser service worker)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        COMMAND_MESSAGES,
        commandToMessage,
        handleCommand,
        resolveIconAccent,
        shouldUpdateIcon,
        updateToolbarIcon,
    };
}