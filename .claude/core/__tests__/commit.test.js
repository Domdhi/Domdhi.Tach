// Tests for commit.js — the file-based commit helper.
//
// Strategy: exercise the message-sanitization + trailer logic via `--dry-run
// --file <path>`, which reads the message file, rewrites it with the trailer,
// prints the result, and exits WITHOUT invoking git. No git repo needed.
//
// Coverage:
//   - appends the Co-Authored-By trailer exactly once
//   - idempotent when the trailer is already present
//   - honors CLAUDE_COMMIT_TRAILER override (and model-agnostic default)
//   - trims trailing junk lines (stray @, quote, backtick, blanks)
//   - exits non-zero on an empty message or a missing file

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createTmpDir } = require('./_helpers/tmp-dir');
const { createGitRepo, gitAvailable } = require('./_helpers/git-fixture');

const COMMIT_JS = path.resolve(__dirname, '../commit.js');

/** Run commit.js --dry-run against a message file. Returns {status, stdout}. */
function runDryRun(msgFile, env = {}) {
  try {
    const stdout = execFileSync(
      'node',
      [COMMIT_JS, '--dry-run', '--file', msgFile],
      { encoding: 'utf8', env: { ...process.env, ...env } },
    );
    return { status: 0, stdout };
  } catch (e) {
    return { status: e.status ?? 1, stdout: (e.stdout || '') + (e.stderr || '') };
  }
}

describe('commit.js trailer handling', () => {
  let tmp;
  beforeEach(() => { tmp = createTmpDir({ prefix: 'commit-test-' }); });
  afterEach(() => tmp.cleanup());

  it('appends the model-agnostic trailer by default, exactly once', () => {
    const f = tmp.write('MSG', 'feat: thing\n\nbody\n');
    const { status, stdout } = runDryRun(f);
    expect(status).toBe(0);
    const matches = stdout.match(/Co-Authored-By: Claude <noreply@anthropic\.com>/g) || [];
    expect(matches).toHaveLength(1);
  });

  it('is idempotent when the trailer already exists', () => {
    const f = tmp.write('MSG', 'feat: thing\n\nbody\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n');
    const { stdout } = runDryRun(f);
    const matches = stdout.match(/Co-Authored-By: Claude <noreply@anthropic\.com>/g) || [];
    expect(matches).toHaveLength(1);
  });

  it('honors CLAUDE_COMMIT_TRAILER override', () => {
    const f = tmp.write('MSG', 'feat: thing\n');
    const { stdout } = runDryRun(f, {
      CLAUDE_COMMIT_TRAILER: 'Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>',
    });
    expect(stdout).toContain('Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>');
  });

  it('trims trailing stray-token / blank lines before the trailer', () => {
    const f = tmp.write('MSG', 'feat: thing\n\nbody\n@\n`\n\n');
    const { stdout } = runDryRun(f);
    // The stray @ / backtick lines must not survive into the message.
    const between = stdout.split('feat: thing')[1] || '';
    expect(between).not.toMatch(/^@$/m);
    expect(between).not.toMatch(/^`$/m);
  });
});

describe('commit.js error handling', () => {
  let tmp;
  beforeEach(() => { tmp = createTmpDir({ prefix: 'commit-test-' }); });
  afterEach(() => tmp.cleanup());

  it('exits non-zero on an empty message', () => {
    const f = tmp.write('MSG', '\n\n  \n');
    const { status } = runDryRun(f);
    expect(status).not.toBe(0);
  });

  it('exits non-zero when the message file is missing', () => {
    const { status } = runDryRun(path.join(tmp.root, 'does-not-exist'));
    expect(status).not.toBe(0);
  });
});

// ─── Secret-scan gate (the pre-commit hook living inside commit.js) ──────────────
// commit.js runs secret-scanner.cjs --git-precommit over the staged set before
// committing. These exercise the FULL (non-dry-run) path against a real tmp repo,
// using the real scanner (resolved relative to commit.js's __dirname). A CG- key
// also verifies the new CoinGecko pattern end-to-end through the commit flow.

/** Run commit.js (full path) in repoPath with an explicit --file. {status, stdout}. */
function runCommit(repoPath, msgFile, extraArgs = [], env = {}) {
  try {
    const stdout = execFileSync('node', [COMMIT_JS, '--file', msgFile, ...extraArgs], {
      cwd: repoPath,
      env: { ...process.env, CLAUDE_PROJECT_DIR: repoPath, ...env },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { status: 0, stdout };
  } catch (e) {
    return { status: e.status ?? 1, stdout: (e.stdout || '') + (e.stderr || '') };
  }
}

function commitCount(repoPath) {
  try {
    return Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: repoPath, encoding: 'utf8',
    }).trim());
  } catch { return 0; }
}

describe('commit.js secret-scan gate', () => {
  let tmp;
  beforeEach(() => { tmp = createTmpDir({ prefix: 'commit-scan-' }); });
  afterEach(() => tmp.cleanup());

  // Build CG- + 22 chars without writing a matchable literal in THIS source file.
  const cgKey = 'CG-' + 'abcDEF123456ghiJKL789mn';

  it.skipIf(!gitAvailable())('blocks a commit when a staged file contains a secret', () => {
    const repo = createGitRepo({ root: tmp.root });
    fs.writeFileSync(path.join(repo.repoPath, 'README.md'), '# init\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repo.repoPath, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init', '--no-verify'], { cwd: repo.repoPath, stdio: 'pipe' });
    const before = commitCount(repo.repoPath);

    fs.writeFileSync(path.join(repo.repoPath, 'config.js'), `const k = "${cgKey}";\n`);
    execFileSync('git', ['add', 'config.js'], { cwd: repo.repoPath, stdio: 'pipe' });
    const msg = path.join(tmp.root, 'MSG');
    fs.writeFileSync(msg, 'feat: add config\n');

    const { status } = runCommit(repo.repoPath, msg);
    expect(status).not.toBe(0);                       // blocked
    expect(commitCount(repo.repoPath)).toBe(before);  // no new commit
  });

  it.skipIf(!gitAvailable())('--no-scan bypasses the gate and commits', () => {
    const repo = createGitRepo({ root: tmp.root });
    fs.writeFileSync(path.join(repo.repoPath, 'README.md'), '# init\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repo.repoPath, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init', '--no-verify'], { cwd: repo.repoPath, stdio: 'pipe' });
    const before = commitCount(repo.repoPath);

    fs.writeFileSync(path.join(repo.repoPath, 'config.js'), `const k = "${cgKey}";\n`);
    execFileSync('git', ['add', 'config.js'], { cwd: repo.repoPath, stdio: 'pipe' });
    const msg = path.join(tmp.root, 'MSG');
    fs.writeFileSync(msg, 'feat: add config\n');

    const { status } = runCommit(repo.repoPath, msg, ['--no-scan']);
    expect(status).toBe(0);
    expect(commitCount(repo.repoPath)).toBe(before + 1);
  });

  it.skipIf(!gitAvailable())('allows a commit when staged content is clean', () => {
    const repo = createGitRepo({ root: tmp.root });
    fs.writeFileSync(path.join(repo.repoPath, 'README.md'), '# init\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repo.repoPath, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init', '--no-verify'], { cwd: repo.repoPath, stdio: 'pipe' });
    const before = commitCount(repo.repoPath);

    fs.writeFileSync(path.join(repo.repoPath, 'app.js'), 'const x = 1;\nconsole.log(x);\n');
    execFileSync('git', ['add', 'app.js'], { cwd: repo.repoPath, stdio: 'pipe' });
    const msg = path.join(tmp.root, 'MSG');
    fs.writeFileSync(msg, 'feat: add app\n');

    const { status } = runCommit(repo.repoPath, msg);
    expect(status).toBe(0);
    expect(commitCount(repo.repoPath)).toBe(before + 1);
  });
});
