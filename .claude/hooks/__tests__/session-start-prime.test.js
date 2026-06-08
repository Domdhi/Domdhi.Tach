// AC→source map (session-start-prime, structured-memory source):
//   - parseMemory: parses JSON memory; handles missing fields; returns null on bad JSON;
//                  extracts importance (top-level/content, default 3) + invalid_at + raw_usage
//   - rankConcepts (ME-4.2): importance-floored decayed × recency primary; usage tiebreaker only
//   - renderOutput: returns '<project_memory>...' XML block with slug/conf/summary lines
//   - processEvent: profile gate (minimal → null); missing memoriesDir → null; with memories → output string
//   - processEvent: CLAUDE_PROJECT_DIR env var controls source path
//   - processEvent: reads from memories/{category}/*.json, ignores memories/concepts/

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { createTmpDir } = require('../../core/__tests__/_helpers/tmp-dir');
const { createMemory } = require('../../core/__tests__/_helpers/memory-fixture');

const { processEvent, rankConcepts, renderOutput, parseMemory } = require('../session-start-prime.cjs');

// ---------------------------------------------------------------------------
// Env save/restore
// ---------------------------------------------------------------------------
const origProjectDir = process.env.CLAUDE_PROJECT_DIR;
const origMemoryProfile = process.env.MEMORY_PROFILE;
const origPrimeCount = process.env.MEMORY_PRIME_COUNT;

let tmp;

beforeEach(() => {
    tmp = createTmpDir({ prefix: 'session-start-prime-' });
    process.env.MEMORY_PROFILE = 'standard';
    delete process.env.MEMORY_PRIME_COUNT;
});

afterEach(() => {
    tmp.cleanup();
    process.env.MEMORY_PROFILE = origMemoryProfile ?? 'standard';
    if (origPrimeCount === undefined) delete process.env.MEMORY_PRIME_COUNT;
    else process.env.MEMORY_PRIME_COUNT = origPrimeCount;
});

afterAll(() => {
    if (origProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = origProjectDir;
});

// ---------------------------------------------------------------------------
// parseMemory
// ---------------------------------------------------------------------------

describe('parseMemory', () => {
    it('parseMemory_validJson_returnsMemoryObject', () => {
        const json = JSON.stringify({
            id: 'test-pattern',
            category: 'patterns',
            updated: '2026-04-19T00:00:00.000Z',
            usage_count: 3,
            content: { description: 'Use pattern X when Y happens' },
            metadata: { confidence: 0.8 },
        });
        const result = parseMemory(json, 'patterns', 'test-pattern.json');
        expect(result).not.toBeNull();
        expect(result.slug).toBe('test-pattern');
        expect(result.category).toBe('patterns');
        expect(result.confidence).toBe(0.8);
        expect(result.updated).toBe('2026-04-19T00:00:00.000Z');
        expect(result.usage_count).toBe(3);
        expect(result.summary).toBe('Use pattern X when Y happens');
    });

    it('parseMemory_invalidJson_returnsNull', () => {
        const result = parseMemory('not json {{{', 'patterns', 'bad.json');
        expect(result).toBeNull();
    });

    it('parseMemory_missingOptionalFields_usesDefaults', () => {
        const json = JSON.stringify({
            id: 'minimal',
            content: { description: 'Some lesson' },
        });
        const result = parseMemory(json, 'constraints', 'minimal.json');
        expect(result).not.toBeNull();
        expect(result.confidence).toBe(0.6);
        expect(result.usage_count).toBe(1);
        expect(result.updated).toBeNull();
        expect(result.summary).toBe('Some lesson');
    });

    it('parseMemory_zeroUsage_floorsAtOne', () => {
        const json = JSON.stringify({
            id: 'unused',
            content: { description: 'A memory nobody has touched' },
            usage_count: 0,
            metadata: { confidence: 1 },
        });
        const result = parseMemory(json, 'patterns', 'unused.json');
        expect(result.usage_count).toBe(1);
        expect(result.raw_usage).toBe(0); // unfloored, for the tiebreaker
    });

    it('parseMemory_importance_topLevelThenContentThenDefault', () => {
        const top = parseMemory(JSON.stringify({ id: 'a', importance: 5, content: { description: 'x' } }), 'patterns', 'a.json');
        expect(top.importance).toBe(5);
        const inContent = parseMemory(JSON.stringify({ id: 'b', content: { description: 'x', importance: 2 } }), 'patterns', 'b.json');
        expect(inContent.importance).toBe(2);
        const def = parseMemory(JSON.stringify({ id: 'c', content: { description: 'x' } }), 'patterns', 'c.json');
        expect(def.importance).toBe(3);
    });

    it('parseMemory_invalidAt_surfacedForSupersededSkip', () => {
        const sup = parseMemory(JSON.stringify({ id: 'd', invalid_at: '2026-01-01T00:00:00.000Z', content: { description: 'x' } }), 'patterns', 'd.json');
        expect(sup.invalid_at).toBe('2026-01-01T00:00:00.000Z');
        const live = parseMemory(JSON.stringify({ id: 'e', content: { description: 'x' } }), 'patterns', 'e.json');
        expect(live.invalid_at).toBeNull();
    });

    it('parseMemory_missingId_fallsBackToFilename', () => {
        const json = JSON.stringify({
            content: { description: 'No id field' },
        });
        const result = parseMemory(json, 'patterns', 'filename-slug.json');
        expect(result.slug).toBe('filename-slug');
    });

    it('parseMemory_longSummary_truncates', () => {
        const longText = 'x'.repeat(500);
        const json = JSON.stringify({
            id: 'long',
            content: { description: longText },
        });
        const result = parseMemory(json, 'patterns', 'long.json');
        expect(result.summary.length).toBeLessThanOrEqual(160);
        expect(result.summary.endsWith('...')).toBe(true);
    });

    it('parseMemory_contentStringShape_extracted', () => {
        // Some hand-created memories store content as a plain string
        const json = JSON.stringify({
            id: 'string-content',
            content: 'Short lesson text',
            metadata: { confidence: 0.7 },
        });
        const result = parseMemory(json, 'patterns', 'string-content.json');
        expect(result.summary).toBe('Short lesson text');
    });
});

// ---------------------------------------------------------------------------
// rankConcepts
// ---------------------------------------------------------------------------

describe('rankConcepts', () => {
    it('rankConcepts_ordersByImportanceFlooredDecayTimesRecency_usageNotPrimary', () => {
        const today = new Date().toISOString().slice(0, 10);
        const stubManager = {
            calculateDecayedConfidence: vi.fn(({ metadata }) => metadata.confidence)
        };
        const concepts = [
            { slug: 'low-conf', confidence: 0.3, updated: today, usage_count: 10, raw_usage: 10, category: 'patterns' },
            { slug: 'high-conf', confidence: 0.9, updated: today, usage_count: 10, raw_usage: 10, category: 'patterns' },
            { slug: 'stale', confidence: 0.9, updated: '2025-01-01', usage_count: 10, raw_usage: 10, category: 'patterns' },
        ];
        const ranked = rankConcepts(concepts, stubManager);
        expect(ranked[0].slug).toBe('high-conf');
        expect(ranked[0].slug).not.toBe('stale');
    });

    it('rankConcepts_usageIsNoLongerPrimary_highUsageLowConfRanksBelowLowUsageHighConf', () => {
        // Under the OLD formula (decayed × recency × log(1+usage)) the heavy-usage
        // low-confidence memory would win. Under ME-4.2 it must NOT — usage is only
        // a tiebreaker, so the high-confidence memory ranks first.
        const today = new Date().toISOString().slice(0, 10);
        const stubManager = { calculateDecayedConfidence: vi.fn(({ metadata }) => metadata.confidence) };
        const concepts = [
            { slug: 'heavy-usage-low-conf', confidence: 0.3, updated: today, usage_count: 100, raw_usage: 100, category: 'patterns' },
            { slug: 'light-usage-high-conf', confidence: 0.9, updated: today, usage_count: 1, raw_usage: 1, category: 'patterns' },
        ];
        const ranked = rankConcepts(concepts, stubManager);
        expect(ranked[0].slug).toBe('light-usage-high-conf');
    });

    it('rankConcepts_usageBreaksTies_whenScoresEqual', () => {
        // Identical confidence + recency → equal primary score → usage breaks the tie.
        const today = new Date().toISOString().slice(0, 10);
        const stubManager = { calculateDecayedConfidence: vi.fn(({ metadata }) => metadata.confidence) };
        const concepts = [
            { slug: 'tie-low-usage', confidence: 0.7, updated: today, usage_count: 1, raw_usage: 1, category: 'patterns' },
            { slug: 'tie-high-usage', confidence: 0.7, updated: today, usage_count: 9, raw_usage: 9, category: 'patterns' },
        ];
        const ranked = rankConcepts(concepts, stubManager);
        expect(ranked[0].slug).toBe('tie-high-usage');
    });

    it('rankConcepts_passesImportanceIntoDecayCalc', () => {
        // Importance is the primary signal — it must reach calculateDecayedConfidence
        // (the ME-2.2 floor) rather than being ignored.
        const today = new Date().toISOString().slice(0, 10);
        const stubManager = { calculateDecayedConfidence: vi.fn(({ metadata }) => metadata.confidence) };
        const concepts = [
            { slug: 'imp', confidence: 0.7, updated: today, usage_count: 1, raw_usage: 1, importance: 5, category: 'patterns' },
        ];
        rankConcepts(concepts, stubManager);
        expect(stubManager.calculateDecayedConfidence).toHaveBeenCalledWith(
            expect.objectContaining({ importance: 5 })
        );
    });

    it('rankConcepts_mutatesConceptsWithScore', () => {
        const today = new Date().toISOString().slice(0, 10);
        const stubManager = {
            calculateDecayedConfidence: vi.fn(() => 0.7)
        };
        const concepts = [
            { slug: 'a', confidence: 0.7, updated: today, usage_count: 5, category: 'patterns' }
        ];
        rankConcepts(concepts, stubManager);
        expect(typeof concepts[0].score).toBe('number');
        expect(concepts[0].score).toBeGreaterThan(0);
    });

    it('rankConcepts_managerDecayFailure_fallsBackToStoredConfidence', () => {
        const today = new Date().toISOString().slice(0, 10);
        const stubManager = {
            calculateDecayedConfidence: vi.fn(() => { throw new Error('db error'); })
        };
        const concepts = [
            { slug: 'fallback', confidence: 0.75, updated: today, usage_count: 2, category: 'patterns' }
        ];
        expect(() => rankConcepts(concepts, stubManager)).not.toThrow();
        expect(typeof concepts[0].score).toBe('number');
    });

    it('rankConcepts_returnsSameArrayReference', () => {
        const today = new Date().toISOString().slice(0, 10);
        const stubManager = { calculateDecayedConfidence: vi.fn(() => 0.5) };
        const concepts = [
            { slug: 'x', confidence: 0.5, updated: today, usage_count: 1, category: 'patterns' }
        ];
        const result = rankConcepts(concepts, stubManager);
        expect(result).toBe(concepts);
    });
});

// ---------------------------------------------------------------------------
// renderOutput
// ---------------------------------------------------------------------------

describe('renderOutput', () => {
    it('renderOutput_producesProjectMemoryXmlBlock', () => {
        const today = new Date().toISOString().slice(0, 10);
        const topConcepts = [
            { slug: 'my-memory', decayed: 0.82, summary: 'A test summary', category: 'patterns', updated: today }
        ];
        const output = renderOutput(topConcepts, 5);
        expect(output).toContain('<project_memory>');
        expect(output).toContain('</project_memory>');
        expect(output).toContain('my-memory');
        expect(output).toContain('0.82');
        expect(output).toContain('A test summary');
    });

    it('renderOutput_includesTotalCountInHeader', () => {
        const today = new Date().toISOString().slice(0, 10);
        const topConcepts = [
            { slug: 'a', decayed: 0.9, summary: 'Summary A', category: 'patterns', updated: today }
        ];
        const output = renderOutput(topConcepts, 42);
        expect(output).toContain('42');
    });

    it('renderOutput_includesCategoryTag', () => {
        const today = new Date().toISOString().slice(0, 10);
        const topConcepts = [
            { slug: 'a', decayed: 0.9, summary: 'Summary A', category: 'constraints', updated: today }
        ];
        const output = renderOutput(topConcepts, 1);
        expect(output).toContain('[constraints]');
    });
});

// ---------------------------------------------------------------------------
// processEvent
// ---------------------------------------------------------------------------

describe('processEvent', () => {
    it('processEvent_profileMinimal_returnsOutputNull', () => {
        process.env.MEMORY_PROFILE = 'minimal';
        process.env.CLAUDE_PROJECT_DIR = tmp.root;
        const result = processEvent({});
        expect(result).toEqual({ output: null });
    });

    it('processEvent_missingMemoriesDir_returnsOutputNull', () => {
        process.env.MEMORY_PROFILE = 'standard';
        process.env.CLAUDE_PROJECT_DIR = tmp.root;
        const result = processEvent({});
        expect(result).toEqual({ output: null });
    });

    it('processEvent_emptyCategoryDirs_returnsOutputNull', () => {
        process.env.MEMORY_PROFILE = 'standard';
        process.env.CLAUDE_PROJECT_DIR = tmp.root;
        tmp.mkdir('docs/.output/memories/patterns');
        tmp.mkdir('docs/.output/memories/constraints');
        const result = processEvent({});
        expect(result).toEqual({ output: null });
    });

    it('processEvent_withMemories_returnsProjectMemoryOutput', () => {
        process.env.MEMORY_PROFILE = 'standard';
        process.env.CLAUDE_PROJECT_DIR = tmp.root;
        createMemory(tmp, 'patterns', 'test-pattern', {
            description: 'Wave plans should enumerate file ownership to enable parallel dispatch',
            confidence: 0.9,
        });
        const result = processEvent({});
        expect(result).toHaveProperty('output');
        expect(result.output).toContain('<project_memory>');
        expect(result.output).toContain('test-pattern');
        expect(result.output).toContain('Wave plans should enumerate');
    });

    it('processEvent_pullsFromMultipleCategories', () => {
        process.env.MEMORY_PROFILE = 'standard';
        process.env.CLAUDE_PROJECT_DIR = tmp.root;
        createMemory(tmp, 'patterns', 'pat-one', { description: 'Pattern one' });
        createMemory(tmp, 'constraints', 'con-one', { description: 'Constraint one' });
        const result = processEvent({});
        expect(result.output).toContain('pat-one');
        expect(result.output).toContain('con-one');
        expect(result.output).toContain('2'); // total count
    });

    it('processEvent_ignoresConceptsSubdir', () => {
        process.env.MEMORY_PROFILE = 'standard';
        process.env.CLAUDE_PROJECT_DIR = tmp.root;
        // concepts/ is the old compaction-snapshot output — the new hook MUST ignore it
        tmp.write(
            'docs/.output/memories/concepts/decisions/old-noise.md',
            '---\ntitle: Old Noise\nconfidence: 0.9\n---\n\n> [!abstract] Summary\n> Activity observed...\n'
        );
        const result = processEvent({});
        expect(result).toEqual({ output: null });
    });

    it('processEvent_primecountEnvVar_limitsTopN', () => {
        process.env.MEMORY_PROFILE = 'standard';
        process.env.CLAUDE_PROJECT_DIR = tmp.root;
        process.env.MEMORY_PRIME_COUNT = '1';
        createMemory(tmp, 'patterns', 'm-1', { description: 'One', confidence: 0.9 });
        createMemory(tmp, 'patterns', 'm-2', { description: 'Two', confidence: 0.8 });
        createMemory(tmp, 'patterns', 'm-3', { description: 'Three', confidence: 0.7 });
        const result = processEvent({});
        const bulletLines = result.output.split('\n').filter(l => l.startsWith('- **'));
        expect(bulletLines).toHaveLength(1);
    });

    it('processEvent_skipsNonJsonFiles', () => {
        process.env.MEMORY_PROFILE = 'standard';
        process.env.CLAUDE_PROJECT_DIR = tmp.root;
        createMemory(tmp, 'patterns', 'valid', { description: 'Valid memory' });
        tmp.write('docs/.output/memories/patterns/readme.md', '# Not a memory');
        const result = processEvent({});
        expect(result.output).toContain('valid');
        expect(result.output).not.toContain('readme');
    });
});

// ---------------------------------------------------------------------------
// Injection telemetry (MP-1.2)
//   - a real injection appends exactly one parseable `memory_injection` event
//   - injected_ids equals the slugs of the rendered (injected) memories
//   - an empty store injects nothing → writes no telemetry
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

function injectionLogPath(root) {
    return path.join(root, 'docs', '.output', 'telemetry', 'memory-injection.jsonl');
}

describe('injection telemetry', () => {
    it('processEvent_withMemories_appendsOneMemoryInjectionEvent', () => {
        process.env.MEMORY_PROFILE = 'standard';
        process.env.CLAUDE_PROJECT_DIR = tmp.root;
        createMemory(tmp, 'patterns', 'mp12-alpha', { description: 'Alpha lesson', confidence: 0.9 });
        createMemory(tmp, 'decisions', 'mp12-beta', { description: 'Beta lesson', confidence: 0.8 });

        const result = processEvent({});
        expect(result.output).toBeTruthy();

        const logPath = injectionLogPath(tmp.root);
        expect(fs.existsSync(logPath)).toBe(true);

        const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(l => l.trim());
        expect(lines).toHaveLength(1);

        const event = JSON.parse(lines[0]);
        expect(event.type).toBe('memory_injection');
        expect(event.injected_count).toBe(2);
        expect(event.total_available).toBe(2);
        expect(Array.isArray(event.injected_ids)).toBe(true);
        // injected_ids match the rendered memories (denominator for hit-rate)
        expect(event.injected_ids.slice().sort()).toEqual(['mp12-alpha', 'mp12-beta']);
        expect(event.session_proxy).toBe(event.timestamp.slice(0, 16));
    });

    it('processEvent_emptyStore_writesNoInjectionLog', () => {
        process.env.MEMORY_PROFILE = 'standard';
        process.env.CLAUDE_PROJECT_DIR = tmp.root;
        // no memories seeded → nothing injected
        const result = processEvent({});
        expect(result).toEqual({ output: null });
        expect(fs.existsSync(injectionLogPath(tmp.root))).toBe(false);
    });

    it('processEvent_injectedIdsMatchRenderedSlugs', () => {
        process.env.MEMORY_PROFILE = 'standard';
        process.env.CLAUDE_PROJECT_DIR = tmp.root;
        process.env.MEMORY_PRIME_COUNT = '1';
        createMemory(tmp, 'patterns', 'top-mem', { description: 'Top', confidence: 0.95 });
        createMemory(tmp, 'patterns', 'low-mem', { description: 'Low', confidence: 0.5 });

        const result = processEvent({});
        const event = JSON.parse(
            fs.readFileSync(injectionLogPath(tmp.root), 'utf8').trim().split('\n').pop()
        );
        // only the top-1 was rendered, so only its id is logged
        expect(event.injected_count).toBe(1);
        expect(event.total_available).toBe(2);
        expect(event.injected_ids).toEqual(['top-mem']);
        expect(result.output).toContain('top-mem');
        expect(result.output).not.toContain('low-mem');
    });
});
