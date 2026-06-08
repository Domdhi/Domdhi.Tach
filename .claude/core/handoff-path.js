#!/usr/bin/env node

/**
 * handoff-path.js — resolve the path of the session handoff file.
 *
 * WHY THIS EXISTS
 * ---------------
 * The session handoff used to be a single fixed path (`docs/__handoff.md`) that
 * every session OVERWROTE. With multiple agents working in parallel branches,
 * that one path is rewritten by every `/end`, `/do`, `/run-todo` wave,
 * `/run-tests`, and `/todo` — so it conflicts on every PR merge.
 *
 * The fix: handoffs are per-session, stamped, and branch-tagged, living under
 * `docs/.output/handoffs/{stamp}-{caller}-{branch}.md`. Every run writes a
 * uniquely-named file, so parallel branches never touch the same path → zero
 * merge conflicts. The files are TRACKED (the .output gitignore block excludes
 * memories/telemetry/sessions, NOT handoffs/), so they stay portable across
 * machines — `git pull` brings your handoffs with you.
 *
 * Eight call sites need the SAME stamp/branch/resolution logic (6 writer
 * commands + /prime + pre-compaction-archive.cjs). This is that single source.
 *
 * USAGE (CLI)
 *   node .claude/core/handoff-path.js write <caller>
 *       Ensure the handoffs/ dir exists and print the path THIS run should
 *       write. Capture it ONCE per command run and reuse the same string for
 *       both the Write and the `git add` (per the Run-Stamp Convention — one
 *       stamp per run, so /run-todo's waves overwrite one file, not N).
 *
 *   node .claude/core/handoff-path.js latest
 *       Print the newest handoff for the CURRENT branch (falls back to the
 *       newest across all branches if this branch has none — e.g. a freshly
 *       cut branch inherits the last main handoff). Empty output = none found.
 *       Used by /prime (cold-start read) and the pre-compaction hook.
 *
 *   node .claude/core/handoff-path.js branch
 *       Print the slugified current branch (debugging / scripting).
 *
 * Exit codes: 0 ok, 2 bad usage. Resolution never throws on a missing dir —
 * it prints empty and exits 0 (the caller falls back to scanning the backlog).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const HANDOFF_DIR = 'docs/.output/handoffs';
const CALLERS = ['end', 'do', 'run-todo', 'run-tests', 'todo'];
// Longest alternatives first so `run-todo`/`run-tests` match before `do`/`todo`.
const FILE_RE = /^(\d{6}-\d{4})-(run-todo|run-tests|end|do|todo)-(.+)\.md$/;

/** Slugify a branch name into a filename-safe, lowercase token. */
function slugBranch(raw) {
    return String(raw || '')
        .trim()
        .replace(/[^A-Za-z0-9._-]+/g, '-') // path-separators & spaces → dash
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'nobranch';
}

/** Current git branch, slugified. Detached HEAD → 'head'. */
function currentBranchSlug(cwd = process.cwd()) {
    try {
        const raw = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        return slugBranch(raw);
    } catch {
        return 'nobranch';
    }
}

/** YYMMDD-HHMM run stamp (matches the universal Run-Stamp Convention). */
function stamp(date = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    const yy = p(date.getFullYear() % 100);
    return `${yy}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}

/** Build the path this run should write. */
function buildWritePath(caller, { cwd = process.cwd(), runStamp, branch } = {}) {
    if (!CALLERS.includes(caller)) {
        throw new Error(`unknown caller "${caller}" — expected one of: ${CALLERS.join(', ')}`);
    }
    const s = runStamp || stamp();
    const b = branch || currentBranchSlug(cwd);
    return `${HANDOFF_DIR}/${s}-${caller}-${b}.md`;
}

/** Ensure docs/.output/handoffs/ exists. */
function ensureDir(cwd = process.cwd()) {
    fs.mkdirSync(path.join(cwd, HANDOFF_DIR), { recursive: true });
}

/**
 * Newest handoff for `branch` (default: current). Falls back to the newest
 * across ALL branches when the branch has none. Returns a repo-relative path
 * string, or null if the dir is empty/absent.
 */
function resolveLatest({ cwd = process.cwd(), branch } = {}) {
    const dir = path.join(cwd, HANDOFF_DIR);
    let entries;
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return null; // dir absent → caller falls back to backlog scan
    }
    const parsed = entries
        .map((name) => {
            const m = FILE_RE.exec(name);
            return m ? { name, stampStr: m[1], caller: m[2], branch: m[3] } : null;
        })
        .filter(Boolean)
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)); // stamp-prefix => chronological

    if (parsed.length === 0) return null;

    const b = branch || currentBranchSlug(cwd);
    const mine = parsed.filter((e) => e.branch === b);
    const pick = (mine.length ? mine : parsed)[(mine.length ? mine : parsed).length - 1];
    return `${HANDOFF_DIR}/${pick.name}`;
}

module.exports = {
    HANDOFF_DIR,
    CALLERS,
    slugBranch,
    currentBranchSlug,
    stamp,
    buildWritePath,
    resolveLatest,
    ensureDir,
};

// ---- CLI ----
if (require.main === module) {
    const [cmd, arg] = process.argv.slice(2);
    try {
        if (cmd === 'write') {
            if (!CALLERS.includes(arg)) {
                process.stderr.write(`usage: handoff-path.js write <${CALLERS.join('|')}>\n`);
                process.exit(2);
            }
            ensureDir();
            process.stdout.write(buildWritePath(arg) + '\n');
        } else if (cmd === 'latest') {
            const p = resolveLatest();
            if (p) process.stdout.write(p + '\n');
            // empty output + exit 0 when none — caller falls back to backlog
        } else if (cmd === 'branch') {
            process.stdout.write(currentBranchSlug() + '\n');
        } else {
            process.stderr.write('usage: handoff-path.js <write <caller>|latest|branch>\n');
            process.exit(2);
        }
    } catch (err) {
        process.stderr.write(`handoff-path.js: ${err.message}\n`);
        process.exit(2);
    }
}
