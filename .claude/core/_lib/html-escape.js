/**
 * HTML Escape — shared escaping for HTML rendering.
 *
 * Extracted into its own module (P2.4 code review M-2) because three modules
 * — decision-html.js, timeline-format.js, status-html.js — each shipped
 * independent copies. Three divergence points for an XSS-adjacent helper is
 * a latent risk: a future fix to one copy that misses the others opens a
 * hole in timeline `content` or status HTML dashboards.
 *
 * Consumers:
 *   _lib/decision-html.js   — rendered vis.js HTML
 *   _lib/timeline-format.js — timeline node `content` fields
 *   _lib/status-html.js     — status dashboard HTML
 */

'use strict';

/**
 * HTML-escape a string for safe injection into HTML attributes and text.
 * Escapes &, <, >, and " (double-quotes) — not apostrophes, matching the
 * historical behavior of the three extracted copies.
 *
 * @param {string} str
 * @returns {string}
 */
function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

module.exports = { esc };
