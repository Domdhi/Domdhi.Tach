// AC→source map (pre-compaction-archive, post-2026-04-20 refactor):
//   - buildSnapshot: reads git branch/status/log, inProgress, decisions → structured markdown string
//   - buildSnapshot: includes trigger and branch name in output
//   - processEvent: writes snapshot to docs/.output/sessions/{date}/{time}-pre-compaction.md
//   - processEvent: calls log.capture('Pre-Compaction')
//   - processEvent: NEVER spawns memory-extractor (extraction moved to session-handoff skill)
//   - Source no longer imports child_process.spawn; the mock is retained in case the
//     regression test "no spawn ever fires" needs to fail loudly if someone adds it back.

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

const { createTmpDir } = require('../../core/__tests__/_helpers/tmp-dir');
const { installExecSyncMock } = require('../../core/__tests__/_helpers/claude-mock');

// ---------------------------------------------------------------------------
// Env save/restore (must happen BEFORE installExecSyncMock loads the source)
// ---------------------------------------------------------------------------
const origProjectDir = process.env.CLAUDE_PROJECT_DIR;
const origMemoryProfile = process.env.MEMORY_PROFILE;

// ---------------------------------------------------------------------------
// DailyLog mock injection — MUST happen BEFORE installExecSyncMock.
//
// pre-compaction-archive.cjs does `const DailyLog = require('../core/daily-log')`
// at top-level (line 22). The hook captures that class reference at module load.
// If we inject into require.cache AFTER load, the hook's reference still points
// at the real class — same problem as the child_process destructure issue.
//
// Fix: install a proxy DailyLog class into require.cache FIRST. The hook's
// top-level require picks it up. Individual tests set `currentMockLog` to
// control the per-test instance the proxy constructor returns.
// ---------------------------------------------------------------------------
const dailyLogCachePath = require.resolve('../../core/daily-log');
let currentMockLog = null;

require.cache[dailyLogCachePath] = {
    id: dailyLogCachePath,
    filename: dailyLogCachePath,
    exports: class DailyLog {
        constructor() {
            if (currentMockLog) Object.assign(this, currentMockLog);
        }
    },
    loaded: true,
    children: [],
    paths: []
};

// ---------------------------------------------------------------------------
// Load source + inject spawn mock.
// pre-compaction-archive.cjs destructures spawn at line 20:
//   const { spawn } = require('child_process');
// installExecSyncMock pre-populates require.cache before the source loads.
// The spawn fake returns an object with unref() — the hook calls child.unref().
// ---------------------------------------------------------------------------
const { mocks, source } = installExecSyncMock(
    vi,
    () => require('../pre-compaction-archive.cjs'),
    ['spawn']
);
const spawnMock = mocks.spawn;
spawnMock.mockImplementation(() => ({ unref: vi.fn() }));
const { processEvent, buildSnapshot } = source;

// ---------------------------------------------------------------------------
// Per-test sandbox
// ---------------------------------------------------------------------------
let tmp;

// Shared DailyLog mock factory — creates a log instance mock that exercises all
// the DailyLog API points pre-compaction-archive uses.
function makeMockLog(overrides = {}) {
    return {
        run: vi.fn(cmd => {
            if (cmd && cmd.includes('git status')) return '';
            if (cmd && cmd.includes('git log')) return 'abc1234 feat: add thing';
            if (cmd && cmd.includes('git branch')) return 'main';
            return '';
        }),
        findInProgressTodos: vi.fn(() => '(none)'),
        findKeyDecisions: vi.fn(() => '(none)'),
        capture: vi.fn(() => ({ logPath: path.join(tmp ? tmp.root : '/tmp', 'daily.md') })),
        ...overrides
    };
}

function injectDailyLogMock(mockInstance) {
    // Swap the per-test mock; the hook's DailyLog class reference is stable
    // (installed above), but each new DailyLog() picks up this mock's methods.
    currentMockLog = mockInstance;
}

beforeEach(() => {
    tmp = createTmpDir({ prefix: 'pre-compaction-' });
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => ({ unref: vi.fn() }));
    currentMockLog = null;
    process.env.MEMORY_PROFILE = 'standard';
    // Isolate the hook's write paths. pre-compaction-archive.cjs resolves its
    // output root from CLAUDE_PROJECT_DIR (lazily, per call); setting it to
    // tmp.root guarantees snapshot + daily-log writes land in the sandbox
    // and never pollute the real repo's docs/.output/sessions/ or memories/.
    process.env.CLAUDE_PROJECT_DIR = tmp.root;
});

afterEach(() => {
    tmp.cleanup();
    currentMockLog = null;
    if (origMemoryProfile === undefined) delete process.env.MEMORY_PROFILE;
    else process.env.MEMORY_PROFILE = origMemoryProfile;
    if (origProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = origProjectDir;
});

afterAll(() => {
    delete require.cache[dailyLogCachePath];
    // CLAUDE_PROJECT_DIR restore also happens per-test in afterEach; this
    // afterAll is belt-and-suspenders in case a test bails before afterEach.
    if (origProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = origProjectDir;
});

// ---------------------------------------------------------------------------
// buildSnapshot
// ---------------------------------------------------------------------------

describe('buildSnapshot', () => {
    it('buildSnapshot_containsSnapshotHeader', () => {
        const mockLog = makeMockLog();
        const snap = buildSnapshot(tmp.root, mockLog, 'test-trigger');
        expect(snap).toContain('# Pre-Compaction Snapshot');
    });

    it('buildSnapshot_containsTriggerInOutput', () => {
        const mockLog = makeMockLog();
        const snap = buildSnapshot(tmp.root, mockLog, 'manual');
        expect(snap).toContain('manual');
    });

    it('buildSnapshot_containsGitBranch', () => {
        const mockLog = makeMockLog({
            run: vi.fn(cmd => {
                if (cmd && cmd.includes('git branch')) return 'feature-x';
                return '';
            })
        });
        const snap = buildSnapshot(tmp.root, mockLog, 'test');
        expect(snap).toContain('feature-x');
    });

    it('buildSnapshot_containsTimestampField', () => {
        const mockLog = makeMockLog();
        const snap = buildSnapshot(tmp.root, mockLog, 'test');
        expect(snap).toContain('**Timestamp:**');
    });

    it('buildSnapshot_containsInProgressSection', () => {
        const mockLog = makeMockLog({
            findInProgressTodos: vi.fn(() => '- [>] some task in progress')
        });
        const snap = buildSnapshot(tmp.root, mockLog, 'test');
        expect(snap).toContain('some task in progress');
    });

    it('buildSnapshot_readsHandoffWhenPresent', () => {
        const mockLog = makeMockLog();
        // Create a handoff file
        tmp.write('docs/__handoff.md', `# Handoff

## Decisions & Context
Decision A was made for reason B.

## Next Actions
- Do thing X
`);
        const snap = buildSnapshot(tmp.root, mockLog, 'test');
        expect(snap).toContain('Decision A');
    });
});

// ---------------------------------------------------------------------------
// processEvent — snapshot file written
// ---------------------------------------------------------------------------

describe('processEvent_snapshotFile', () => {
    it('processEvent_writesSnapshotToSessionsDir', () => {
        const mockLog = makeMockLog();
        injectDailyLogMock(mockLog);

        processEvent({ trigger: 'test' });

        const sessionsDir = path.join(tmp.root, 'docs', '.output', 'sessions');
        expect(fs.existsSync(sessionsDir)).toBe(true);
        const dateDirs = fs.readdirSync(sessionsDir);
        expect(dateDirs.length).toBeGreaterThan(0);
    });

    it('processEvent_snapshotFilenameContainsPreCompaction', () => {
        const mockLog = makeMockLog();
        injectDailyLogMock(mockLog);

        processEvent({ trigger: 'test' });

        const sessionsDir = path.join(tmp.root, 'docs', '.output', 'sessions');
        const dateDirs = fs.readdirSync(sessionsDir);
        const snapshotFiles = dateDirs.flatMap(d =>
            fs.readdirSync(path.join(sessionsDir, d))
        );
        expect(snapshotFiles.some(f => f.includes('pre-compaction'))).toBe(true);
    });

    it('processEvent_snapshotContentContainsTrigger', () => {
        const mockLog = makeMockLog();
        injectDailyLogMock(mockLog);

        processEvent({ trigger: 'auto-compact' });

        const sessionsDir = path.join(tmp.root, 'docs', '.output', 'sessions');
        const dateDirs = fs.readdirSync(sessionsDir);
        const dateDir = path.join(sessionsDir, dateDirs[0]);
        const files = fs.readdirSync(dateDir);
        const content = fs.readFileSync(path.join(dateDir, files[0]), 'utf8');
        expect(content).toContain('auto-compact');
    });

    it('processEvent_ignoresCwdFieldOnPayload_usesProjectRootOnly', () => {
        // REGRESSION: earlier versions of the hook used `parsedJson.cwd` or
        // `process.cwd()` to resolve the output root, which meant a prior
        // `cd src && ...` in the same shell would dump the snapshot into
        // `src/docs/.output/sessions/` and the daily log into
        // `src/docs/.output/memories/daily/`. The hook must now ignore cwd
        // entirely and resolve exclusively from CLAUDE_PROJECT_DIR / __dirname.
        const mockLog = makeMockLog();
        injectDailyLogMock(mockLog);

        const bogusCwd = path.join(tmp.root, 'subdir-that-should-not-be-used');
        fs.mkdirSync(bogusCwd, { recursive: true });

        processEvent({ trigger: 'test', cwd: bogusCwd });

        // Snapshot lands under CLAUDE_PROJECT_DIR (tmp.root), not bogusCwd
        const sessionsDir = path.join(tmp.root, 'docs', '.output', 'sessions');
        expect(fs.existsSync(sessionsDir)).toBe(true);

        const bogusSessionsDir = path.join(bogusCwd, 'docs', '.output', 'sessions');
        expect(fs.existsSync(bogusSessionsDir)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// processEvent — DailyLog.capture called
// ---------------------------------------------------------------------------

describe('processEvent_dailyLogCapture', () => {
    it('processEvent_callsDailyLogCapture', () => {
        const mockLog = makeMockLog();
        injectDailyLogMock(mockLog);

        processEvent({ trigger: 'test' });

        expect(mockLog.capture).toHaveBeenCalled();
        const [captureArg] = mockLog.capture.mock.calls[0];
        expect(captureArg).toBe('Pre-Compaction');
    });
});

// ---------------------------------------------------------------------------
// processEvent — extraction regression guard
//
// Extraction moved to the session-handoff skill 2026-04-20. This hook must
// never spawn the extractor again, regardless of env vars or profile.
// ---------------------------------------------------------------------------

describe('processEvent_noExtractorSpawn', () => {
    it('processEvent_profileStandard_neverSpawns', () => {
        process.env.MEMORY_PROFILE = 'standard';
        const mockLog = makeMockLog();
        injectDailyLogMock(mockLog);
        processEvent({ trigger: 'test' });
        expect(spawnMock).not.toHaveBeenCalled();
    });

    it('processEvent_profileStrict_neverSpawns', () => {
        process.env.MEMORY_PROFILE = 'strict';
        tmp.write('.claude/core/memory-extractor.js', '// stub\n');
        const mockLog = makeMockLog();
        injectDailyLogMock(mockLog);
        processEvent({ trigger: 'test' });
        // Even under strict profile, the compaction hook does not spawn the extractor.
        expect(spawnMock).not.toHaveBeenCalled();
    });
});
