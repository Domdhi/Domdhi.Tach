/**
 * Git Metrics — commit count, branch, lastCommitAt, activeDays loader.
 *
 * Extracted from status.js (P2.4) to separate git-data loading from rendering.
 * Exposes an optional `{ execSync }` injection parameter for testability — avoids
 * vi.mock() hoisting issues at ESM/CJS boundaries (patterns/di-test-seam-over-vi-mock).
 *
 * Usage:
 *   const { loadGitMetrics } = require('./_lib/git-metrics');
 *   const metrics = loadGitMetrics(projectRoot);
 *   // → { commitCount, branch, lastCommitAt, activeDays }
 *
 *   // In tests, inject a stub:
 *   const metrics = loadGitMetrics(root, { execSync: stubExecSync });
 *
 * Constraints:
 *   - Never reads process.cwd() — always anchored to the explicit projectRoot arg.
 *   - All execSync calls use { windowsHide: true, stdio: ['pipe','pipe','pipe'] }.
 *   - All failures return safe defaults — never throws.
 *   - activeDays counts commit instances (not distinct dates) in the last 7 days,
 *     matching the original status.js computeInlineMetrics commitVelocity semantics.
 *     The field name "activeDays" is from the spec signature; semantically it measures
 *     recent commit activity for the "Commits (7d)" display in status.js.
 *   - Git log --date/--format options here differ from decision-viz and gen-timeline;
 *     per-consumer semantics are intentional (do not unify).
 */

const childProcess = require('child_process');

const EXEC_OPTS = {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
};

/**
 * Load git metrics for a project.
 *
 * @param {string} projectRoot          Absolute path to the project root
 * @param {object} [options={}]
 * @param {Function} [options.execSync] Optional execSync replacement for tests.
 *                                       Defaults to child_process.execSync.
 * @returns {{ commitCount: number, branch: string, lastCommitAt: string|null, activeDays: number }}
 */
function loadGitMetrics(projectRoot, options = {}) {
    const exec = options.execSync || childProcess.execSync;
    const opts = { cwd: projectRoot, ...EXEC_OPTS };

    const result = {
        commitCount: 0,
        branch: 'unknown',
        lastCommitAt: null,
        activeDays: 0,
    };

    // Branch name
    try {
        const raw = exec('git rev-parse --abbrev-ref HEAD', opts);
        result.branch = raw.trim() || 'unknown';
    } catch {
        // git unavailable or not a repo — leave default
    }

    // Total commit count
    try {
        const raw = exec('git rev-list --count HEAD', opts);
        const n = parseInt(raw.trim(), 10);
        if (!isNaN(n)) result.commitCount = n;
    } catch {
        // no commits or git error
    }

    // Last commit timestamp (ISO 8601)
    try {
        const raw = exec('git log -1 --format=%cI', opts);
        const ts = raw.trim();
        if (ts) result.lastCommitAt = ts;
    } catch {
        // no commits
    }

    // Commit count in the last 7 days — one count per commit instance.
    // Capped at the most recent 100 commits to bound git log output size (matching
    // the original status.js computeInlineMetrics commitVelocity calculation that
    // used `git log --oneline --date=short --format="%ad" -100`).
    // The field is named "activeDays" per the AC spec signature but semantically
    // represents recent commit activity for the "Commits (7d)" display label.
    try {
        const raw = exec('git log --date=short --format=%ad -100', opts);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 7);
        const cutoffStr = cutoff.toISOString().slice(0, 10);

        let velocity = 0;
        for (const line of raw.split('\n')) {
            const d = line.trim();
            if (d && d >= cutoffStr) {
                velocity++;
            }
        }
        result.activeDays = velocity;
    } catch {
        // git error
    }

    return result;
}

module.exports = { loadGitMetrics };
