---
description: Detect documentation drift after implementation — flags docs that are out of sync with code
argument-hint: [scope: all | architecture | stories | prd]
---

# Check Sync

Detect documentation drift by comparing planning docs against actual project state. Run after stories, after epics, or on-demand to catch misalignment early.

## Telemetry (run first)

This command is user-typed, so it does not fire `PostToolUse:Skill` — without this it leaves no `command_invocation` row and fleet analytics under-count human-driven runs. Self-log the invocation before anything else (best-effort — if it fails, continue regardless):

```bash
node .claude/core/telemetry-log.js review:check-sync
```

## Agent Delegation

> **Orchestration rule**: You (the main agent) handle scope selection, dead reference scanning, and the final report. Domain agents handle the analysis for their area. Do NOT perform drift analysis inline — delegate to the domain expert.

**Agents used** (via Task tool):
- `architect` — architecture doc vs actual codebase
- `project-planner` — story status in TODO checklists vs git history
- `product-strategist` — PRD requirements vs implemented features

## Variables

INPUT: $ARGUMENTS

- `INPUT` (optional): Scope to check. Defaults to `all`.
  - `all` — Check everything
  - `architecture` — Architecture vs actual tech stack and structure
  - `stories` — Story status in TODO checklists vs git history
  - `prd` — PRD requirements vs implemented features

## Workflow

### 1. Gather Context (main agent)

Collect the raw data that agents will need:

```bash
# Git history for story/commit cross-reference
git log --oneline -50

# Package/dependency files
Glob: package.json, *.csproj, *.sln, *.slnx, requirements.txt, Cargo.toml, go.mod, pyproject.toml

# Project structure
Glob: src/**/*, lib/**/*, app/**/*

# TODO checklists
Glob: docs/todo/TODO_epic*.md
Glob: docs/TODO_*.md
```

### 2. Delegate Domain Checks (main agent → domain agents)

Launch applicable agents **in parallel** based on scope. Each agent auto-loads its skills via frontmatter.

**2a. Architecture sync** (if scope is `all` or `architecture`) — `subagent_type: "architect"`

Task prompt:
1. Read `docs/_project-architecture.md` — extract tech stack, project structure, key directories, dependency list
2. Read the actual package/dependency files: {list files found in Step 1}
3. Scan actual project structure: run Glob on `src/**/*`, `lib/**/*`, `app/**/*`
4. Compare and flag drift:
   - Architecture lists a dependency not in any package file
   - Architecture references a directory or path that doesn't exist
   - A package file has significant dependencies not mentioned in architecture
   - Architecture describes patterns/structure that doesn't match reality
5. Return structured report: item, what doc says, what reality shows, status (synced/drifted/missing)
6. Rate overall: SYNCED, MINOR_DRIFT, or MAJOR_DRIFT

**2b. Story status sync** (if scope is `all` or `stories`) — `subagent_type: "project-planner"`

Task prompt:
1. Read all TODO checklists: {list TODO files found in Step 1}
2. Read git log: `git log --oneline -50`
3. For stories marked `[x]` (completed): check git log for commits referencing that story. If no commits → flag "marked done but no commits found"
4. For stories marked `[ ]` (pending): check if commits or code already implement it. If implementation exists → flag "implemented but not marked done"
5. If master index exists (`docs/TODO_*.md`): verify epic-level done counts match per-epic checklists
6. Return structured report: story ID, doc status, git evidence, sync status
7. Rate overall: SYNCED, MINOR_DRIFT, or MAJOR_DRIFT

> **Note**: `docs/todo/_backlog.md` is a **read-only planning artifact** — it defines what to build but does NOT track completion status. Status lives in per-epic TODO checklists and the master index.

**2c. PRD coverage sync** (if scope is `all` or `prd`) — `subagent_type: "product-strategist"`

Task prompt:
1. Read `docs/_project-requirements.md` — extract functional requirements list
2. For each requirement: search the codebase for related implementations (by keyword, module name, route, component)
3. Note whether each requirement appears implemented, partial, or missing
4. This is **informational** — PRD drift is expected during early phases, so flag but don't alarm
5. Return structured report: requirement ID, description, evidence found, status (implemented/partial/missing)
6. Rate overall: ON_TRACK, PARTIAL_COVERAGE, or LOW_COVERAGE

### 3. Dead Reference Check (main agent)

Scan all docs for broken internal references yourself:

- Read all `docs/*.md` and `docs/**/*.md` files
- Extract internal links (relative paths to other docs or code files)
- Verify each referenced file actually exists
- Flag any doc that references a file path that no longer exists

### 3b. Legacy / Duplicate Doc Check (main agent) — F2

Run the drift detector for legacy-named and duplicated planning docs the create-chain is blind to (e.g. `_architecture.md` beside `_project-architecture.md`, a root `_backlog.md` beside `todo/_backlog.md`), **plus misplaced TODO files** outside the canonical `docs/` root and `docs/todo/` homes (e.g. a stale `docs/work/TODO_epic00.md` left by an older plan — F17):

```bash
node .claude/core/_lib/doc-drift.js
```

Exit 1 means drift was found — fold every reported item (legacy docs, duplicates, **and misplaced TODOs**) into the report as a drift finding (recommend reconciling via `/onboard`'s Step 6b or manual cleanup). Exit 0 means clean.

### 4. Persist Output (main agent)

Write the full drift analysis to disk before reporting:

```bash
mkdir -p docs/.output/reviews
```

Write the complete sync check output (all agent findings + dead references) to:
`docs/.output/reviews/{YYMMDD-HHMM}-sync-check.md`

File format:
```markdown
# Sync Check — {YYYY-MM-DD}

**Scope**: {all | architecture | stories | prd}

{full report content — architecture sync table, story status, PRD coverage, dead references, summary, recommended actions}
```

### 5. Commit (main agent)

Stage and commit the sync check output file:

Write the commit message to `docs/.output/.commit-msg` (Write tool — no shell escaping):

```
docs: /review:check-sync — {scope}, {N} drift items, {N} dead links
```

Then run:

```bash
git add docs/.output/reviews/{YYMMDD-HHMM}-sync-check.md
node .claude/core/commit.js
```

### 6. Report (main agent)

Assemble agent results + dead reference check into the final report, including the output file path:

```markdown
## Doc Sync Report

**Date**: {YYYY-MM-DD}
**Scope**: {all | architecture | stories | prd}
**Output**: `docs/.output/reviews/{YYMMDD-HHMM}-sync-check.md`

### Architecture Sync {agent rating}
| Item | Doc Says | Reality | Status |
|------|----------|---------|--------|
| {dependency/path} | {what architecture claims} | {what actually exists} | {synced/drifted/missing} |

### Story Status Sync {agent rating}
| Story | Doc Status | Git Evidence | Status |
|-------|-----------|--------------|--------|
| {N.M: title} | {[x]/[ ]} | {commit hash or "none"} | {synced/drifted} |

### PRD Coverage {agent rating}
| Requirement | Evidence | Status |
|-------------|----------|--------|
| {FR-N: description} | {file or "not found"} | {implemented/partial/missing} |

### Dead References
| File | Broken Link | Target |
|------|-------------|--------|
| {doc path} | {link text} | {missing target path} |

### Summary
- **Architecture**: {N} items synced, {N} drifted — {agent rating}
- **Stories**: {N} synced, {N} drifted — {agent rating}
- **PRD**: {N} implemented, {N} partial, {N} missing — {agent rating}
- **Dead links**: {N} found

### Recommended Actions
- {specific fix for each drift item, ordered by severity}
```

## When to Run

- After completing an epic (suggested by `/retro`)
- After a batch of stories (suggested by `/do` post-implementation)
- Before starting a new phase
- On-demand when something feels off
