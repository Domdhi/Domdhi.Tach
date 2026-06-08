/**
 * Hook Input — unified stdin reader + profile gate + frozen-snapshot cache.
 *
 * Extracted from 5 hooks that each rolled their own stdin parser with subtly
 * different behavior (different timeouts, some missing TTY check, some missing
 * error handler). This module consolidates them behind one API while preserving
 * each caller's historical timeout:
 *
 *   - command-usage-logger.cjs, edit-capture.cjs: 1000ms timeout (default)
 *   - memory-capture.cjs: 500ms timeout (pass { timeoutMs: 500 })
 *   - damage-control.cjs, guardrail.cjs: no timeout (pass { timeoutMs: null })
 *
 * Hook profile system (A1) adopted from ECC — source:
 *   docs/research/competitive/_hooks-and-core-scripts-comparison.md Section A1
 *   (Reference upstream: everything-claude-code §3.3, `run-with-flags.js`).
 * Ranks: minimal < standard < strict. A hook gates itself with
 * shouldRunInProfile('standard') to opt out of `minimal`.
 *
 * Frozen-snapshot pattern (A5) adopted from Hermes — source:
 *   docs/research/competitive/_hooks-and-core-scripts-comparison.md Section A5
 *   (Reference upstream: paperclip-hermes §7, memory snapshot at session start).
 * frozenRead caches file contents per absolute path for the lifetime of the
 * process. Callers should use it only for hot-path config reads whose content
 * is stable within a single hook invocation.
 */

const fs = require('fs');

const DEFAULT_TIMEOUT_MS = 1000;

const PROFILE_ORDER = ['minimal', 'standard', 'strict'];
const DEFAULT_PROFILE = 'standard';
const PROFILE_ENV = 'DOMDHI_HOOK_PROFILE';

// Module-level cache — per-process, keyed by absolute path. No invalidation.
const FROZEN_CACHE = new Map();

/**
 * Read stdin to completion. Resolves '' if stdin is a TTY, on error, or on
 * timeout (with whatever partial data was received). Never rejects.
 *
 * @param {object} [opts]
 * @param {number|null} [opts.timeoutMs=1000] — milliseconds to wait after first
 *   event before resolving with accumulated data. Pass `null` (or 0) to disable
 *   the timeout entirely and wait for stdin `end`/`error` naturally. Damage-control
 *   and guardrail historically had no timeout; memory-capture used 500ms; the
 *   rest used 1000ms.
 * @returns {Promise<string>}
 */
function readHookInput(opts = {}) {
    const { timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
    return new Promise((resolve) => {
        if (process.stdin.isTTY) { resolve(''); return; }

        let data = '';
        let settled = false;
        const done = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };

        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => done(data));
        process.stdin.on('error', () => done(''));

        if (timeoutMs !== null && timeoutMs !== 0) {
            setTimeout(() => done(data), timeoutMs);
        }
    });
}

/**
 * Parse a JSON payload from a hook's stdin string. Returns null on any failure
 * (invalid JSON, empty input) instead of throwing — hooks should never crash
 * Claude Code.
 *
 * @param {string} jsonText
 * @returns {object|null}
 */
function parseHookPayload(jsonText) {
    if (!jsonText || typeof jsonText !== 'string') return null;
    try {
        return JSON.parse(jsonText);
    } catch {
        return null;
    }
}

/**
 * Read DOMDHI_HOOK_PROFILE from the environment, defaulting to 'standard'.
 * Unknown values silently fall back to the default — this is the hook-profile
 * system, not a security boundary.
 *
 * @returns {'minimal'|'standard'|'strict'}
 */
function getHookProfile() {
    const raw = process.env[PROFILE_ENV];
    if (!raw) return DEFAULT_PROFILE;
    return PROFILE_ORDER.includes(raw) ? raw : DEFAULT_PROFILE;
}

/**
 * Check whether the current hook profile is at least as permissive as the
 * required level. Typical usage at the top of a hook:
 *
 *     if (!shouldRunInProfile('standard')) process.exit(0);
 *
 * @param {'minimal'|'standard'|'strict'} required
 * @returns {boolean}
 */
function shouldRunInProfile(required) {
    const currentIdx = PROFILE_ORDER.indexOf(getHookProfile());
    const requiredIdx = PROFILE_ORDER.indexOf(required);
    if (requiredIdx === -1) return false;
    return currentIdx >= requiredIdx;
}

/**
 * Synchronously read a file once per process and cache the result by absolute
 * path. Subsequent calls with the same path return the cached string even if
 * the underlying file has changed — this is the point of the frozen snapshot.
 *
 * @param {string} absPath
 * @returns {string}
 */
function frozenRead(absPath) {
    if (FROZEN_CACHE.has(absPath)) return FROZEN_CACHE.get(absPath);
    const content = fs.readFileSync(absPath, 'utf8');
    FROZEN_CACHE.set(absPath, content);
    return content;
}

module.exports = {
    readHookInput,
    parseHookPayload,
    getHookProfile,
    shouldRunInProfile,
    frozenRead,
    PROFILE_ORDER,
    DEFAULT_PROFILE,
};
