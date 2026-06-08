/**
 * Hook Spawners — shared async process-spawn helpers for hooks.
 *
 * Preserves the exact spawn options matrix — `stdio: 'ignore'`, `cwd:
 * projectRoot`, `windowsHide: true`, then `child.unref()` — that every caller
 * was copy-pasting inline. The Windows path quoting is fragile; do NOT change
 * the argv shape without verifying on Windows.
 *
 * NOTE: spawnMemoryCurator was deliberately NOT extracted. It has a single
 * caller (memory-capture.cjs) and per the TODO's "no speculative generalization"
 * rule, one-call-site helpers stay inlined until a second caller appears.
 */

const childProcess = require('child_process');
const path = require('path');

/**
 * Spawn `.claude/core/daily-log.js capture --trigger <trigger>` as a detached
 * child so the hook can return immediately without blocking on daily-log work.
 *
 * The spawn function is exposed via options.spawn for tests — production code
 * never passes it, so behavior is identical to inline spawn().
 *
 * @param {string} projectRoot         Absolute path to the project root
 * @param {string} trigger             Trigger label (e.g. 'auto-stop')
 * @param {object} [options]
 * @param {Function} [options.spawn]   Override for child_process.spawn (testing)
 */
function spawnDailyLogCapture(projectRoot, trigger, { spawn = childProcess.spawn } = {}) {
    const child = spawn('node', [
        path.join(projectRoot, '.claude', 'core', 'daily-log.js'),
        'capture',
        '--trigger',
        trigger,
    ], {
        stdio: 'ignore',
        cwd: projectRoot,
        windowsHide: true,
    });
    child.unref();
}

module.exports = { spawnDailyLogCapture };
