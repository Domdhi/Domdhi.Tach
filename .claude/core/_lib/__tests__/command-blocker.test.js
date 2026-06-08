// AC→source map (P2.3 / command-blocker):
//   - buildHookResponse(decision, opts): returns {stdout, exitCode}
//     - decision='pass'    → exitCode=0, stdout=''
//     - decision='block'   → exitCode=2, stdout='' (message on stderr, handled by hook)
//     - decision='confirm' → exitCode=0, stdout=JSON with permissionDecision:"ask"
//
// These tests MUST FAIL before command-blocker.js is created, then pass after.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { buildHookResponse } = require('../command-blocker');

// ─── buildHookResponse ────────────────────────────────────────────────────────

describe('buildHookResponse', () => {
    describe('pass decision', () => {
        it('buildHookResponse_pass_exitCode0', () => {
            const result = buildHookResponse('pass');
            expect(result.exitCode).toBe(0);
        });

        it('buildHookResponse_pass_stdoutEmpty', () => {
            const result = buildHookResponse('pass');
            expect(result.stdout).toBe('');
        });

        it('buildHookResponse_pass_noOptions_stillReturnsCorrectShape', () => {
            const result = buildHookResponse('pass', {});
            expect(result).toHaveProperty('stdout');
            expect(result).toHaveProperty('exitCode');
        });
    });

    describe('block decision', () => {
        it('buildHookResponse_block_exitCode2', () => {
            const result = buildHookResponse('block', { command: 'rm -rf /', pattern: 'rm -rf /' });
            expect(result.exitCode).toBe(2);
        });

        it('buildHookResponse_block_stdoutEmpty', () => {
            // Block writes to stderr, not stdout
            const result = buildHookResponse('block', { command: 'rm -rf /', pattern: 'rm -rf /' });
            expect(result.stdout).toBe('');
        });

        it('buildHookResponse_block_stderrContainsBLOCKED', () => {
            // The hook uses result.stderr to write to process.stderr
            const result = buildHookResponse('block', { command: 'rm -rf /', pattern: 'rm -rf /' });
            expect(result.stderr).toEqual(expect.stringContaining('BLOCKED'));
        });
    });

    describe('confirm decision', () => {
        it('buildHookResponse_confirm_exitCode0', () => {
            const result = buildHookResponse('confirm', {
                command: 'git push --force',
                pattern: 'git push --force',
                reason: 'Guardrail: "git push --force" — git push --force origin',
            });
            expect(result.exitCode).toBe(0);
        });

        it('buildHookResponse_confirm_stdoutIsValidJSON', () => {
            const result = buildHookResponse('confirm', {
                command: 'git push --force',
                pattern: 'git push --force',
                reason: 'Guardrail: "git push --force" — git push --force',
            });
            expect(() => JSON.parse(result.stdout)).not.toThrow();
        });

        it('buildHookResponse_confirm_stdoutContainsPermissionDecisionAsk', () => {
            const result = buildHookResponse('confirm', {
                command: 'git push --force',
                pattern: 'git push --force',
                reason: 'Guardrail: test',
            });
            const parsed = JSON.parse(result.stdout);
            expect(parsed.hookSpecificOutput.permissionDecision).toBe('ask');
        });

        it('buildHookResponse_confirm_reasonPreservedInOutput', () => {
            const reason = 'Guardrail: "git push --force" — git push --force origin';
            const result = buildHookResponse('confirm', {
                command: 'git push --force',
                pattern: 'git push --force',
                reason,
            });
            const parsed = JSON.parse(result.stdout);
            expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe(reason);
        });
    });

    describe('unknown decision', () => {
        it('buildHookResponse_unknownDecision_treatedAsPass', () => {
            // Unknown decisions default to pass (safe degradation)
            const result = buildHookResponse('unknown_xyz');
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toBe('');
        });
    });
});
