---
name: end
description: Save session context for continuing work in a new conversation
argument-hint: [optional notes]
---

# End Session

Write this session's handoff — a per-session, branch-tagged file under `docs/.output/handoffs/` that `/prime` reads next session. The path is resolved by `node .claude/core/handoff-path.js write end` (see the `session-handoff` skill); per-session files are how parallel branches avoid conflicting on a single shared handoff in PRs.

This command is the **end-of-session** invocation of the handoff writer. `/do`, `/run-todo`, `/run-tests`, and `/todo` also produce handoffs as part of their own pipelines, so running `/end` after one of those is optional — but it's harmless and gives you a dedicated save point.

## Telemetry (run first)

This command is user-typed, so it does not fire `PostToolUse:Skill` — without this it leaves no `command_invocation` row and fleet analytics under-count human-driven runs. Self-log the invocation before anything else (best-effort — if it fails, continue regardless):

```bash
node .claude/core/telemetry-log.js end
```

## Shared writer

The handoff path resolver, template, fill rules, and command-specific tailoring all live in the **`session-handoff` skill** (`.claude/skills/session-handoff/SKILL.md`). Read it before writing. That skill is the single source of truth for where the handoff lives and what goes in it; this command is the orchestrator.

## Steps

### 1. Organize loose files

```bash
node .claude/hooks/organize.cjs
```

### 2. Gather live state (per the skill, Step 1 + 2)

```bash
git status --short
git log --oneline -10
ls docs/.output/plans/**/*.md 2>/dev/null
```

Check unfinished plans (grep for `- [ ]` in each plan file).

**Authorship reconciliation (session-handoff Step 1):** the log may contain commits you did NOT author — the user, or a parallel agent on another branch. `git show --stat <hash>` any commit you don't recognize (those without a `Co-Authored-By: Claude` trailer are almost always human/external) and capture its intent in Decisions & Context. Don't write the handoff from conversation memory alone, or you'll silently drop real session work.

### 3. Write the handoff

Resolve this run's handoff path once and reuse it:

```bash
HANDOFF=$(node .claude/core/handoff-path.js write end)
```

Follow the `session-handoff` skill template. Tailor for the `/end` case (Step 4 in the skill): general session close, covering everything that happened this session.

**Write `$HANDOFF` completely.** Never append, and never reach back to edit a prior run's handoff.

### 4. Commit the handoff (and prune old ones for this branch)

Prune this branch's older handoffs to the newest 3 (keeping `$HANDOFF`), so the directory doesn't sprawl. `git rm` only files that are tracked; ignore the rest:

```bash
BR=$(node .claude/core/handoff-path.js branch)
# newest-first, skip the 3 newest, git rm the rest (POSIX: tail -n +4 is portable).
# git rm only — older handoffs are always committed by the time we prune, so a
# bare `rm -f` is unnecessary (and trips the destructive-rm guardrail).
ls -1t docs/.output/handoffs/*-"$BR".md 2>/dev/null | tail -n +4 | while read -r f; do git rm -q "$f" 2>/dev/null || true; done
```

Write the commit message to `docs/.output/.commit-msg` (Write tool — no shell escaping):

```
docs: /end — {brief summary of session focus}
```

Then run:

```bash
git add "$HANDOFF"
node .claude/core/commit.js
```

### 5. Leave a clean tree (session cleanup)

**Goal: the next session must NOT open on uncommitted old work.** After the handoff commit, sweep up anything this session left behind — but *reviewed*, never a blind `git add .`.

```bash
git status --short
```

If the tree is already clean → skip to Step 6.

If anything remains, **review the list before staging** (this is the safety step the Post-Command Commit Convention's "stage specific files" rule protects):

1. **Read what's there.** For each remaining file, confirm it's genuine session output, not a secret, half-finished WIP you shouldn't freeze, or an unrelated change that wandered in.
2. **Stage the safe session zones only** — tracked modifications plus new files under `docs/` and `.claude/` (this session's artifacts, system edits, and reports):
   ```bash
   git add -u                       # tracked modifications + deletions
   git add docs/ .claude/           # new artifacts in the safe zones (gitignore already excludes memories/telemetry/sessions)
   ```
3. **Do NOT auto-stage anything outside those zones** — new files in the repo root, `src/`, `tools/`, or anywhere unexpected. List them in the Report under "Left uncommitted (review these)" so the user decides deliberately. Same for anything that looked like a secret or unfinished WIP in step 1.
4. Commit the swept files (skip if step 2 staged nothing):
   ```
   chore: /end — session cleanup ({N} stray files)
   ```
   Write the message to `docs/.output/.commit-msg`, then `node .claude/core/commit.js`.
5. Re-run `git status --short` to confirm. The tree is now clean, or the only remainder is the explicitly-surfaced out-of-zone files.

### 6. Show the user

Output the handoff content for review, and end with the **tree state**: either `Tree: clean ✓` or an explicit list of the out-of-zone files left uncommitted (with why each was held back).

## Rules

All rules live in the `session-handoff` skill — read them there. A few reminders specific to `/end`:

- **Commit, don't push.** `/end` commits the handoff *and* sweeps up any other session work into a cleanup commit (Step 5) so the next session opens on a clean tree — but it does NOT auto-push. The user decides when to push. The cleanup is *reviewed*, never a blind `git add .`: only the `docs/` and `.claude/` safe zones are auto-staged; anything outside them is surfaced for a deliberate decision, not committed.
- **Memory acquisition happens via the session-handoff skill's Step 6** (Main Agent writes 0–3 structured memories from handoff bullets that qualify as reusable learnings). The skill has the full procedure; the load-bearing rules are: **(a) check the inbox first** — `node .claude/core/memory-manager.js inbox-list`, then `inbox-promote`/`inbox-discard` each sub-agent draft; **(b) only promote bullets that generalize** — a pattern, constraint, workflow, or rejected-approach useful on a *future* session or a new project, never pure project state or 24-hour gotchas; **(c) score `importance` 1–5** (default 3) on each write — it's the decay retention floor, so be honest. Zero qualifying bullets is the common, correct outcome — don't manufacture memories to fill a quota. No auto-extraction fires from `/end` or any other command. The Stop hook still captures raw daily logs and runs the curator under `MEMORY_PROFILE=strict`. See `docs/.output/reviews/2026-04-20-adr-memory-unification.md`.
- **Supersession confirm:** Before committing the handoff (Step 4), review any write-time `supersedes_candidates` flags that were attached to memories created this session. For each flagged pair, decide: if the new memory genuinely replaces the old one, confirm by running `node .claude/core/memory-manager.js supersede <category> <oldId> <newId>`; otherwise skip it. This is always flag-then-confirm — nothing supersedes automatically. If no memories were created this session, skip this step.
