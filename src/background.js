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
 * CRITICAL: this setIcon paints OVER the manifest `icons`/`action.default_icon`
 * PNGs at runtime, so the toolbar shows whatever is drawn HERE — editing the PNGs
 * alone changes nothing on the toolbar. The service worker redraws the SAME
 * tachometer-dial glyph as create_icons.js (270° arc + needle + red redline tip +
 * hub, with a black keyline) in the accent color via OffscreenCanvas — the SW has
 * no DOM, so a <canvas> element is unavailable — and hands raw ImageData to
 * chrome.action.setIcon (needs no permission beyond the declared "action"). The
 * baked PNGs are only the pre-paint fallback.
 *
 * Geometry is COPIED from create_icons.js / the popup header SVG (24u viewBox).
 * Keep the path numbers in sync with those — there is no shared module (the SW
 * stays minimal, ADR-001; the colour literals mirror theme.css, not imported).
 */
const ICON_SIZES = [16, 32, 48];
const ICON_BG = '#020202';             // Domdhi obsidian void (matches create_icons.js)
const ICON_RED = '#FF0055';            // rose-gem redline tip (fixed; never follows the accent)
const ICON_OUTLINE = '#000000';        // black keyline (keeps the tip distinct from an accent-red dial)
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
 * Draw the tachometer-dial glyph at `size` px and return its ImageData. The dial
 * (arc + needle + hub) is stroked in `accentHex`; the redline tip stays ICON_RED,
 * and a black keyline underlay keeps the tip distinct even when the accent IS red.
 * Geometry is the 24u viewBox art from create_icons.js, framed with the same
 * scale(0.9) + down-nudge. The 16px size drops the red tip (noise that small).
 * Browser-only — relies on OffscreenCanvas.
 * @param {number} size
 * @param {string} accentHex
 * @returns {ImageData}
 */
function drawIcon(size, accentHex) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const simplified = size <= 16;
    const cw = simplified ? 2.9 : 2;     // coloured stroke width (24u units)
    const ow = cw + 1.3;                 // black keyline width
    const hubR = simplified ? 2.2 : 1.9;

    // Obsidian square background (device px, before the art transform).
    ctx.fillStyle = ICON_BG;
    ctx.fillRect(0, 0, size, size);

    // Map 24u art-space → px with the same framing as create_icons.js:
    //   translate(12,12.6) · scale(0.9) · translate(-12,-12), times s = size/24.
    const s = size / 24;
    ctx.setTransform(s * 0.9, 0, 0, s * 0.9, s * 1.2, s * 1.8);
    ctx.lineCap = 'butt';

    // 270° dial arc: centre (12,14) r8 — concentric with the hub/needle pivot,
    // exactly matching the SVG `M6.34 19.66A8 8 0 1 1 17.66 19.66` in create_icons.js.
    // Endpoints (6.34,19.66)→(17.66,19.66) then sit exactly on r8; drawn the long
    // way (through the top) so the gap stays at the bottom.
    const a1 = Math.atan2(19.66 - 14, 6.34 - 12);
    const a2 = Math.atan2(19.66 - 14, 17.66 - 12);
    const arc = () => { ctx.beginPath(); ctx.arc(12, 14, 8, a1, a2, false); ctx.stroke(); };
    const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    const dot = (rr, fill) => { ctx.beginPath(); ctx.arc(12, 14, rr, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };

    // Needle: full hub→rim when simplified (no red), else hub→colour junction.
    const nx = simplified ? 18.45 : 15.58;
    const ny = simplified ? 5.94 : 9.53;

    // Black keyline underlay (arc + needle + hub).
    ctx.strokeStyle = ICON_OUTLINE; ctx.lineWidth = ow;
    arc(); line(12, 14, nx, ny); dot(hubR + 0.65, ICON_OUTLINE);
    // Coloured dial.
    ctx.strokeStyle = accentHex; ctx.lineWidth = cw;
    arc(); line(12, 14, nx, ny); dot(hubR, accentHex);
    // Red redline tip on top, bordered all the way around (skipped at 16px).
    if (!simplified) {
        ctx.strokeStyle = ICON_OUTLINE; ctx.lineWidth = ow; line(15.46, 9.67, 18.86, 5.43);
        ctx.strokeStyle = ICON_RED; ctx.lineWidth = cw; line(15.87, 9.16, 18.45, 5.94);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
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