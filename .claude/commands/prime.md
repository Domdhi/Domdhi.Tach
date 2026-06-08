---
name: prime
description: Cold-start a session — read handoff, git log, and Key Files for immediate context
argument-hint: [context]
---

# Prime

Cold-start a new session. CLAUDE.md + agent memory already auto-load — this command fills in the gaps: what happened recently, what's next, and is anything broken.

## Telemetry (run first)

This command is user-typed, so it does not fire `PostToolUse:Skill` — without this it leaves no `command_invocation` row and fleet analytics under-count human-driven runs. Self-log the invocation before anything else (best-effort — if it fails, continue regardless):

```bash
node .claude/core/telemetry-log.js prime
```

## Variables

TASK_DESCRIPTION: CONTEXT

- `CONTEXT` (optional): File(s) or folder(s) to read instead of the default workflow. Use when you need to deep-dive a specific area.

## Workflow

- If `CONTEXT` is provided:
  - Read each file or folder specified
  - Summarize what you found
  - Done — skip the rest

- Else run the **cold-start sequence**:

### Step 1: Read the handoff + git reality (parallel)

Resolve the handoff path first — handoffs are per-session/per-branch files under `docs/.output/handoffs/`, and the resolver returns the newest one for the current branch (falling back to the newest overall):
```
HANDOFF=$(node .claude/core/handoff-path.js latest)
```
Then read it alongside git reality:
```
Read $HANDOFF        # the resolved handoff (skip if empty — none yet)
git log --oneline -20
git status --short
```
The handoff has decisions, intent, blockers, and next actions from the previous session. Git is the source of truth — do NOT trust the handoff over git. If `$HANDOFF` is empty (no handoff exists yet), scan `docs/todo/_backlog.md` instead.

### Step 2: Read the handoff's Key Files (parallel)

The handoff's `## Key Files` section is the curated short list of files needed to resume work. Read every file path listed there in parallel. Rules:
- Extract paths from bullets under `## Key Files` (ignore line-range annotations like `:47-89` — just read the whole file)
- Skip anything that isn't a readable file (directories, globs, missing files — note them but don't fail)
- If the handoff has no `## Key Files` section, skip this step
- Also read any file path explicitly called out in `## Next Actions` as the first file to touch — but only one or two, don't chase every mention

This is the "did you read all of these?" fix. Listing files without reading them is worthless; the next session needs the content loaded to act on step one of Next Actions immediately.

### Step 2.5: Search memory for what's coming next

The SessionStart hook injects a generic top-8 by decayed confidence × usage. This step adds *forward-looking* recall — memories that bear on the next action specifically, not on the project at large.

1. Extract 2-4 noun phrases from the handoff's `## Next Actions` section. Skip filler words ("decide", "consider", "verify"). Concrete things only — file names, feature names, technical concepts.
2. Run search:
   ```bash
   node .claude/core/memory-manager.js search "<phrases joined>"
   ```
3. Take the top 3 results ranked by `decayed_confidence * relevance`.
4. **Dedupe against the SessionStart hook's top-8** — that's already in context as a `<project_memory>` system-reminder. Skip hits whose `id` appears there.
5. For each remaining hit, read the summary line. If a hit looks directly relevant to the first Next Action, `cat docs/.output/memories/{category}/{id}.json` and surface the rule in the report.

**Skip condition:** If Next Actions is empty/stale OR `search` returns 0 results OR all hits are dupes of the top-8 OR all `decayed_confidence < 0.3`, skip silently — note "no relevant memories beyond top-8" in the report.

### Step 3: Verify & synthesize

Compare the handoff against git reality:
- If handoff says "next: implement X" but `git log` shows X was already committed → **flag as stale**, ignore that action
- If handoff is missing or completely stale → scan `docs/todo/_backlog.md` for pending work
- If a Key File's current contents contradict the handoff's description of it → trust the file, flag the drift

## Report

Provide a substantive summary (**30-60 lines**) that gives enough context to start working immediately. Use this exact template — every section is required, every label is verbatim, even when a section is empty.

```markdown
## Cold-start summary

**Recent work** (last 3-5 commits):
- `{hash}` {subject} — {one-line why-it-matters}
- `{hash}` {subject} — {one-line why-it-matters}

**State**
- Branch: `{branch}`, working tree {clean | N modified files}
- Build: {last gate status + count, or "unknown"}
- {anything notable about deployed/remote state}

**Decisions & context**
- {decision from handoff with the reasoning, not just the conclusion}
- {next decision with reasoning}

**Files loaded**
- ✓ `{path}` — Key File from handoff
- ✗ skipped `{path}` — {reason: missing, directory, glob, etc.}

**Memory hits** (from Step 2.5)
- `{category}/{id}` (relevance {N.N}, decayed_confidence {N.NN}) — {one-line takeaway}
- `{category}/{id}` (relevance {N.N}, decayed_confidence {N.NN}) — {one-line takeaway}

  *If Step 2.5 was skipped, replace the bullets with the literal line:*
  `none beyond SessionStart top-8`

**⚠ Handoff drift** (only if detected — omit the section if handoff matches git)
- {what the handoff says vs what git shows, with commit hashes}

**Next actions**
1. {action with enough detail to start immediately — file paths, what to search for, approach to try first}
2. {next action}

**Blockers** (only if still relevant — omit the section if none)
- {blocker, with what was already tried}

**Ready to work**: {one-sentence confirmation you understand what needs to be done}
```

### Section rules

- **Order is fixed.** Recent work → State → Decisions → Files loaded → Memory hits → (drift if any) → Next actions → (blockers if any) → Ready to work.
- **Memory hits is always present.** When Step 2.5 surfaces nothing useful, render it with the literal `none beyond SessionStart top-8` line — never omit the section.
- **Files loaded is always present.** Even if the handoff has no Key Files, render the heading and write `(no Key Files in handoff)`.
- **Optional sections are explicitly optional.** Only Handoff drift and Blockers may be omitted, and only when there is genuinely nothing to report.

## What NOT to Do
- Do NOT read `_project-architecture.md` or `_project-context.md` — CLAUDE.md already has this
- Do NOT read CLAUDE.md — it auto-loads, reading it again wastes tokens
- Do NOT load full planning docs unless the handoff is stale/missing
- Do NOT produce a report under 20 lines — that's too sparse to cold-start from
- Do NOT exceed 60 lines — that's a novel
