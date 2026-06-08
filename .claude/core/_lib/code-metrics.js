/**
 * Code Metrics — LOC and file-count loader for status.js.
 *
 * Extracted from status.js (P2.4) to separate metrics loading from rendering.
 * Scans source files (.js, .ts, .cjs, .mjs) under projectRoot, counts lines,
 * and aggregates by top-level directory.
 *
 * Usage:
 *   const { loadCodeMetrics } = require('./_lib/code-metrics');
 *   const metrics = loadCodeMetrics(projectRoot);
 *   // → { loc: number, fileCount: number, byDir: Record<string, number> }
 *
 * Constraints:
 *   - Never reads process.cwd() — always anchored to the explicit projectRoot arg.
 *   - Excludes node_modules, .git, .archive, and hidden dot-dirs.
 *   - Only counts .js, .ts, .cjs, .mjs extensions (source files only).
 */

const fs = require('fs');
const path = require('path');

/** Extensions counted as source code lines. */
const SOURCE_EXTENSIONS = new Set(['.js', '.ts', '.cjs', '.mjs']);

/** Top-level directory names to skip entirely. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.archive', '.claude-v1']);

/**
 * Walk a directory tree and invoke callback for each matching source file.
 *
 * @param {string} dir          Absolute directory path to scan
 * @param {(absPath: string) => void} callback  Called for each source file found
 * @param {boolean} [isTopLevel=false]  When true, record the dir name as the top-level key
 * @param {string}  [topLevelDir='']   Top-level dir name (for byDir bucketing)
 */
function walkDir(dir, callback, topLevelDir) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        // Skip hidden and blacklisted directories
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
            walkDir(path.join(dir, entry.name), callback, topLevelDir);
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name);
            if (SOURCE_EXTENSIONS.has(ext)) {
                callback(path.join(dir, entry.name), topLevelDir);
            }
        }
    }
}

/**
 * Count the lines in a file. Empty files return 0.
 *
 * @param {string} absPath
 * @returns {number}
 */
function countLines(absPath) {
    try {
        const content = fs.readFileSync(absPath, 'utf8');
        if (!content) return 0;
        // Count newlines — a file with N lines has at least N-1 newlines.
        // Standard: if content ends with '\n', the trailing empty segment is not a line.
        const lines = content.split('\n');
        const count = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
        return Math.max(0, count);
    } catch {
        return 0;
    }
}

/**
 * Load code metrics for a project.
 *
 * Scans all source files under `projectRoot`, counting lines of code and
 * file counts. Never uses process.cwd() — always anchors to projectRoot.
 *
 * @param {string} projectRoot  Absolute path to the project root
 * @returns {{ loc: number, fileCount: number, byDir: Record<string, number> }}
 */
function loadCodeMetrics(projectRoot) {
    let loc = 0;
    let fileCount = 0;
    const byDir = {};

    let topLevelEntries;
    try {
        topLevelEntries = fs.readdirSync(projectRoot, { withFileTypes: true });
    } catch {
        return { loc, fileCount, byDir };
    }

    for (const entry of topLevelEntries) {
        if (!entry.isDirectory()) {
            // Handle source files directly in projectRoot (no top-level dir key)
            const ext = path.extname(entry.name);
            if (SOURCE_EXTENSIONS.has(ext)) {
                const lines = countLines(path.join(projectRoot, entry.name));
                loc += lines;
                fileCount++;
            }
            continue;
        }

        // Skip blacklisted top-level dirs
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;

        const topDirName = entry.name;
        const topDirPath = path.join(projectRoot, topDirName);
        let dirLoc = 0;
        let dirFileCount = 0;

        walkDir(topDirPath, (absPath) => {
            const lines = countLines(absPath);
            dirLoc += lines;
            dirFileCount++;
        }, topDirName);

        if (dirFileCount > 0) {
            byDir[topDirName] = dirLoc;
            loc += dirLoc;
            fileCount += dirFileCount;
        }
    }

    return { loc, fileCount, byDir };
}

module.exports = { loadCodeMetrics };
