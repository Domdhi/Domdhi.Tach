// Regression test for the circular-require ordering bug introduced by the
// memory-manager CLI split (Task #11). When memory-manager.js is invoked as the
// entry point, it delegates to memory-manager-cli.js, which re-requires
// memory-manager.js — at that moment the exports must already be populated,
// or the CLI sees `{}` and fails with "MemoryManager is not a constructor".
//
// Caught 2026-04-24 during session attempting to create a workflow memory via
// the CLI. Unit tests didn't cover the CLI entry path, so the bug hid.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const managerScript = path.join(projectRoot, '.claude', 'core', 'memory-manager.js');

function runCli(args) {
    const result = spawnSync('node', [managerScript, ...args], {
        cwd: projectRoot,
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 10_000,
    });
    return {
        status: result.status,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
    };
}

describe('memory-manager CLI entry point', () => {
    it('does not fail with "not a constructor" on invocation', () => {
        const { status, stderr } = runCli(['lint']);
        expect(stderr).not.toContain('not a constructor');
        expect(stderr).not.toContain('Cannot read');
        expect(status).toBe(0);
    });

    it('prints usage when invoked with no command', () => {
        const { status, stdout } = runCli([]);
        expect(stdout).toContain('Usage:');
        expect(status).toBe(0);
    });

    it('returns lint output as valid JSON', () => {
        const { status, stdout } = runCli(['lint']);
        expect(status).toBe(0);
        expect(() => JSON.parse(stdout)).not.toThrow();
        const parsed = JSON.parse(stdout);
        expect(parsed).toHaveProperty('total_memories');
    });
});
