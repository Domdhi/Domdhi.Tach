import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(import.meta.url);

describe('metrics', () => {
    it('loads without side effects and exports helpers', () => {
        const exports = require('../metrics');
        expect(exports).toBeDefined();
        expect(typeof exports.buildReport).toBe('function');
        expect(typeof exports.prettyReport).toBe('function');
        expect(typeof exports.findTodoFiles).toBe('function');
        expect(typeof exports.parseTodoFileStories).toBe('function');
        expect(typeof exports.computeTelemetry).toBe('function');
    });
});

// Regression (2026-06-03): gate-outcome vocabulary normalization.
// command-usage-logger emits 'success'/'failure'/'unknown', but pre-A4 JSONL
// still carries legacy 'pass'/'fail'. computeTelemetry must count BOTH vocabs
// and IGNORE 'unknown' — the old `else fail++` branch miscounted both legacy
// passes and unknowns as failures, inflating the fail rate.
describe('computeTelemetry — gate outcome normalization', () => {
    let dir, prevEnv;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-tel-'));
        const telDir = path.join(dir, 'docs', '.output', 'telemetry');
        fs.mkdirSync(telDir, { recursive: true });
        const rows = [
            { type: 'gate_run', command: 'gate:test', outcome: 'success' },
            { type: 'gate_run', command: 'gate:test', outcome: 'pass' },     // legacy pass
            { type: 'gate_run', command: 'gate:test', outcome: 'failure' },
            { type: 'gate_run', command: 'gate:test', outcome: 'fail' },     // legacy fail
            { type: 'gate_run', command: 'gate:test', outcome: 'unknown' },  // no signal — ignore
        ];
        fs.writeFileSync(path.join(telDir, 'command-usage.jsonl'),
            rows.map(r => JSON.stringify(r)).join('\n') + '\n');
        prevEnv = process.env.CLAUDE_PROJECT_DIR;
        process.env.CLAUDE_PROJECT_DIR = dir;
        // PROJECT_ROOT is captured at module load; clear the CJS require cache
        // (vi.resetModules does not touch createRequire's cache) so the re-require
        // recomputes PROJECT_ROOT from the temp CLAUDE_PROJECT_DIR.
        delete require.cache[require.resolve('../metrics')];
        delete require.cache[require.resolve('../_lib/telemetry-paths')];
    });
    afterEach(() => {
        if (prevEnv === undefined) delete process.env.CLAUDE_PROJECT_DIR;
        else process.env.CLAUDE_PROJECT_DIR = prevEnv;
        fs.rmSync(dir, { recursive: true, force: true });
        delete require.cache[require.resolve('../metrics')];
        delete require.cache[require.resolve('../_lib/telemetry-paths')];
    });

    it('counts both vocabularies and ignores unknown', () => {
        const { computeTelemetry } = require('../metrics');
        const t = computeTelemetry();
        const g = t.gate_results['gate:test'];
        expect(g.pass).toBe(2);   // success + legacy pass
        expect(g.fail).toBe(2);   // failure + legacy fail; unknown NOT counted
        expect(g.pass_rate).toBe(50.0);
    });
});
