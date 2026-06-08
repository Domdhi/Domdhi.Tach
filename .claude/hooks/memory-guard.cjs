#!/usr/bin/env node

/**
 * Memory Guard Hook
 *
 * PostToolUse:Write hook — monitors memory directory writes and warns
 * when a category approaches its limit. Non-blocking (always exits 0).
 *
 * Exit codes:
 *   0 = always (PostToolUse hooks cannot block)
 */

const fs = require('fs');
const path = require('path');
const { isAtLeast } = require('../core/profile');
const CONSTANTS = require('../core/constants');

const MAX_MEMORIES_PER_CATEGORY = parseInt(process.env.MEMORY_MAX_PER_CATEGORY, 10) || CONSTANTS.MEMORY_FILTERS.MEMORY_MAX_PER_CATEGORY;

function readStdin() {
    return new Promise((resolve) => {
        if (process.stdin.isTTY) { resolve(''); return; }
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', () => resolve(''));
        setTimeout(() => resolve(data), 1000);
    });
}

/**
 * Count .json files in a category directory.
 * Returns 0 on missing directory or read error (graceful).
 *
 * @param {string} categoryDir - Absolute path to the category directory
 * @returns {number}
 */
function countMemoriesInCategory(categoryDir) {
    try {
        return fs.readdirSync(categoryDir).filter(f => f.endsWith('.json')).length;
    } catch {
        return 0;
    }
}

/**
 * Process a PostToolUse:Write event and emit warnings if a memory category
 * is approaching or at its limit.
 *
 * @param {object} parsedJson - Parsed hook event: { tool_input: { file_path } }
 * @returns {null} Always returns null (side effect is stderr warnings)
 */
function processEvent(parsedJson) {
    // MEMORY_PROFILE gate — minimal profile suppresses all guard warnings
    if (!isAtLeast('standard')) { return null; }

    const filePath = parsedJson?.tool_input?.file_path || '';

    // Only care about writes to memory directories
    if (!filePath.includes('memories') || !filePath.endsWith('.json')) {
        return null;
    }

    // Extract category from path: .../memories/{category}/file.json
    const parts = filePath.replace(/\\/g, '/').split('/');
    const memoriesIdx = parts.indexOf('memories');
    if (memoriesIdx === -1 || memoriesIdx + 1 >= parts.length) {
        return null;
    }

    const category = parts[memoriesIdx + 1];
    const categoryDir = path.dirname(filePath);

    const count = countMemoriesInCategory(categoryDir);

    if (count >= MAX_MEMORIES_PER_CATEGORY) {
        process.stderr.write(
            `\n  ⚠️  Memory guard: ${category} has ${count} entries (max ${MAX_MEMORIES_PER_CATEGORY}). Consider pruning stale memories.\n\n`
        );
    } else if (count >= MAX_MEMORIES_PER_CATEGORY * 0.8) {
        process.stderr.write(
            `\n  ℹ️  Memory guard: ${category} is ${Math.round(count / MAX_MEMORIES_PER_CATEGORY * 100)}% full (${count}/${MAX_MEMORIES_PER_CATEGORY}).\n\n`
        );
    }

    return null;
}

async function main() {
    const input = await readStdin();
    if (!input) { process.exit(0); }

    let data;
    try {
        data = JSON.parse(input);
    } catch {
        process.exit(0);
    }

    processEvent(data);
    process.exit(0);
}

if (require.main === module) {
    main().catch(() => process.exit(0));
}

module.exports = { processEvent, countMemoriesInCategory };
