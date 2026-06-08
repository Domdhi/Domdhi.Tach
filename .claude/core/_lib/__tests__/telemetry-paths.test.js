// AC→source map (P1.3 / telemetry-paths):
//   Exports: getTelemetryDir, getLogPath, getJsonlPath, getSummaryPath
//   Base: <projectRoot>/docs/.output/telemetry
//   Summary: <base>/_latest-summary.json

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const path = require('node:path');
const {
    getTelemetryDir,
    getLogPath,
    getJsonlPath,
    getSummaryPath,
} = require('../telemetry-paths');

describe('getTelemetryDir', () => {
    it('returns docs/.output/telemetry under the given project root', () => {
        expect(getTelemetryDir('/tmp/p')).toBe(path.join('/tmp/p', 'docs', '.output', 'telemetry'));
    });
});

describe('getLogPath', () => {
    it('places logs under telemetry/logs with the given prefix', () => {
        const result = getLogPath('/tmp/p', 'gate');
        const dir = path.dirname(result);
        expect(dir).toBe(path.join('/tmp/p', 'docs', '.output', 'telemetry', 'logs'));
        expect(path.basename(result).startsWith('gate')).toBe(true);
    });

    it('appends a .log suffix to the generated filename', () => {
        const result = getLogPath('/tmp/p', 'gate');
        expect(result.endsWith('.log')).toBe(true);
    });
});

describe('getJsonlPath', () => {
    it('places the given filename inside telemetry dir', () => {
        expect(getJsonlPath('/tmp/p', 'command-usage.jsonl'))
            .toBe(path.join('/tmp/p', 'docs', '.output', 'telemetry', 'command-usage.jsonl'));
    });

    it('honors a different filename', () => {
        expect(getJsonlPath('/tmp/p', 'hook-events.jsonl'))
            .toBe(path.join('/tmp/p', 'docs', '.output', 'telemetry', 'hook-events.jsonl'));
    });
});

describe('getSummaryPath', () => {
    it('returns _latest-summary.json under the telemetry dir', () => {
        expect(getSummaryPath('/tmp/p'))
            .toBe(path.join('/tmp/p', 'docs', '.output', 'telemetry', '_latest-summary.json'));
    });
});
