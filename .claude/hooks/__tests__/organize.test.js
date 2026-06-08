// AC→source map (TDD-5.5 / organize):
//   - toSlug: lowercases, strips special chars, collapses dashes, trims leading/trailing
//   - dateFolder: returns YYYY-MM-DD from a Date
//   - timePrefix: returns HHMM from a Date
//   - uniquePath: full path sig; file exists → appends -2, -3, etc.
//   - processEvent: ExitPlanMode — moves loose plan files to dated folder structure
//
// Note: organize.cjs previously used a module-level const results = []. After refactor,
//   results is local to processEvent and passed to organizePlans/organizeScreenshots.
//   CLAUDE_PROJECT_DIR must be set before calling processEvent (read at call time via
//   a local read inside processEvent, not a module-level constant).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const fs = require('node:fs');
const path = require('node:path');

const { processEvent, toSlug, dateFolder, timePrefix, uniquePath } = require('../organize.cjs');

const { createTmpDir } = require('../../core/__tests__/_helpers/tmp-dir');

// ─── toSlug ──────────────────────────────────────────────────────────────────

describe('organize', () => {
    describe('toSlug', () => {
        it('toSlug_lowercasesInput', () => {
            expect(toSlug('Hello World')).toBe('hello-world');
        });

        it('toSlug_specialChars_stripped', () => {
            expect(toSlug('My Plan Title!')).toBe('my-plan-title');
            expect(toSlug('Foo / Bar & Baz')).toBe('foo-bar-baz');
            expect(toSlug('   Leading and trailing   ')).toBe('leading-and-trailing');
        });

        it('toSlug_collapsesDashes', () => {
            expect(toSlug('foo---bar')).toBe('foo-bar');
        });

        it('toSlug_onlySpecialChars_returnsEmpty', () => {
            // All non-alnum non-space chars stripped → nothing left → empty string
            const result = toSlug('!@#$%^&*()');
            expect(result).toBe('');
        });
    });

    // ─── dateFolder ──────────────────────────────────────────────────────────────

    describe('dateFolder', () => {
        it('dateFolder_formatYYYYMMDD', () => {
            expect(dateFolder(new Date('2026-04-19T10:30:00'))).toBe('2026-04-19');
        });

        it('dateFolder_singleDigitMonthAndDay_padded', () => {
            // Month 1 (January) and day 5 → zero-padded
            expect(dateFolder(new Date('2026-01-05T00:00:00'))).toBe('2026-01-05');
        });
    });

    // ─── timePrefix ──────────────────────────────────────────────────────────────

    describe('timePrefix', () => {
        it('timePrefix_formatHHMM', () => {
            expect(timePrefix(new Date('2026-04-19T10:30:00'))).toBe('1030');
        });

        it('timePrefix_midnight_returns0000', () => {
            expect(timePrefix(new Date('2026-04-19T00:00:00'))).toBe('0000');
        });

        it('timePrefix_singleDigitHourAndMinute_padded', () => {
            // 9:05 → '0905'
            expect(timePrefix(new Date('2026-04-19T09:05:00'))).toBe('0905');
        });
    });

    // ─── uniquePath ───────────────────────────────────────────────────────────────

    describe('uniquePath', () => {
        let tmp;

        beforeEach(() => {
            tmp = createTmpDir();
        });

        afterEach(() => {
            tmp.cleanup();
        });

        it('uniquePath_noConflict_returnsSamePath', () => {
            const target = path.join(tmp.root, 'foo.md');
            // File does not exist — must return path unchanged
            expect(uniquePath(target)).toBe(target);
        });

        it('uniquePath_existing_appendsDash2', () => {
            tmp.write('foo.md', 'a');
            const result = uniquePath(path.join(tmp.root, 'foo.md'));
            expect(result).toBe(path.join(tmp.root, 'foo-2.md'));
        });

        it('uniquePath_multipleCollisions_increments', () => {
            tmp.write('foo.md', 'a');
            tmp.write('foo-2.md', 'b');
            const result = uniquePath(path.join(tmp.root, 'foo.md'));
            expect(result).toBe(path.join(tmp.root, 'foo-3.md'));
        });

        it('uniquePath_noExtension_appendsDash2', () => {
            tmp.write('mydir', 'x');
            const result = uniquePath(path.join(tmp.root, 'mydir'));
            expect(result).toBe(path.join(tmp.root, 'mydir-2'));
        });
    });

    // ─── processEvent ─────────────────────────────────────────────────────────────

    describe('processEvent', () => {
        let tmp;
        let originalDir;

        beforeEach(() => {
            tmp = createTmpDir();
            originalDir = process.env.CLAUDE_PROJECT_DIR;
        });

        afterEach(() => {
            if (originalDir === undefined) {
                delete process.env.CLAUDE_PROJECT_DIR;
            } else {
                process.env.CLAUDE_PROJECT_DIR = originalDir;
            }
            tmp.cleanup();
        });

        it('processEvent_noPlansOrScreenshots_returnsNull', () => {
            process.env.CLAUDE_PROJECT_DIR = tmp.root;
            // No files to organize — should return null
            const result = processEvent({});
            expect(result).toBeNull();
        });

        it('processEvent_planFile_movesToDatedFolder', () => {
            process.env.CLAUDE_PROJECT_DIR = tmp.root;
            tmp.write('docs/.output/plans/my-plan.md', '# Plan: something\n\n## Summary\nTest plan content.');

            const result = processEvent({});

            // Original file must be gone
            expect(fs.existsSync(path.join(tmp.root, 'docs/.output/plans/my-plan.md'))).toBe(false);

            // A dated subdirectory must exist inside plans/
            const plansDir = path.join(tmp.root, 'docs', '.output', 'plans');
            const entries = fs.readdirSync(plansDir);
            const datedDir = entries.find(f => /^\d{4}-\d{2}-\d{2}$/.test(f));
            expect(datedDir).toBeTruthy();

            // That dated dir should contain at least one file
            const movedFiles = fs.readdirSync(path.join(plansDir, datedDir));
            expect(movedFiles.length).toBeGreaterThan(0);

            // processEvent must return a feedback object
            expect(result).not.toBeNull();
            expect(typeof result.feedback).toBe('string');
            expect(result.feedback).toMatch(/Organized/);
        });

        it('processEvent_alreadyOrganizedPlan_notMoved', () => {
            process.env.CLAUDE_PROJECT_DIR = tmp.root;
            // File already in dated folder — name starts with YYYY-MM-DD prefix, should be skipped
            tmp.write('docs/.output/plans/2026-04-19/1030-plan.md', '# Plan: old\n\n## Summary\nAlready organized.');

            const result = processEvent({});

            // Should remain null since there is nothing unorganized to move
            expect(result).toBeNull();
        });

        it('processEvent_isRecallable_resultsResetPerCall', () => {
            process.env.CLAUDE_PROJECT_DIR = tmp.root;
            tmp.write('docs/.output/plans/plan-a.md', '# Plan: a\n\n## Summary\nFirst call.');

            const result1 = processEvent({});
            expect(result1).not.toBeNull();

            // After first call there are no more unorganized files
            const result2 = processEvent({});
            expect(result2).toBeNull();
        });
    });
});
