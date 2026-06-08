#!/usr/bin/env node
// .claude/core/commit.js — robust commit helper for Claude (and humans).
//
// WHY: Inlining a multiline commit message via `git commit -m "..."` is fragile —
// quoting/here-string syntax differs between bash and PowerShell, and em-dashes,
// backticks, or `@` tokens leak into the subject. File-based messages sidestep
// ALL shell escaping.
//
// WORKFLOW:
//   1. Write the commit message (subject line, blank line, body) to
//      docs/.output/.commit-msg using the Write tool — no shell escaping needed.
//      (Working-tree path, NOT under .git/ — so it resolves correctly inside git
//       worktrees, where .git is a file pointer rather than a directory.)
//      Do NOT add the Co-Authored-By trailer; this script appends it.
//   2. Run:
//        node .claude/core/commit.js            # commit staged changes
//        node .claude/core/commit.js --all      # stage everything, then commit
//        node .claude/core/commit.js --amend    # amend the last commit's message/content
//        node .claude/core/commit.js --dry-run  # print the final message, commit nothing
//
// GUARANTEES:
//   - Appends the Co-Authored-By trailer exactly once (idempotent).
//   - Trims trailing blank / stray-token lines (e.g. a leaked '@', quote, backtick).
//   - Commits on the CURRENT branch only — never switches or creates branches.
//   - Honors git hooks (never passes --no-verify).
//
// TRAILER: model-agnostic by default so it never goes stale as the model fleet
// moves. Override per-project/session via the CLAUDE_COMMIT_TRAILER env var, e.g.
//   CLAUDE_COMMIT_TRAILER='Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>'

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const TRAILER =
  process.env.CLAUDE_COMMIT_TRAILER || 'Co-Authored-By: Claude <noreply@anthropic.com>';

const args = process.argv.slice(2);
const has = (...flags) => flags.some((f) => args.includes(f));
const stageAll = has('--all', '-a');
const amend = has('--amend');
const dryRun = has('--dry-run', '-n');

const fileIdx = args.indexOf('--file');
const msgFile = fileIdx >= 0 ? args[fileIdx + 1] : path.join('docs', '.output', '.commit-msg');

function git(...a) {
  return execFileSync('git', a, { encoding: 'utf8' });
}

if (!fs.existsSync(msgFile)) {
  console.error(`[commit] message file not found: ${msgFile}`);
  console.error('[commit] Write your subject + body there first (Write tool), then re-run.');
  process.exit(1);
}

// Read, normalize line endings, and trim trailing junk lines.
let lines = fs.readFileSync(msgFile, 'utf8').replace(/\r\n/g, '\n').split('\n');
while (lines.length && /^[\s@'"`]*$/.test(lines[lines.length - 1])) lines.pop();

if (!lines.join('\n').trim()) {
  console.error('[commit] message is empty after trimming. Aborting.');
  process.exit(1);
}

// Ensure exactly one Co-Authored-By trailer.
const body = lines.join('\n').replace(/\s+$/, '');
const finalMsg = body.includes(TRAILER) ? `${body}\n` : `${body}\n\n${TRAILER}\n`;
fs.writeFileSync(msgFile, finalMsg, 'utf8');

if (dryRun) {
  console.log('[commit] --dry-run — final message below, nothing committed:\n');
  console.log('────────────────────────────────────────');
  process.stdout.write(finalMsg);
  console.log('────────────────────────────────────────');
  console.log(`[commit] would run: git ${stageAll ? 'add -A && ' : ''}commit -F ${msgFile}${amend ? ' --amend' : ''}`);
  process.exit(0);
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
console.log(`[commit] branch: ${branch}`);

if (stageAll) {
  git('add', '-A');
  console.log('[commit] staged all changes (git add -A)');
}

// --- Secret-scan gate (the pre-commit hook, living in our own flow) ---
// A plain .git/hooks/pre-commit was retired (fossil-prone across the fleet), and
// the PreToolUse:Write/Edit scanner only sees Claude's Write/Edit tool — NOT files
// that reach the index via Bash, scripts, or a human's terminal. commit.js IS the
// project's commit path, so the staged-content scan lives here: it runs
// secret-scanner.cjs over the staged set and aborts the commit on a finding.
// Bypass (rare — e.g. a deliberately-redacted example that still matches a
// pattern): --no-scan, or CLAUDE_COMMIT_NO_SCAN=1.
const noScan = has('--no-scan') || process.env.CLAUDE_COMMIT_NO_SCAN === '1';
if (!noScan) {
  const scanner = path.join(__dirname, '..', 'hooks', 'secret-scanner.cjs');
  if (fs.existsSync(scanner)) {
    const scan = spawnSync(process.execPath, [scanner, '--git-precommit'], { stdio: 'inherit' });
    if (scan.status !== 0) {
      console.error('[commit] secret scan blocked the commit. Remove the secret, or override with --no-scan / CLAUDE_COMMIT_NO_SCAN=1 (NOT recommended).');
      process.exit(scan.status || 1);
    }
  } else {
    console.warn(`[commit] WARNING: secret scanner not found at ${scanner} — committing WITHOUT a secret scan.`);
  }
}

const commitArgs = ['commit', '-F', msgFile];
if (amend) commitArgs.push('--amend');

// Use spawnSync with inherited stdio so hook output streams through live.
const res = spawnSync('git', commitArgs, { stdio: 'inherit' });
if (res.status !== 0) {
  console.error(`[commit] git commit failed (exit ${res.status}).`);
  process.exit(res.status || 1);
}

// Clean up the default message file after a successful commit so the next commit
// starts from a blank slate — and so the Write tool never has to read-before-write
// a stale leftover. Custom --file paths are deliberately left untouched.
if (fileIdx < 0) {
  try {
    fs.rmSync(msgFile);
  } catch {
    /* best-effort — a leftover msg file is harmless, it's overwritten next commit */
  }
}

console.log(`[commit] done: ${git('log', '-1', '--format=%h %s').trim()}`);
