/**
 * git-fixture — spins up isolated git repos on disk for tests that call execSync('git ...').
 * CommonJS (not ESM) — loaded via createRequire() bridge in test files.
 *
 * Usage:
 *   const { createGitRepo, gitAvailable } = require('./git-fixture');
 *   const repo = createGitRepo({ root: '/tmp/my-repo' });
 *   // repo.repoPath, repo.addCommit({ message, date, files }), repo.addCommitOnDate(message, isoDate)
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Returns true if `git` is on PATH.
 * @returns {boolean}
 */
function gitAvailable() {
  try {
    execSync('git --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates an isolated git repository at `root`.
 *
 * @param {{ root: string, commits?: Array<{ message: string, date?: string, files?: Array<{ path: string, content?: string }> }> }} options
 * @returns {{ repoPath: string, addCommit: Function, addCommitOnDate: Function } | null}
 *   Returns null (with a stderr note) if git is not on PATH.
 */
function createGitRepo({ root, commits = [] } = {}) {
  if (!gitAvailable()) {
    process.stderr.write('[git-fixture] git not on PATH — fixture returned null\n');
    return null;
  }
  if (!root) throw new Error('[git-fixture] createGitRepo requires { root }');

  const repoPath = root;
  fs.mkdirSync(repoPath, { recursive: true });

  /**
   * Run a git command inside the repo, optionally with extra env vars.
   * Always passes cwd as an option (not via shell cd) to stay cross-platform.
   */
  const run = (cmd, env = {}) =>
    execSync(cmd, {
      cwd: repoPath,
      stdio: 'pipe',
      env: { ...process.env, ...env },
    });

  run('git init -b main');
  run('git config user.name "Test"');
  run('git config user.email "test@example.com"');
  run('git config commit.gpgsign false');
  // Initial empty commit so HEAD exists on `main`
  run('git commit --allow-empty -m "initial"');

  /**
   * Add a commit to the repo, optionally writing files first.
   *
   * @param {{ message: string, date?: string, files?: Array<{ path: string, content?: string }> }} options
   */
  function addCommit({ message, date, files = [] }) {
    for (const f of files) {
      const full = path.join(repoPath, f.path);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, f.content ?? '');
      // Use JSON.stringify so paths with spaces are safely quoted
      run(`git add ${JSON.stringify(f.path)}`);
    }

    const env = date
      ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
      : {};

    const cmd =
      files.length > 0
        ? `git commit -m ${JSON.stringify(message)}`
        : `git commit --allow-empty -m ${JSON.stringify(message)}`;

    run(cmd, env);
  }

  /**
   * Add an empty commit with a forced author + committer date.
   * Dates must be ISO 8601 (e.g. '2024-06-15T12:00:00').
   * Critical for getActiveDaysSince and gen-timeline tests.
   *
   * @param {string} message
   * @param {string} isoDate   ISO 8601 datetime string
   */
  function addCommitOnDate(message, isoDate) {
    addCommit({ message, date: isoDate, files: [] });
  }

  // Seed repo with any initial commits provided at construction time
  for (const c of commits) {
    addCommit(c);
  }

  return { repoPath, addCommit, addCommitOnDate };
}

module.exports = { createGitRepo, gitAvailable };
