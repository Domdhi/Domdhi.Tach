/**
 * JSONL Writer — tail-rotating JSONL append utility.
 *
 * Extracted from two identical implementations:
 *   - .claude/hooks/command-usage-logger.cjs:99-116
 *   - .claude/core/memory-benchmark.js:233-248  (labeled "copied verbatim from command-usage-logger")
 *
 * Behavior:
 *   - Creates parent directories as needed
 *   - Appends `JSON.stringify(entry) + '\n'` to the file
 *   - When line count exceeds `maxLines`, tail-rotates to keep only the last
 *     `tailKeep` lines (monotonic shrinkage — bounds file size)
 *   - Silent on any I/O failure — JSONL writes must never break the calling flow
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_LINES = 1000;
const DEFAULT_TAIL_KEEP = 500;

/**
 * Append an entry as a JSONL line, rotating tail when over `maxLines`.
 * Graceful: errors are silenced so telemetry/metrics never block the workflow.
 *
 * @param {string} jsonlPath       Absolute path to the JSONL file
 * @param {object} entry           Any JSON-serializable value — appended as one line
 * @param {object} [opts]
 * @param {number} [opts.maxLines] Line-count ceiling before rotation (default: 1000)
 * @param {number} [opts.tailKeep] Lines to keep after rotation (default: 500)
 * @param {(msg: string) => void} [opts.onError] Optional error logger; default swallows
 */
function appendJsonl(jsonlPath, entry, {
    maxLines = DEFAULT_MAX_LINES,
    tailKeep = DEFAULT_TAIL_KEEP,
    onError,
} = {}) {
    try {
        fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
        fs.appendFileSync(jsonlPath, JSON.stringify(entry) + '\n', 'utf8');

        // Tail-sample if over limit
        const content = fs.readFileSync(jsonlPath, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length > maxLines) {
            const trimmed = lines.slice(-tailKeep).join('\n') + '\n';
            fs.writeFileSync(jsonlPath, trimmed, 'utf8');
        }
    } catch (e) {
        if (onError) {
            try { onError(e.message); } catch { /* logger itself failed — swallow */ }
        }
        // Graceful degradation — never block on telemetry failure
    }
}

module.exports = { appendJsonl, DEFAULT_MAX_LINES, DEFAULT_TAIL_KEEP };
