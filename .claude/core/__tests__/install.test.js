// install.js — brownfield installer tests.
//
// All tests are fully headless: no TTY interaction, no real .claude/ copy.
// Each test builds a synthetic source .claude/ in a tmp dir so we exercise
// the logic without copying the real (multi-MB) template tree.
//
// Style mirrors memory-backend-detect.test.js and adopter-ship.test.js:
//   - ESM import for vitest, createRequire for CJS module under test.
//   - createTmpDir helper for isolated tmp trees.
//   - beforeEach / afterEach for setup + cleanup.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { runInstall, resolveConflict, DO_NOT_SHIP, parseArgs } = require('../install');
const { createTmpDir } = require('./_helpers/tmp-dir');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal synthetic source tree in a tmp dir.
 * Returns the source root (which contains a .claude/ subdirectory).
 *
 * @param {ReturnType<typeof createTmpDir>} tmp
 * @param {string[]} [files] — relative paths inside .claude/ to create
 * @returns {string} absolute path to the synthetic source root
 */
function buildSource(tmp, files) {
  files = files || [
    'commands/do.md',
    'core/install.js',
    'agents/general-purpose.md',
    'skills/full-output-enforcement/SKILL.md',
  ];
  for (const f of files) {
    tmp.write(path.join('source', '.claude', f), `# ${f}\ncontent`);
  }
  return path.join(tmp.root, 'source');
}

/**
 * Build a minimal synthetic target dir (an empty project).
 *
 * @param {ReturnType<typeof createTmpDir>} tmp
 * @param {string} [name] — subdirectory name inside tmp (default 'target')
 * @returns {string} absolute path to the synthetic target root
 */
function buildTarget(tmp, name) {
  name = name || 'target';
  const t = path.join(tmp.root, name);
  fs.mkdirSync(t, { recursive: true });
  return t;
}

let tmp;

beforeEach(() => {
  tmp = createTmpDir({ prefix: 'install-test-' });
});

afterEach(() => {
  tmp.cleanup();
});

// ── parseArgs ─────────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('defaults to target "." with all flags false', () => {
    const opts = parseArgs([]);
    expect(opts.target).toBe('.');
    expect(opts.dryRun).toBe(false);
    expect(opts.overwriteAll).toBe(false);
    expect(opts.keepAll).toBe(false);
    expect(opts.force).toBe(false);
    expect(opts.noDeps).toBe(false);
  });

  it('picks up positional as target', () => {
    const opts = parseArgs(['/some/path']);
    expect(opts.target).toBe('/some/path');
  });

  it('sets dryRun on --dry-run', () => {
    const opts = parseArgs(['--dry-run']);
    expect(opts.dryRun).toBe(true);
  });

  it('sets overwriteAll on --overwrite-all', () => {
    const opts = parseArgs(['--overwrite-all']);
    expect(opts.overwriteAll).toBe(true);
    expect(opts.force).toBe(false);
  });

  it('sets force AND overwriteAll on --force', () => {
    const opts = parseArgs(['--force']);
    expect(opts.force).toBe(true);
    expect(opts.overwriteAll).toBe(true);
  });

  it('sets keepAll on --keep', () => {
    const opts = parseArgs(['--keep']);
    expect(opts.keepAll).toBe(true);
  });

  it('sets noDeps on --no-deps', () => {
    const opts = parseArgs(['--no-deps']);
    expect(opts.noDeps).toBe(true);
  });

  it('handles mixed positional + flags', () => {
    const opts = parseArgs(['/target', '--dry-run', '--force']);
    expect(opts.target).toBe('/target');
    expect(opts.dryRun).toBe(true);
    expect(opts.force).toBe(true);
    expect(opts.overwriteAll).toBe(true);
  });
});

// ── resolveConflict ───────────────────────────────────────────────────────────

describe('resolveConflict', () => {
  it('returns "overwrite" when overwriteAll is true', () => {
    expect(resolveConflict('core/test.js', { overwriteAll: true })).toBe('overwrite');
  });

  it('returns "overwrite" when force is true', () => {
    expect(resolveConflict('core/test.js', { force: true })).toBe('overwrite');
  });

  it('returns "keep" when keepAll is true', () => {
    expect(resolveConflict('core/test.js', { keepAll: true })).toBe('keep');
  });

  it('force takes precedence over keepAll', () => {
    expect(resolveConflict('core/test.js', { force: true, keepAll: true })).toBe('overwrite');
  });

  it('returns "keep" in headless mode (no TTY, no flags)', () => {
    expect(resolveConflict('core/test.js', { interactive: false })).toBe('keep');
  });

  it('calls choiceFn when interactive, returns keep when fn returns keep', () => {
    const choiceFn = () => 'keep';
    expect(resolveConflict('core/test.js', { interactive: true, choiceFn })).toBe('keep');
  });

  it('calls choiceFn when interactive, returns overwrite when fn returns overwrite', () => {
    const choiceFn = () => 'overwrite';
    expect(resolveConflict('core/test.js', { interactive: true, choiceFn })).toBe('overwrite');
  });

  it('re-calls choiceFn once when it returns "diff", uses second result', () => {
    let calls = 0;
    const choiceFn = () => {
      calls++;
      return calls === 1 ? 'diff' : 'overwrite';
    };
    expect(resolveConflict('core/test.js', { interactive: true, choiceFn })).toBe('overwrite');
    expect(calls).toBe(2);
  });
});

// ── DO_NOT_SHIP ───────────────────────────────────────────────────────────────

describe('DO_NOT_SHIP', () => {
  it('is an array of strings', () => {
    expect(Array.isArray(DO_NOT_SHIP)).toBe(true);
    expect(DO_NOT_SHIP.every(s => typeof s === 'string')).toBe(true);
  });

  it('includes agent-memory/**', () => {
    expect(DO_NOT_SHIP).toContain('agent-memory/**');
  });

  it('includes settings.local.json', () => {
    expect(DO_NOT_SHIP).toContain('settings.local.json');
  });

  it('includes push-guardrail.json', () => {
    expect(DO_NOT_SHIP).toContain('push-guardrail.json');
  });
});

// ── runInstall: basic copy ─────────────────────────────────────────────────────

describe('runInstall — basic copy into empty target', () => {
  it('copies .claude/ files into an empty target; returns created count', () => {
    const source = buildSource(tmp, [
      'commands/do.md',
      'core/install.js',
    ]);
    const target = buildTarget(tmp);

    const stats = runInstall({ source, target, dryRun: false, interactive: false });

    expect(stats.created).toBeGreaterThan(0);
    expect(stats.skipped).toBe(0);
    expect(stats.merged).toBe(0);
    expect(stats.conflicts).toHaveLength(0);
    expect(stats.dryRun).toBe(false);

    // Files should exist in target
    expect(fs.existsSync(path.join(target, '.claude', 'commands', 'do.md'))).toBe(true);
    expect(fs.existsSync(path.join(target, '.claude', 'core', 'install.js'))).toBe(true);
  });

  it('leaves a sentinel file OUTSIDE .claude/ in the target untouched', () => {
    const source = buildSource(tmp, ['core/install.js']);
    const target = buildTarget(tmp);

    // Place a sentinel file in target root
    fs.writeFileSync(path.join(target, 'sentinel.txt'), 'do not touch', 'utf8');

    runInstall({ source, target, dryRun: false, interactive: false });

    expect(fs.readFileSync(path.join(target, 'sentinel.txt'), 'utf8')).toBe('do not touch');
  });

  it('creates CLAUDE.md stub when target has no CLAUDE.md', () => {
    const source = buildSource(tmp, ['core/install.js']);
    const target = buildTarget(tmp);

    runInstall({ source, target, dryRun: false, interactive: false });

    const claudeMd = path.join(target, 'CLAUDE.md');
    expect(fs.existsSync(claudeMd)).toBe(true);
    expect(fs.readFileSync(claudeMd, 'utf8')).toContain('/onboard');
  });
});

// ── runInstall: existing CLAUDE.md preserved ─────────────────────────────────

describe('runInstall — existing CLAUDE.md preserved', () => {
  it('does NOT overwrite an existing CLAUDE.md in the target', () => {
    const source = buildSource(tmp, ['core/install.js']);
    const target = buildTarget(tmp);

    const originalContent = '# My Custom CLAUDE.md\nproject-specific content\n';
    fs.writeFileSync(path.join(target, 'CLAUDE.md'), originalContent, 'utf8');

    runInstall({ source, target, dryRun: false, interactive: false });

    expect(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8')).toBe(originalContent);
  });
});

// ── runInstall: conflict handling ─────────────────────────────────────────────

describe('runInstall — conflict + headless keep-existing', () => {
  it('keeps existing content and writes MERGE-NOTES.md when conflict occurs headlessly', () => {
    const source = buildSource(tmp, ['core/install.js']);
    const target = buildTarget(tmp);

    // Pre-populate the target with a conflicting file
    const existingContent = 'existing content — do not overwrite';
    fs.mkdirSync(path.join(target, '.claude', 'core'), { recursive: true });
    fs.writeFileSync(path.join(target, '.claude', 'core', 'install.js'), existingContent, 'utf8');

    const stats = runInstall({ source, target, dryRun: false, interactive: false });

    // Conflict was kept
    expect(stats.skipped).toBeGreaterThan(0);
    expect(stats.conflicts).toContain('core/install.js');

    // Original content preserved
    expect(fs.readFileSync(path.join(target, '.claude', 'core', 'install.js'), 'utf8'))
      .toBe(existingContent);

    // MERGE-NOTES.md written
    const notesPath = path.join(target, '.claude', 'MERGE-NOTES.md');
    expect(fs.existsSync(notesPath)).toBe(true);
    const notes = fs.readFileSync(notesPath, 'utf8');
    expect(notes).toContain('core/install.js');
  });
});

describe('runInstall — conflict + overwriteAll', () => {
  it('overwrites conflicting files when overwriteAll is true', () => {
    const newContent = '# new install.js content';
    const source = buildSource(tmp, ['core/install.js']);
    // Overwrite the source file content for a distinct assertion
    fs.writeFileSync(
      path.join(tmp.root, 'source', '.claude', 'core', 'install.js'),
      newContent, 'utf8'
    );

    const target = buildTarget(tmp);
    fs.mkdirSync(path.join(target, '.claude', 'core'), { recursive: true });
    fs.writeFileSync(path.join(target, '.claude', 'core', 'install.js'), 'OLD', 'utf8');

    const stats = runInstall({ source, target, dryRun: false, overwriteAll: true, interactive: false });

    expect(stats.merged).toBeGreaterThan(0);
    expect(stats.conflicts).toHaveLength(0);
    expect(fs.readFileSync(path.join(target, '.claude', 'core', 'install.js'), 'utf8'))
      .toBe(newContent);
  });
});

describe('runInstall — conflict + force', () => {
  it('overwrites conflicting files when force is true', () => {
    const source = buildSource(tmp, ['core/install.js']);
    const target = buildTarget(tmp);

    fs.mkdirSync(path.join(target, '.claude', 'core'), { recursive: true });
    fs.writeFileSync(path.join(target, '.claude', 'core', 'install.js'), 'OLD', 'utf8');

    const stats = runInstall({ source, target, dryRun: false, force: true, interactive: false });

    expect(stats.merged).toBeGreaterThan(0);
  });
});

describe('runInstall — conflict + keepAll', () => {
  it('keeps all conflicting files when keepAll is true', () => {
    const source = buildSource(tmp, ['core/install.js']);
    const target = buildTarget(tmp);

    fs.mkdirSync(path.join(target, '.claude', 'core'), { recursive: true });
    fs.writeFileSync(path.join(target, '.claude', 'core', 'install.js'), 'KEEP THIS', 'utf8');

    const stats = runInstall({ source, target, dryRun: false, keepAll: true, interactive: false });

    expect(stats.skipped).toBeGreaterThan(0);
    expect(stats.conflicts).toContain('core/install.js');
    expect(fs.readFileSync(path.join(target, '.claude', 'core', 'install.js'), 'utf8'))
      .toBe('KEEP THIS');
  });
});

// ── runInstall: resolveConflict with injected choiceFn ───────────────────────

describe('runInstall — interactive choiceFn', () => {
  it('calls choiceFn for conflict and honors keep result', () => {
    const source = buildSource(tmp, ['core/install.js']);
    const target = buildTarget(tmp);

    fs.mkdirSync(path.join(target, '.claude', 'core'), { recursive: true });
    fs.writeFileSync(path.join(target, '.claude', 'core', 'install.js'), 'MY VERSION', 'utf8');

    const calls = [];
    const choiceFn = (relPath) => { calls.push(relPath); return 'keep'; };

    const stats = runInstall({
      source, target, dryRun: false,
      interactive: true, choiceFn,
    });

    expect(calls).toContain('core/install.js');
    expect(stats.skipped).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(target, '.claude', 'core', 'install.js'), 'utf8'))
      .toBe('MY VERSION');
  });

  it('calls choiceFn for conflict and honors overwrite result', () => {
    const newContent = '# install.js from source';
    const source = buildSource(tmp, ['core/install.js']);
    fs.writeFileSync(
      path.join(tmp.root, 'source', '.claude', 'core', 'install.js'),
      newContent, 'utf8'
    );

    const target = buildTarget(tmp);
    fs.mkdirSync(path.join(target, '.claude', 'core'), { recursive: true });
    fs.writeFileSync(path.join(target, '.claude', 'core', 'install.js'), 'OLD', 'utf8');

    const choiceFn = () => 'overwrite';
    const stats = runInstall({
      source, target, dryRun: false,
      interactive: true, choiceFn,
    });

    expect(stats.merged).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(target, '.claude', 'core', 'install.js'), 'utf8'))
      .toBe(newContent);
  });
});

// ── runInstall: do-not-ship excludes ─────────────────────────────────────────

describe('runInstall — do-not-ship excludes', () => {
  it('does NOT copy agent-memory/** files', () => {
    const source = buildSource(tmp, [
      'core/install.js',
      'agent-memory/general-purpose/foo.json',
    ]);
    const target = buildTarget(tmp);

    runInstall({ source, target, dryRun: false, interactive: false });

    expect(fs.existsSync(path.join(target, '.claude', 'agent-memory'))).toBe(false);
  });

  it('does NOT copy settings.local.json', () => {
    const source = buildSource(tmp, [
      'core/install.js',
      'settings.local.json',
    ]);
    const target = buildTarget(tmp);

    runInstall({ source, target, dryRun: false, interactive: false });

    expect(fs.existsSync(path.join(target, '.claude', 'settings.local.json'))).toBe(false);
  });

  it('does NOT copy push-guardrail.json', () => {
    const source = buildSource(tmp, [
      'core/install.js',
      'push-guardrail.json',
    ]);
    const target = buildTarget(tmp);

    runInstall({ source, target, dryRun: false, interactive: false });

    expect(fs.existsSync(path.join(target, '.claude', 'push-guardrail.json'))).toBe(false);
  });

  it('does NOT copy skills-optional/** files', () => {
    const source = buildSource(tmp, [
      'core/install.js',
      'skills-optional/react-patterns/SKILL.md',
    ]);
    const target = buildTarget(tmp);

    runInstall({ source, target, dryRun: false, interactive: false });

    expect(fs.existsSync(path.join(target, '.claude', 'skills-optional'))).toBe(false);
  });

  it('does NOT copy agents-optional/** files', () => {
    const source = buildSource(tmp, [
      'core/install.js',
      'agents-optional/custom-agent.md',
    ]);
    const target = buildTarget(tmp);

    runInstall({ source, target, dryRun: false, interactive: false });

    expect(fs.existsSync(path.join(target, '.claude', 'agents-optional'))).toBe(false);
  });

  it('DOES copy regular files that are not excluded (sanity check)', () => {
    const source = buildSource(tmp, [
      'core/install.js',
      'agents/general-purpose.md',
    ]);
    const target = buildTarget(tmp);

    runInstall({ source, target, dryRun: false, interactive: false });

    expect(fs.existsSync(path.join(target, '.claude', 'core', 'install.js'))).toBe(true);
    expect(fs.existsSync(path.join(target, '.claude', 'agents', 'general-purpose.md'))).toBe(true);
  });
});

// ── runInstall: dry-run ───────────────────────────────────────────────────────

describe('runInstall — dry-run', () => {
  it('writes NOTHING to the target .claude/ when dryRun is true', () => {
    const source = buildSource(tmp, [
      'core/install.js',
      'agents/general-purpose.md',
    ]);
    const target = buildTarget(tmp);

    const stats = runInstall({ source, target, dryRun: true, interactive: false });

    expect(stats.dryRun).toBe(true);
    // Target .claude/ must not exist at all
    expect(fs.existsSync(path.join(target, '.claude'))).toBe(false);
    // Stats should still report what WOULD have been created
    expect(stats.created).toBeGreaterThan(0);
  });

  it('dry-run does NOT write MERGE-NOTES.md when conflicts occur', () => {
    const source = buildSource(tmp, ['core/install.js']);
    const target = buildTarget(tmp);

    // Pre-populate a conflict
    fs.mkdirSync(path.join(target, '.claude', 'core'), { recursive: true });
    fs.writeFileSync(path.join(target, '.claude', 'core', 'install.js'), 'OLD', 'utf8');

    const stats = runInstall({ source, target, dryRun: true, interactive: false });

    expect(stats.dryRun).toBe(true);
    expect(fs.existsSync(path.join(target, '.claude', 'MERGE-NOTES.md'))).toBe(false);
  });
});

// ── runInstall: existing .claude/ → recommendedReSync ────────────────────────

describe('runInstall — existing .claude/ merge-mode recommendation', () => {
  it('sets recommendedReSync on stats when target already has .claude/', () => {
    const source = buildSource(tmp, ['core/install.js']);
    const target = buildTarget(tmp);

    // Simulate an existing .claude/ install
    fs.mkdirSync(path.join(target, '.claude'), { recursive: true });

    const stats = runInstall({ source, target, dryRun: false, interactive: false });

    expect(stats.recommendedReSync).toBe(true);
  });

  it('does NOT set recommendedReSync when target has no .claude/', () => {
    const source = buildSource(tmp, ['core/install.js']);
    const target = buildTarget(tmp);

    const stats = runInstall({ source, target, dryRun: false, interactive: false });

    expect(stats.recommendedReSync).toBeFalsy();
  });
});

// ── runInstall: error cases ───────────────────────────────────────────────────

describe('runInstall — preflight errors', () => {
  it('returns early with ok=false + error when target does not exist (no process.exitCode side effect)', () => {
    const source = buildSource(tmp, ['core/install.js']);
    const before = process.exitCode;

    const stats = runInstall({
      source,
      target: path.join(tmp.root, 'does-not-exist'),
      dryRun: false,
      interactive: false,
    });

    expect(stats.created).toBe(0);
    expect(stats.ok).toBe(false);
    expect(typeof stats.error).toBe('string');
    // runInstall must NOT mutate global process.exitCode — that's main()'s job.
    expect(process.exitCode).toBe(before);
  });
});

// ── runInstall: --force must NOT clobber the adopter's docs/root via scaffold ────
//
// Regression guard for the CRITICAL found in review: install's --force means
// "overwrite conflicting .claude/ files", NOT "overwrite the adopter's docs/ and
// repo-root files". scaffold.js's own `force` means the latter. runInstall must
// always call scaffold with force:false regardless of install --force, else
// `install --force` silently replaces the adopter's root .gitignore.
describe('runInstall — --force does not propagate into scaffold', () => {
  it('invokes the target scaffold with force:false even when install --force is set', () => {
    // Synthetic source whose .claude/core/scaffold.js is a STUB that records the
    // `force` value it receives. install copies it into the target, then requires
    // and runs it — so the recorded value is exactly what runInstall passed.
    const source = buildSource(tmp, ['core/install.js']);
    const stub =
      "module.exports = { runScaffold: (target, opts) => {\n" +
      "  require('fs').writeFileSync(require('path').join(target, 'scaffold-force.txt'), String(opts && opts.force));\n" +
      "} };\n";
    tmp.write(path.join('source', '.claude', 'core', 'scaffold.js'), stub);

    const target = buildTarget(tmp);
    const stats = runInstall({ source, target, dryRun: false, interactive: false, force: true });

    const recorded = fs.readFileSync(path.join(target, 'scaffold-force.txt'), 'utf8');
    expect(recorded).toBe('false');     // NOT 'true' — the fix
    expect(stats.ok).toBe(true);
  });
});
