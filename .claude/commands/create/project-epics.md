---
description: Break requirements into epics and stories for implementation
argument-hint: [project name or architecture path] [--yolo]
---

# Create Epics

Break product requirements into implementable epics and stories. Produces `docs/todo/_backlog.md`.

## Telemetry (run first)

This command is user-typed, so it does not fire `PostToolUse:Skill` — without this it leaves no `command_invocation` row and fleet analytics under-count human-driven runs. Self-log the invocation before anything else (best-effort — if it fails, continue regardless):

```bash
node .claude/core/telemetry-log.js create:project-epics
```

## Agent Delegation

> **Orchestration rule**: You (the main agent) handle upstream checks and requirement analysis. The `project-planner` agent handles epic/story breakdown. Do NOT write the epics document inline — delegate via Task tool.

**Agent**: `project-planner` (via Task tool with `subagent_type: "project-planner"`)

## Variables

INPUT: $ARGUMENTS

## Workflow

### 1. Check Upstream (main agent)

#### 1a. Check --yolo flag
If `$ARGUMENTS` contains `--yolo`, set YOLO_MODE = true. Strip `--yolo` from INPUT before continuing.

#### 1b. Hard Gate: Require real PRD AND Architecture
Read the first line of each file. Check that both exist AND neither contains `<!-- @@template -->`.

- `docs/_project-requirements.md` — source of functional requirements
- `docs/_project-architecture.md` — source of technical structure

**If either is missing or template-only:**
- If YOLO_MODE → warn: "{missing file(s)} not found. Proceeding in yolo mode." → continue with whatever context is available
- Otherwise → **STOP**: "`{missing file}` has not been created yet. Run `/{command}` first. Use `--yolo` to bypass this gate."
  - If `_project-requirements.md` missing → suggest `/create:project-requirements`
  - If `_project-architecture.md` missing → suggest `/create:project-architecture`

> **Gate posture (F3) — the default is to SATISFY the gate, not bypass it.** When you stop at a hard gate, the right next action is to **generate the missing prerequisite** (run the suggested `/create:*` command), then resume. If you surface a choice to the user via `AskUserQuestion`, the **Recommended** option must be "create the missing doc first" — **never** present "proceed off the stale/stub doc" or `--yolo` as the recommended path. Bypass is an explicit user override, not a nudge. Quietly building epics off a leftover `_prd.md` or a template stub is the failure mode this gate exists to prevent.

- **Optional**: Read `docs/_project-design.md` for UI-specific stories (only if real, not template)

### 2. Check for Existing Output (main agent)

- If `docs/todo/_backlog.md` exists → ask: **update** (add new epics) or **replace**?
- If replacing, confirm with user (this is destructive if implementation is in progress)

### 3. Analyze Requirements (main agent)

Synthesize a planning brief from upstream docs:
1. List all Functional Requirements from PRD (by module)
2. List architecture component boundaries
3. Map FRs to architecture components
4. Identify cross-cutting concerns that need their own stories
5. Note any UI-specific requirements from UX spec

### 4. Delegate to Agent

Use the Task tool with `subagent_type: "project-planner"` to generate epics and stories.

**Task prompt must include**:
1. What to produce (`docs/todo/_backlog.md`)
2. Full list of FRs with their MoSCoW priorities and acceptance criteria
3. Architecture component list and boundaries
4. FR-to-component mapping
5. Cross-cutting concerns identified
6. Phase structure guidance:
   - Phase 0: Foundation & Configuration (ALWAYS first)
   - Phase 1: Data & Core
   - Phase 2: Auth (can merge with Phase 1 if simple)
   - Phase 3+: Feature phases ordered by dependency and Must Have priority
   - Final Phase: Polish & Launch

The `project-planner` agent auto-loads the `project-planning` skill via frontmatter — do NOT tell it to read the skill file.

### 5. Validate (main agent)

After the agent completes, verify the output:
- Every FR from PRD maps to at least one story?
- No circular dependencies?
- Phase 0 is foundation?
- No XL stories without a split recommendation?
- Must-Have FRs are in early phases?
- Stories have acceptance criteria and size estimates?
- **Epic IDs are contiguous** (C9) — the epic numbers run without gaps (e.g. Epic 0..Epic N, not 0–7 then jumping to 11) and the count stated in any summary matches the number of `## Epic` headers. A non-contiguous ID propagates silently into the master index, per-epic filenames, and every story ID downstream — delegate back to renumber before continuing.
- If issues found, delegate back to the agent to fix

### 6. Detect File Overlap (main agent)

Run the epic-overlap CLI against the new `_backlog.md` to surface any inadvertent file-ownership overlaps between epics. The wave-based execution model in `/run-todo` requires zero file overlap within a wave — overlaps that aren't explicitly acknowledged will produce silent merge conflicts during parallel dispatch.

```bash
node .claude/core/_lib/epic-overlap.js docs/todo/_backlog.md
```

- Exit 0 (no overlaps) → continue to commit step
- Exit 1 (overlaps found) → surface in the report as a warning. Overlaps may be intentional (shared interface, cross-cutting refactor); if intentional, the user should add a `## Acknowledged Overlaps` section to `_backlog.md` listing each pair and the rationale. `/review:check-readiness` will then accept the overlap as documented.

This is a warning, not a failure — `/create:project-epics` does not block on overlaps.

### 7. Commit (main agent)

Follow the **Post-Command Commit Convention** in CLAUDE.md. Stage all files created or modified by this command and commit with a descriptive message.

### 8. Report (main agent)

```markdown
## Epics Complete

**Output**: docs/todo/_backlog.md
**Phases**: {count}
**Epics**: {count}
**Stories**: {count} ({S count} S, {M count} M, {L count} L, {XL count} XL)
**Must-Have coverage**: All {count} Must-Have FRs mapped to stories

**Committed**: {hash} — `docs: /create:project-epics — {summary}`
**Next step**: Run `/review:optimize-backlog` for dependency graph analysis and parallel workstreams, then `/review:check-readiness` to validate implementation readiness.
```
