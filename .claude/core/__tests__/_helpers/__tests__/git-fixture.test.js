import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Up two directory levels: __tests__/_helpers/__tests__ -> __tests__/_helpers
const { createGitRepo, gitAvailable } = require('../git-fixture');
const { createTmpDir } = require('../tmp-dir');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

describe('git-fixture', () => {
  let tmp;

  beforeEach(() => {
    tmp = createTmpDir();
  });

  afterEach(() => {
    tmp?.cleanup();
  });

  // ---------------------------------------------------------------------------
  // gitAvailable smoke check (runs unconditionally — useful CI diagnostic)
  // ---------------------------------------------------------------------------

  it('gitAvailable_normalShell_returnsBoolean', () => {
    // Arrange / Act
    const result = gitAvailable();

    // Assert — just confirm the return type; the actual value depends on the env
    expect(typeof result).toBe('boolean');
  });

  it('gitAvailable_normalShell_returnsTrue', () => {
    // Arrange (git is expected to be available in this dev environment)
    // Act
    const result = gitAvailable();

    // Assert
    // If this test fails it means git is not on PATH — all skipIf tests will also skip
    expect(result).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // createGitRepo error handling (no git required)
  // ---------------------------------------------------------------------------

  it('createGitRepo_noRoot_throws', () => {
    // Arrange / Act / Assert
    expect(() => createGitRepo({})).toThrow('[git-fixture] createGitRepo requires { root }');
  });

  it('createGitRepo_noArgs_throws', () => {
    // Arrange / Act / Assert
    expect(() => createGitRepo()).toThrow('[git-fixture] createGitRepo requires { root }');
  });

  // ---------------------------------------------------------------------------
  // Core creation (requires git)
  // ---------------------------------------------------------------------------

  it.skipIf(!gitAvailable())('createGitRepo_valid_returnsHandleWithRepoPath', () => {
    // Arrange
    const repoRoot = path.join(tmp.root, 'repo-a');

    // Act
    const repo = createGitRepo({ root: repoRoot });

    // Assert
    expect(repo).not.toBeNull();
    expect(repo.repoPath).toBe(repoRoot);
  });

  it.skipIf(!gitAvailable())('createGitRepo_initialState_hasOneCommitOnMain', () => {
    // Arrange
    const repoRoot = path.join(tmp.root, 'repo-b');

    // Act
    const repo = createGitRepo({ root: repoRoot });
    const log = execSync('git log --oneline', { cwd: repo.repoPath })
      .toString()
      .trim();
    const branch = execSync('git branch --show-current', { cwd: repo.repoPath })
      .toString()
      .trim();

    // Assert — exactly one line ("initial" commit), on `main`
    expect(log.split('\n')).toHaveLength(1);
    expect(log).toContain('initial');
    expect(branch).toBe('main');
  });

  // ---------------------------------------------------------------------------
  // addCommit (requires git)
  // ---------------------------------------------------------------------------

  it.skipIf(!gitAvailable())('addCommit_withFiles_appearsInGitLog', () => {
    // Arrange
    const repoRoot = path.join(tmp.root, 'repo-c');
    const repo = createGitRepo({ root: repoRoot });

    // Act
    repo.addCommit({
      message: 'add-hello',
      files: [{ path: 'hello.txt', content: 'world' }],
    });
    const log = execSync('git log --oneline', { cwd: repo.repoPath })
      .toString()
      .trim();

    // Assert
    expect(log).toContain('add-hello');
  });

  it.skipIf(!gitAvailable())('addCommit_multipleCommits_allAppearInLog', () => {
    // Arrange
    const repoRoot = path.join(tmp.root, 'repo-d');
    const repo = createGitRepo({ root: repoRoot });

    // Act
    repo.addCommit({ message: 'commit-one' });
    repo.addCommit({ message: 'commit-two' });
    repo.addCommit({ message: 'commit-three' });
    const log = execSync('git log --oneline', { cwd: repo.repoPath })
      .toString()
      .trim()
      .split('\n');

    // Assert — 3 new commits + 1 "initial" = 4 lines
    expect(log).toHaveLength(4);
    const messages = log.map((l) => l.replace(/^[0-9a-f]+ /, ''));
    expect(messages).toContain('commit-one');
    expect(messages).toContain('commit-two');
    expect(messages).toContain('commit-three');
  });

  // ---------------------------------------------------------------------------
  // addCommitOnDate (requires git)
  // ---------------------------------------------------------------------------

  it.skipIf(!gitAvailable())('addCommitOnDate_specificDate_setsAuthorDate', () => {
    // Arrange
    const repoRoot = path.join(tmp.root, 'repo-e');
    const repo = createGitRepo({ root: repoRoot });
    const isoDate = '2024-06-15T12:00:00';
    const expectedShort = '2024-06-15';

    // Act
    repo.addCommitOnDate('dated-commit', isoDate);
    const authorDate = execSync(
      'git log -n 1 --format=%ad --date=short',
      { cwd: repo.repoPath }
    )
      .toString()
      .trim();

    // Assert
    expect(authorDate).toBe(expectedShort);
  });

  it.skipIf(!gitAvailable())('addCommitOnDate_differentDates_eachCommitHasCorrectDate', () => {
    // Arrange
    const repoRoot = path.join(tmp.root, 'repo-f');
    const repo = createGitRepo({ root: repoRoot });

    // Act
    repo.addCommitOnDate('day-one', '2024-01-10T09:00:00');
    repo.addCommitOnDate('day-two', '2024-03-20T14:30:00');

    // git log is newest-first; first entry is day-two, second is day-one
    const dates = execSync(
      'git log --format=%ad --date=short',
      { cwd: repo.repoPath }
    )
      .toString()
      .trim()
      .split('\n');

    // Assert — dates[0] = day-two, dates[1] = day-one, dates[2] = initial
    expect(dates[0]).toBe('2024-03-20');
    expect(dates[1]).toBe('2024-01-10');
  });

  // ---------------------------------------------------------------------------
  // Initial commits seed via factory (requires git)
  // ---------------------------------------------------------------------------

  it.skipIf(!gitAvailable())('createGitRepo_withInitialCommits_seedsRepo', () => {
    // Arrange / Act
    const repoRoot = path.join(tmp.root, 'repo-g');
    const repo = createGitRepo({
      root: repoRoot,
      commits: [
        { message: 'seed-1', files: [{ path: 'seed.txt', content: 'seeded' }] },
        { message: 'seed-2' },
      ],
    });
    const log = execSync('git log --oneline', { cwd: repo.repoPath })
      .toString()
      .trim();

    // Assert
    expect(log).toContain('seed-1');
    expect(log).toContain('seed-2');
    // initial commit also present
    expect(log.split('\n')).toHaveLength(3);
  });

  // ---------------------------------------------------------------------------
  // Cleanup via tmp.cleanup() (no git required — just needs a dir on disk)
  // ---------------------------------------------------------------------------

  it('cleanup_viaTmpDir_removesRepoFromDisk', () => {
    // Arrange — create repo only if git is available, else create plain dir
    const repoRoot = path.join(tmp.root, 'repo-h');
    if (gitAvailable()) {
      createGitRepo({ root: repoRoot });
    } else {
      fs.mkdirSync(repoRoot, { recursive: true });
    }
    expect(fs.existsSync(repoRoot)).toBe(true);

    // Act — tmp.cleanup() removes the entire tmp tree (including repoRoot)
    tmp.cleanup();
    // Null out so afterEach doesn't try to call cleanup() again
    tmp = null;

    // Assert
    expect(fs.existsSync(repoRoot)).toBe(false);
  });
});
