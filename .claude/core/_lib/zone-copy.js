/**
 * Zone Copy — copy a file with zone enforcement + dry-run support.
 *
 * Delegates to agent-merger for Mixed-zone files when opts.merge is set.
 * Handles the three real zones that copyWithZoneEnforcement cares about:
 *   'template'  — overwrite dest with src
 *   'project'   — skip, never touch
 *   'mixed'     — warn (default) or merge (when opts.merge is true)
 *
 * Never calls process.cwd(). Paths are explicit srcPath / dstPath arguments.
 *
 * @module zone-copy
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { mergeAgentFile } = require('./agent-merger');

/**
 * Copy srcPath to dstPath with zone-aware enforcement.
 *
 * @param {string} srcPath
 * @param {string} dstPath
 * @param {'template'|'project'|'mixed'} zone
 * @param {object} [opts]
 * @param {boolean} [opts.merge]   — handle mixed-zone files with section-aware merge
 * @param {boolean} [opts.dryRun]  — preview actions without writing any files
 * @returns {{ action: string, changed?: boolean, diff?: string }}
 */
function copyWithZoneEnforcement(srcPath, dstPath, zone, opts) {
    opts = opts || {};
    const { merge = false, dryRun = false } = opts;

    switch (zone) {
        case 'template': {
            if (dryRun) {
                return { action: 'would-copy' };
            }
            fs.mkdirSync(path.dirname(dstPath), { recursive: true });
            fs.copyFileSync(srcPath, dstPath);
            return { action: 'copy' };
        }

        case 'project': {
            return { action: 'skip' };
        }

        case 'mixed': {
            if (!merge) {
                return { action: 'warn' };
            }
            if (dryRun) {
                return { action: 'would-merge' };
            }
            const mergeResult = mergeAgentFile(srcPath, dstPath, opts);
            return { action: 'merge', changed: mergeResult.changed, diff: mergeResult.diff };
        }

        default:
            return { action: 'skip' };
    }
}

module.exports = { copyWithZoneEnforcement };
