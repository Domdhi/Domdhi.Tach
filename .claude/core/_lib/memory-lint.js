/**
 * Memory Lint — 7-check health audit over a pre-assembled list of memories.
 *
 * Extracted from memory-manager.js:740-911 (lintMemories). Pure function of its
 * inputs — no `this.*` coupling in the body. Caller is responsible for:
 *   1. Assembling `allMemories` as `[{category, summary, full}]`
 *   2. Passing a `calculateDecayedConfidence(memory)` closure that wraps the
 *      manager's own implementation (with its per-instance resolver)
 *
 * Checks produce `{ count, severity, findings: [...] }` per category; overall
 * health score starts at 70 and deducts {error:3, warning:2, info:1} per finding.
 */

const { jaccardFromText } = require('./jaccard');

const DEFAULT_MAX_PER_CATEGORY = 50;

const POSITIVE_SIGNALS = ['always', 'must', 'should', 'require', 'use', 'do'];
const NEGATIVE_SIGNALS = ["don't", 'never', 'avoid', 'skip', 'stop', 'remove'];

const DEDUCTIONS = { error: 3, warning: 2, info: 1 };

/**
 * Run the 7 lint checks and return a structured health report.
 *
 * @param {Array<{category: string, summary: object, full: object}>} allMemories
 *        Pre-assembled memory list. `full` must have id, updated, usage_count,
 *        content, metadata.confidence, category.
 * @param {object} opts
 * @param {(memory: object) => number} opts.calculateDecayedConfidence
 *        Returns decayed confidence in [0, 1]. Typically a closure over
 *        MemoryManager.calculateDecayedConfidence to preserve per-instance cache.
 * @param {string[]} opts.categories  Iteration order for category_balance check
 * @param {number}   [opts.maxPerCategory]  Category cap for category_balance
 *                                          check (default: 50 — matches MemoryManager)
 * @returns {{ score: number, checks: object, total_memories: number, categories_checked: number }}
 */
function lintMemories(allMemories, { calculateDecayedConfidence, categories, maxPerCategory = DEFAULT_MAX_PER_CATEGORY }) {
    const findings = {
        broken_refs:      { count: 0, severity: 'error',   findings: [] },
        orphaned:         { count: 0, severity: 'warning', findings: [] },
        contradictions:   { count: 0, severity: 'warning', findings: [] },
        stale:            { count: 0, severity: 'warning', findings: [] },
        duplicates:       { count: 0, severity: 'warning', findings: [] },
        decay_validation: { count: 0, severity: 'info',    findings: [] },
        category_balance: { count: 0, severity: 'warning', findings: [] },
    };

    const knownIds = new Set(allMemories.map(m => m.full.id));

    // Check 1 — Broken cross-references
    const refPattern = /(?:related:|see:|ref:)\s*([\w-]+)/gi;
    for (const { category, full } of allMemories) {
        const contentStr = JSON.stringify(full.content);
        let match;
        while ((match = refPattern.exec(contentStr)) !== null) {
            const referencedId = match[1];
            if (!knownIds.has(referencedId)) {
                findings.broken_refs.findings.push({
                    memory: `${category}/${full.id}`,
                    referenced_id: referencedId,
                    detail: `References ID "${referencedId}" which does not exist`,
                });
            }
        }
    }
    findings.broken_refs.count = findings.broken_refs.findings.length;

    // Check 2 — Orphaned concepts
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const { category, full } of allMemories) {
        if ((full.usage_count || 0) === 0 && new Date(full.updated).getTime() < thirtyDaysAgo) {
            findings.orphaned.findings.push({
                memory: `${category}/${full.id}`,
                usage_count: full.usage_count || 0,
                days_since_update: Math.round((Date.now() - new Date(full.updated)) / (1000 * 60 * 60 * 24)),
                detail: 'Zero usage and not updated in 30+ days',
            });
        }
    }
    findings.orphaned.count = findings.orphaned.findings.length;

    // Pre-group by category once for checks 3, 5, 7
    const byCategory = {};
    for (const m of allMemories) {
        if (!byCategory[m.category]) byCategory[m.category] = [];
        byCategory[m.category].push(m);
    }

    // Check 3 — Contradictions (same category, high overlap but conflicting signals)
    for (const [category, members] of Object.entries(byCategory)) {
        for (let i = 0; i < members.length; i++) {
            for (let j = i + 1; j < members.length; j++) {
                const textA = JSON.stringify(members[i].full.content).toLowerCase();
                const textB = JSON.stringify(members[j].full.content).toLowerCase();
                const similarity = jaccardFromText(textA, textB);
                if (similarity > 0.5 && textA !== textB) {
                    const aHasPositive = POSITIVE_SIGNALS.some(s => textA.includes(s));
                    const aHasNegative = NEGATIVE_SIGNALS.some(s => textA.includes(s));
                    const bHasPositive = POSITIVE_SIGNALS.some(s => textB.includes(s));
                    const bHasNegative = NEGATIVE_SIGNALS.some(s => textB.includes(s));
                    const conflict = (aHasPositive && bHasNegative) || (aHasNegative && bHasPositive);
                    if (conflict) {
                        findings.contradictions.findings.push({
                            memory_a: `${category}/${members[i].full.id}`,
                            memory_b: `${category}/${members[j].full.id}`,
                            overlap: Math.round(similarity * 100),
                            detail: 'High keyword overlap with conflicting positive/negative signals — flag for manual review',
                        });
                    }
                }
            }
        }
    }
    findings.contradictions.count = findings.contradictions.findings.length;

    // Check 4 — Staleness (decayed confidence < 0.3)
    for (const { category, full } of allMemories) {
        const decayed = calculateDecayedConfidence(full);
        if (decayed < 0.3) {
            findings.stale.findings.push({
                memory: `${category}/${full.id}`,
                decayed_confidence: Math.round(decayed * 1000) / 1000,
                detail: 'Decayed confidence below 0.3 threshold',
            });
        }
    }
    findings.stale.count = findings.stale.findings.length;

    // Check 5 — Duplicates (same category, Jaccard > 0.8)
    for (const [category, members] of Object.entries(byCategory)) {
        for (let i = 0; i < members.length; i++) {
            for (let j = i + 1; j < members.length; j++) {
                const textA = JSON.stringify(members[i].full.content).toLowerCase();
                const textB = JSON.stringify(members[j].full.content).toLowerCase();
                const similarity = jaccardFromText(textA, textB);
                if (similarity > 0.8) {
                    findings.duplicates.findings.push({
                        memory_a: `${category}/${members[i].full.id}`,
                        memory_b: `${category}/${members[j].full.id}`,
                        overlap: Math.round(similarity * 100),
                        detail: `Content is ${Math.round(similarity * 100)}% similar — likely duplicate`,
                    });
                }
            }
        }
    }
    findings.duplicates.count = findings.duplicates.findings.length;

    // Check 6 — Decay curve validation (raw confidence >= 0.7 but decayed < 0.3)
    for (const { category, full } of allMemories) {
        const rawConfidence = full.metadata?.confidence ?? 1.0;
        const decayed = calculateDecayedConfidence(full);
        if (rawConfidence >= 0.7 && decayed < 0.3) {
            findings.decay_validation.findings.push({
                memory: `${category}/${full.id}`,
                raw_confidence: rawConfidence,
                decayed_confidence: Math.round(decayed * 1000) / 1000,
                days_since_update: Math.round((Date.now() - new Date(full.updated)) / (1000 * 60 * 60 * 24)),
                detail: 'High raw confidence but heavily decayed — not updated in a long time',
            });
        }
    }
    findings.decay_validation.count = findings.decay_validation.findings.length;

    // Check 7 — Category balance (any category >= 80% of max)
    const balanceThreshold = Math.floor(maxPerCategory * 0.8);
    for (const category of categories) {
        const count = (byCategory[category] || []).length;
        if (count >= balanceThreshold) {
            findings.category_balance.findings.push({
                category,
                count,
                limit: maxPerCategory,
                threshold: balanceThreshold,
                detail: `${count} memories in "${category}" is >= ${balanceThreshold} (80% of ${maxPerCategory} limit)`,
            });
        }
    }
    findings.category_balance.count = findings.category_balance.findings.length;

    // Health score: start at 70, deduct per finding by severity
    let score = 70;
    for (const check of Object.values(findings)) {
        score -= check.count * DEDUCTIONS[check.severity];
    }
    score = Math.max(0, score);

    return {
        score,
        checks: findings,
        total_memories: allMemories.length,
        categories_checked: categories.length,
    };
}

module.exports = { lintMemories, DEDUCTIONS };
