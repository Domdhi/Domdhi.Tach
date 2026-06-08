import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);

const fs = require('node:fs');
const path = require('node:path');

// CJS bridge — loads the scanner after module.exports is added
const scanner = require('../secret-scanner.cjs');
const { processEvent, scanFile } = scanner;

const { createTmpDir } = require('../../core/__tests__/_helpers/tmp-dir');
const { createGitRepo, gitAvailable } = require('../../core/__tests__/_helpers/git-fixture');

// ─── Fake secret builders (runtime concatenation avoids pre-commit hook) ──────

function fakeAwsKey() {
    return 'AKIA' + 'IOSFODNN7' + 'EXAMPLE123456';
}

function fakeOpenAiKey() {
    return 'sk-' + 'abcdefghijklmnopqrstuvwxy' + 'z01234567890ABCDEFGHIJK';
}

function fakeGitHubPAT() {
    return 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789AB';
}

// ─── processEvent ─────────────────────────────────────────────────────────────

describe('processEvent', () => {
    it('processEvent_isExported', () => {
        expect(typeof processEvent).toBe('function');
    });

    describe('processEvent_writeEvent', () => {
        it('processEvent_writeWithSecret_returnsBlockResponse', () => {
            const event = {
                tool_name: 'Write',
                tool_input: {
                    file_path: '/project/config.js',
                    content: `const key = "${fakeAwsKey()}";`,
                },
            };
            const result = processEvent(event);
            expect(result).not.toBeNull();
            expect(result.block).toBe(true);
            expect(typeof result.feedback).toBe('string');
            expect(result.feedback).toContain('AWS Access Key');
            expect(result.exitCode).toBe(1);
        });

        it('processEvent_writeWithCleanContent_returnsNull', () => {
            const event = {
                tool_name: 'Write',
                tool_input: {
                    file_path: '/project/hello.js',
                    content: 'console.log("hello world");\n',
                },
            };
            const result = processEvent(event);
            expect(result).toBeNull();
        });

        it('processEvent_writeWithNoContent_returnsNull', () => {
            const event = {
                tool_name: 'Write',
                tool_input: {
                    file_path: '/project/empty.js',
                    // no content or new_string
                },
            };
            const result = processEvent(event);
            expect(result).toBeNull();
        });
    });

    describe('processEvent_editEvent', () => {
        it('processEvent_editWithSecret_returnsBlockResponse', () => {
            const event = {
                tool_name: 'Edit',
                tool_input: {
                    file_path: '/project/settings.js',
                    new_string: `const token = "${fakeGitHubPAT()}";`,
                },
            };
            const result = processEvent(event);
            expect(result).not.toBeNull();
            expect(result.block).toBe(true);
            expect(result.feedback).toContain('GitHub Token');
        });

        it('processEvent_editWithCleanNewString_returnsNull', () => {
            const event = {
                tool_name: 'Edit',
                tool_input: {
                    file_path: '/project/settings.js',
                    new_string: 'const x = 42;',
                },
            };
            const result = processEvent(event);
            expect(result).toBeNull();
        });
    });

    describe('processEvent_unrelatedEvent', () => {
        it('processEvent_bashEvent_returnsNull', () => {
            const event = {
                tool_name: 'Bash',
                tool_input: {
                    command: 'echo hello',
                },
            };
            const result = processEvent(event);
            expect(result).toBeNull();
        });

        it('processEvent_readEvent_returnsNull', () => {
            const event = {
                tool_name: 'Read',
                tool_input: {
                    file_path: '/project/config.js',
                },
            };
            const result = processEvent(event);
            expect(result).toBeNull();
        });
    });

    describe('processEvent_skippedPath', () => {
        it('processEvent_writeToNodeModules_returnsNull', () => {
            const event = {
                tool_name: 'Write',
                tool_input: {
                    file_path: '/project/node_modules/lib/index.js',
                    content: `const key = "${fakeAwsKey()}";`,
                },
            };
            const result = processEvent(event);
            expect(result).toBeNull();
        });

        it('processEvent_writeToGitDirectory_returnsNull', () => {
            const event = {
                tool_name: 'Write',
                tool_input: {
                    file_path: '/project/.git/config',
                    content: `const key = "${fakeAwsKey()}";`,
                },
            };
            const result = processEvent(event);
            expect(result).toBeNull();
        });
    });
});

// ─── scanFile ─────────────────────────────────────────────────────────────────

describe('scanFile', () => {
    it('scanFile_isExported', () => {
        expect(typeof scanFile).toBe('function');
    });

    it('scanFile_missingFile_returnsErrorObject', () => {
        const result = scanFile('/nonexistent/path/that/does/not/exist.js');
        expect(result).toMatchObject({ error: 'File not found', findings: null, skipped: false });
    });

    it('scanFile_skippedPath_returnsSkippedTrue', () => {
        // node_modules path — shouldSkipPath returns true
        const result = scanFile('/any/node_modules/pkg/index.js');
        expect(result).toMatchObject({ findings: null, skipped: true });
    });

    it('scanFile_cleanFile_returnsFindingsEmpty', () => {
        const tmp = createTmpDir();
        const filePath = tmp.write('clean.js', 'const x = 1;\nconsole.log(x);\n');
        const result = scanFile(filePath);
        tmp.cleanup();
        expect(result.skipped).toBe(false);
        expect(result.findings).toEqual([]);
    });

    it('scanFile_fileWithSecret_returnsFindingsArray', () => {
        const tmp = createTmpDir();
        const content = `const key = "${fakeAwsKey()}";\n`;
        const filePath = tmp.write('secrets.js', content);
        const result = scanFile(filePath);
        tmp.cleanup();
        expect(result.skipped).toBe(false);
        expect(Array.isArray(result.findings)).toBe(true);
        expect(result.findings.length).toBeGreaterThan(0);
        const names = result.findings.map(f => f.name);
        expect(names).toContain('AWS Access Key');
    });

    it('scanFile_fileWithSecret_noProcessExit', () => {
        // scanFile must not call process.exit — it returns data instead
        // We verify by checking the return value (if process.exit were called,
        // the test process would die and this assertion would never run)
        const tmp = createTmpDir();
        const content = `const token = "${fakeOpenAiKey()}";\n`;
        const filePath = tmp.write('key.js', content);
        const result = scanFile(filePath);
        tmp.cleanup();
        expect(result).toBeDefined();
        expect(result.findings).not.toBeNull();
    });
});

// ─── Subprocess test: --git-precommit mode ────────────────────────────────────

describe('precommit', () => {
    it.skipIf(!gitAvailable())('precommit_stagedSecret_blocksCommit', () => {
        const tmp = createTmpDir();
        const repo = createGitRepo({ root: tmp.root });

        // Initial commit so HEAD exists
        repo.addCommit({ message: 'setup', files: [{ path: 'README.md', content: 'initial' }] });

        // Write a file with a fake AWS key and stage it
        const fakeKey = 'AKIA' + 'FAKETESTKEY1234567';   // 18 uppercase chars — regex matches first 16
        const fileContent = `export const key = "${fakeKey}";\n`;
        const leakedPath = path.join(repo.repoPath, 'leaked.js');
        fs.writeFileSync(leakedPath, fileContent);
        execFileSync('git', ['add', 'leaked.js'], { cwd: repo.repoPath, stdio: 'pipe' });

        // Run scanner subprocess in --git-precommit mode.
        // CLAUDE_PROJECT_DIR is threaded through the spawn env so the scanner's
        // getProjectRoot() resolves to THIS fixture repo, not the real repo root.
        // Without it the scanner would call `git diff --cached` in the real repo
        // (where nothing is staged with AWS keys) and return exit 0.
        const scannerPath = path.resolve(
            new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
            '..', '..', 'secret-scanner.cjs'
        );
        let exitCode = 0;
        let stderr = '';
        try {
            execFileSync('node', [scannerPath, '--git-precommit'], {
                cwd: repo.repoPath,
                env: { ...process.env, CLAUDE_PROJECT_DIR: repo.repoPath },
                stdio: 'pipe',
            });
        } catch (err) {
            exitCode = err.status;
            stderr = err.stderr?.toString() || '';
        }

        tmp.cleanup();

        expect(exitCode).not.toBe(0);
        expect(stderr).toMatch(/AWS Access Key/);
    });

    it.skipIf(!gitAvailable())('precommit_cleanStaged_exits0', () => {
        const tmp = createTmpDir();
        const repo = createGitRepo({ root: tmp.root });

        repo.addCommit({ message: 'setup', files: [{ path: 'README.md', content: 'initial' }] });

        const cleanPath = path.join(repo.repoPath, 'clean.js');
        fs.writeFileSync(cleanPath, 'const x = 1;\n');
        execFileSync('git', ['add', 'clean.js'], { cwd: repo.repoPath, stdio: 'pipe' });

        const scannerPath = path.resolve(
            new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
            '..', '..', 'secret-scanner.cjs'
        );
        let exitCode = 0;
        try {
            execFileSync('node', [scannerPath, '--git-precommit'], {
                cwd: repo.repoPath,
                env: { ...process.env, CLAUDE_PROJECT_DIR: repo.repoPath },
                stdio: 'pipe',
            });
        } catch (err) {
            exitCode = err.status;
        }

        tmp.cleanup();
        expect(exitCode).toBe(0);
    });
});
