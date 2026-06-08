#!/usr/bin/env node

/**
 * SessionStart Context Prime Hook
 *
 * Injects a bulleted list of the top-N structured memories as a
 * system-reminder at the opening of every Claude Code session. These are
 * the JSON memories produced by the Haiku extractor (or hand-created via
 * memory-manager.js) — the substantive, curated lessons — not the
 * compaction-snapshot concept articles at memories/concepts/ (which tend
 * to be branch-activity meta-noise).
 *
 * Source: docs/.output/memories/{category}/*.json
 *   where category in {patterns, constraints, decisions, workflows, rejected-approaches}
 *
 * Ranking (ME-4.2): importance_floored_decayed × recency_factor, with usage as a
 * TIEBREAKER only (not a primary multiplier — usage_count is a lower bound that
 * passive injection can't see, so it must not dominate ranking).
 *   - importance:         1–5 write-time score, fed into calculateDecayedConfidence
 *                         as the retention floor (importance ≤2 sinks, ≥4 resists)
 *   - decayed_confidence: via MemoryManager.calculateDecayedConfidence() (importance-aware)
 *   - recency_factor:     1 / (1 + daysSinceLastUpdated); 1.0 if missing
 *   - usage tiebreaker:   halved-on-silence raw usage, only breaks score ties
 *   - size budget:        top-N slice (N = MEMORY_PRIME_COUNT or DEFAULT_N=8, ≤MAX_N)
 *                         forces ranking down even when nothing has aged
 *   - superseded memories (invalid_at set) are never injected
 *
 * Output: XML-tagged markdown block written to stdout. Claude Code injects
 * hook stdout as a session system-reminder — no JSON envelope required.
 *
 * Gating:
 *   - MEMORY_PROFILE=minimal       → exits 0 with empty output
 *   - MEMORY_PRIME_COUNT env var   → overrides default N=8 (clamped 1..20)
 *
 * Safety: wraps everything in try/catch + 2s hard timeout. On any failure
 * exits 0 silently so a bug here can never block session start.
 *
 * Exit codes: always 0
 */

const fs = require('fs');
const path = require('path');
const { isAtLeast } = require('../core/profile');
const CONSTANTS = require('../core/constants');
const { appendJsonl } = require('../core/_lib/jsonl-writer');
const { halveUsageCount } = require('../core/_lib/memory-decay');

const USAGE_HALVE_EVERY_DAYS = CONSTANTS.MEMORY_DECAY.USAGE_HALVE_EVERY_DAYS;
const IMPORTANCE_DEFAULT = CONSTANTS.MEMORY_FILTERS.IMPORTANCE_DEFAULT;

const HARD_TIMEOUT_MS = 2000;
const SOFT_BUDGET_MS = 500;
const DEFAULT_N = 8;
const MAX_N = 20;
const SUMMARY_MAX = 160;
const MEMORY_CATEGORIES = Object.values(CONSTANTS.MEMORY_CATEGORIES);

function parseMemory(content, category, filename) {
    let json;
    try {
        json = JSON.parse(content);
    } catch {
        return null;
    }

    const slug = filename.replace(/\.json$/, '');
    const id = typeof json.id === 'string' && json.id ? json.id : slug;

    let summary = '';
    if (json.content && typeof json.content === 'object') {
        if (typeof json.content.description === 'string') {
            summary = json.content.description;
        } else if (typeof json.content.summary === 'string') {
            summary = json.content.summary;
        }
    } else if (typeof json.content === 'string') {
        summary = json.content;
    }
    summary = summary.trim();
    if (summary.length > SUMMARY_MAX) summary = summary.slice(0, SUMMARY_MAX - 3) + '...';

    let confidence = 0.6;
    if (json.metadata && Number.isFinite(json.metadata.confidence)) {
        confidence = json.metadata.confidence;
    } else if (Number.isFinite(json.confidence)) {
        confidence = json.confidence;
    }

    const rawUsage = Number.isFinite(json.usage_count) ? json.usage_count : 0;
    const usage_count = Math.max(1, rawUsage);

    // ME-4.2: importance (1–5) is the PRIMARY ranking signal — top-level, then
    // content, default 3. raw_usage (unfloored) is the tiebreaker input.
    let importance = 3;
    if (Number.isFinite(json.importance)) importance = json.importance;
    else if (json.content && Number.isFinite(json.content.importance)) importance = json.content.importance;

    // Supersession (ME-3.x): a superseded memory must never be injected.
    const invalid_at = typeof json.invalid_at === 'string' ? json.invalid_at : null;

    const updated = typeof json.updated === 'string' ? json.updated : null;

    return {
        slug: id,
        title: id,
        category,
        confidence,
        updated,
        usage_count,
        raw_usage: rawUsage,
        importance,
        invalid_at,
        summary: summary || '(no summary)'
    };
}

function rankConcepts(concepts, manager) {
    const now = Date.now();

    for (const c of concepts) {
        const importance = Number.isFinite(c.importance) ? c.importance : IMPORTANCE_DEFAULT;
        let decayed = 0.6;
        try {
            // Pass importance so the ME-2.2 retention floor applies — importance is
            // the PRIMARY signal, expressed through decayed_confidence (a low-
            // importance memory sinks, a high-importance one resists decay).
            decayed = manager.calculateDecayedConfidence({
                metadata: { confidence: c.confidence },
                category: c.category,
                updated: c.updated || new Date().toISOString(),
                usage_count: c.usage_count,
                importance
            });
        } catch {
            decayed = c.confidence;
        }

        let recency = 1.0;
        let daysSinceUpdated = 0;
        if (c.updated) {
            const days = (now - new Date(c.updated).getTime()) / (1000 * 60 * 60 * 24);
            if (Number.isFinite(days) && days >= 0) {
                daysSinceUpdated = days;
                recency = 1 / (1 + days);
            }
        }

        // Primary score: importance-floored decay × recency. Usage is NOT a factor
        // here — it only breaks ties below (it's a lower bound, must not dominate).
        c.score = decayed * recency;
        c.decayed = decayed;
        // Tiebreaker: raw usage, halved as it goes silent (TinyLFU-style aging) so
        // a once-popular-now-cold memory doesn't win ties forever.
        const rawUsage = Number.isFinite(c.raw_usage) ? c.raw_usage : 0;
        c.usageTiebreak = halveUsageCount(rawUsage, daysSinceUpdated, USAGE_HALVE_EVERY_DAYS);
    }

    // Importance-floored decay × recency is primary; usage only breaks ties.
    concepts.sort((a, b) => {
        if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
        return (b.usageTiebreak || 0) - (a.usageTiebreak || 0);
    });
    return concepts;
}

function renderOutput(topConcepts, totalCount) {
    const lines = topConcepts.map(c => {
        const confStr = c.decayed.toFixed(2);
        const cat = c.category ? ` [${c.category}]` : '';
        return `- **${c.slug}**${cat} (conf: ${confStr}) — ${c.summary}`;
    });

    return `<project_memory>
# Project Memory

Top ${topConcepts.length} of ${totalCount} structured memories (ranked by importance-floored confidence × recency; usage breaks ties).

${lines.join('\n')}
</project_memory>
`;
}

function processEvent(_parsedJson) {
    if (!isAtLeast('standard')) {
        return { output: null };
    }

    const projectDir = process.env.CLAUDE_PROJECT_DIR
        || path.resolve(__dirname, '..', '..');
    const memoriesDir = path.join(projectDir, 'docs', '.output', 'memories');

    if (!fs.existsSync(memoriesDir)) return { output: null };

    const rawN = parseInt(process.env.MEMORY_PRIME_COUNT, 10);
    const N = Number.isFinite(rawN)
        ? Math.min(MAX_N, Math.max(1, rawN))
        : DEFAULT_N;

    const memories = [];
    for (const category of MEMORY_CATEGORIES) {
        const catDir = path.join(memoriesDir, category);
        if (!fs.existsSync(catDir)) continue;
        let files;
        try {
            files = fs.readdirSync(catDir).filter(f => f.endsWith('.json'));
        } catch {
            continue;
        }
        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(catDir, file), 'utf8');
                const parsed = parseMemory(content, category, file);
                // Never inject a superseded memory (ME-3.x / ME-4.2).
                if (parsed && !parsed.invalid_at) memories.push(parsed);
            } catch {
                // skip unreadable memory
            }
        }
    }

    if (memories.length === 0) return { output: null };

    const MemoryManager = require('../core/memory-manager');
    const manager = new MemoryManager();
    rankConcepts(memories, manager);

    // Size budget (ME-4.2): hard top-N cap. Even on an active project where
    // nothing has aged below threshold, this forces ranking down to the budget so
    // the injected tier always earns its tokens.
    const top = memories.slice(0, N);
    const output = renderOutput(top, memories.length);

    // MP-1.2: record which memories were surfaced this session start, so hit-rate
    // analysis has a denominator. Best-effort — a telemetry failure here must
    // never break injection, so the whole write is wrapped and swallowed.
    // When 0 memories are injected the function returns earlier (line ~179), so
    // this only logs real injections (injected_count >= 1).
    try {
        const ts = new Date().toISOString();
        const jsonlPath = path.join(projectDir, 'docs', '.output', 'telemetry', 'memory-injection.jsonl');
        appendJsonl(jsonlPath, {
            timestamp: ts,
            type: 'memory_injection',
            injected_count: top.length,
            total_available: memories.length,
            injected_ids: top.map(c => c.slug),
            session_proxy: ts.slice(0, 16),   // ISO-8601 truncated to the minute — session join key
        });
    } catch {
        // best-effort — injection output still prints
    }

    return { output };
}

if (require.main === module) {
    const hardExit = setTimeout(() => process.exit(0), HARD_TIMEOUT_MS);
    hardExit.unref();

    process.on('uncaughtException', () => process.exit(0));
    process.on('unhandledRejection', () => process.exit(0));

    (async () => {
        const start = process.hrtime.bigint();

        try {
            const result = processEvent({});

            if (result.output !== null) {
                process.stdout.write(result.output);

                const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
                if (elapsedMs > SOFT_BUDGET_MS) {
                    process.stderr.write(
                        `[session-start-prime] ${elapsedMs.toFixed(0)}ms (budget ${SOFT_BUDGET_MS}ms)\n`
                    );
                }
            }
        } catch {
            // Never break session start
        }

        process.exit(0);
    })();
}

module.exports = { processEvent, rankConcepts, renderOutput, parseMemory };
