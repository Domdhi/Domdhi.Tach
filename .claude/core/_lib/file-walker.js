/**
 * File Walker — yields all file paths under a directory, skipping named subdirs.
 *
 * Callers pass an explicit skipList so the walker has no hardcoded opinions about
 * which directories to ignore — that policy lives in the orchestrator
 * (template-updater.js) which passes ALWAYS_SKIP_DIRS.
 *
 * Never calls process.cwd(). All paths are anchored to the rootDir argument.
 *
 * @module file-walker
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Recursively walk a directory and yield absolute file paths.
 *
 * Directories whose basename appears in skipList are pruned entirely — their
 * contents are never visited.
 *
 * @param {string}   rootDir   — absolute path to the directory to walk
 * @param {string[]} skipList  — directory basenames to skip (e.g. ['__tests__', 'node_modules'])
 * @yields {string}  absolute file path
 */
function* walkDir(rootDir, skipList) {
    if (!fs.existsSync(rootDir)) return;

    const skipSet = new Set(skipList);
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            if (skipSet.has(entry.name)) continue;
            yield* walkDir(fullPath, skipList);
        } else if (entry.isFile()) {
            yield fullPath;
        }
    }
}

module.exports = { walkDir };
