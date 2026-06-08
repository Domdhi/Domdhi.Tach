/**
 * Freeze State — read/write helper for `docs/.output/freeze-state.json`.
 *
 * Freeze-state (A2) adopted from gstack's `/freeze` pattern:
 *   `docs/research/competitive/_hooks-and-core-scripts-comparison.md` §A2.
 * /investigate writes this file with a list of absolute paths the user is
 * actively investigating; the guardrail's Edit/Write path rejects mutations
 * of those paths with "File is frozen by /investigate". This module is the
 * READER. The writer integration (from /investigate) lands in a follow-up.
 *
 * State file schema:
 *   { "frozen": ["/absolute/path/1.ts", "/absolute/path/2.md"] }
 *
 * Graceful degradation (all by design — freeze-state is advisory, not a hard
 * safety boundary):
 *   - Missing file     → isFrozen=false, listFrozen=[]
 *   - Unreadable file  → same
 *   - Malformed JSON   → same
 *
 * Paths are compared by strict string equality (no normalization). Callers
 * should pass absolute paths resolved via CLAUDE_PROJECT_DIR.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function getStateFilePath() {
    const projectRoot = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..', '..');
    return path.join(projectRoot, 'docs', '.output', 'freeze-state.json');
}

/**
 * Load the frozen-path list. Returns [] on any read/parse error.
 * @returns {string[]}
 */
function listFrozen() {
    const stateFile = getStateFilePath();
    if (!fs.existsSync(stateFile)) return [];
    try {
        const raw = fs.readFileSync(stateFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.frozen)) return [];
        return parsed.frozen.filter((p) => typeof p === 'string');
    } catch {
        return [];
    }
}

/**
 * Test whether a given absolute path is currently frozen.
 * @param {string} absPath
 * @returns {boolean}
 */
function isFrozen(absPath) {
    if (typeof absPath !== 'string' || !absPath) return false;
    const frozen = listFrozen();
    return frozen.includes(absPath);
}

/**
 * Replace the frozen-path list with `paths`. Creates parent dirs as needed.
 * Provided for future /investigate integration and for testability.
 * @param {string[]} paths
 */
function setFrozen(paths) {
    const stateFile = getStateFilePath();
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const payload = { frozen: Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : [] };
    fs.writeFileSync(stateFile, JSON.stringify(payload, null, 2));
}

module.exports = { isFrozen, listFrozen, setFrozen, getStateFilePath };
