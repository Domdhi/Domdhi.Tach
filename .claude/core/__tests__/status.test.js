import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
const require = createRequire(import.meta.url);

describe('status', () => {
    it('loads without side effects and exports helpers', () => {
        const exports = require('../status');
        expect(exports).toBeDefined();
        expect(typeof exports.findTodoFiles).toBe('function');
        expect(typeof exports.parseTodoFile).toBe('function');
        expect(typeof exports.generateHtml).toBe('function');
        expect(typeof exports.esc).toBe('function');
    });

    it('generateHtml re-export uses the new (files, telemetry, gitMetrics, outputDir) signature', () => {
        // Regression guard for the P2.4 code-review M-1 — the re-export is now
        // `_lib/status-html.generateHtml` and has a different signature from the
        // pre-split version. This test proves the chain is live and the new
        // signature returns a string rather than throwing.
        const { generateHtml } = require('../status');

        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-test-'));
        try {
            const files = [];
            const telemetry = { commands: {}, gates: {}, sessions: 0, memoryBenchmark: null };
            const gitMetrics = { commitCount: 0, branch: 'main', lastCommitAt: null, activeDays: 0 };
            const html = generateHtml(files, telemetry, gitMetrics, outputDir);
            expect(typeof html).toBe('string');
            expect(html.length).toBeGreaterThan(0);
        } finally {
            try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });

    it('esc re-export correctly escapes HTML special characters', () => {
        const { esc } = require('../status');
        expect(esc('<b>&"</b>')).toBe('&lt;b&gt;&amp;&quot;&lt;/b&gt;');
    });

    it('generateHtml accepts memMetrics 5th arg and renders Memory Health box when populated', () => {
        // Closes the M-3 deferred integration from the P2.4 code review:
        // loadMemoryMetrics output now flows through to the rendered dashboard.
        const { generateHtml } = require('../status');
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-mm-test-'));
        try {
            const memMetrics = {
                total: 12,
                byCategory: { patterns: 7, decisions: 5 },
                healthScore: 62,
                staleCount: 1,
            };
            const html = generateHtml(
                [],
                { commands: {}, gates: {}, sessions: 0, memoryBenchmark: null },
                { commitCount: 0, branch: 'main', lastCommitAt: null, activeDays: 0 },
                outputDir,
                memMetrics,
            );
            expect(html).toContain('Memory Health');
            expect(html).toContain('62');
        } finally {
            try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });

    it('generateHtml omits Memory Health box when memMetrics is null/missing (backward-compat)', () => {
        // Existing 4-arg callers must keep working.
        const { generateHtml } = require('../status');
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-mm-bc-test-'));
        try {
            const html = generateHtml(
                [],
                { commands: {}, gates: {}, sessions: 0, memoryBenchmark: null },
                { commitCount: 0, branch: 'main', lastCommitAt: null, activeDays: 0 },
                outputDir,
            );
            expect(html).not.toContain('Memory Health');
        } finally {
            try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });
});
