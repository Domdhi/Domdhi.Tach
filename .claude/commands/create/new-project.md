---
description: Initialize a new project — scaffolds the docs tree and walks the full planning pipeline to implementation-ready
argument-hint: "[project name] [--yolo]"
---

# New Project

Master orchestrator that walks a fresh clone from zero to implementation-ready. Scaffolds the `docs/` tree, interviews the user, and chains the planning pipeline (`/create:project-brief` → `/create:project-requirements` → optional `/create:project-design` → `/create:project-architecture` → `/create:project-epics`), specializes the agents for the new stack, and writes a project-context quick-reference.

Intended as the FIRST command an adopter runs after cloning the template. Safe to re-run on a partially-initialized project — the scaffold step is idempotent (skips existing files) and every sub-command has its own hard gate that prevents overwriting filled docs.

## Telemetry (run first)

This command is user-typed, so it does not fire `PostToolUse:Skill` — without this it leaves no `command_invocation` row and fleet analytics under-count human-driven runs. Self-log the invocation before anything else (best-effort — if it fails, continue regardless):

```bash
node .claude/core/telemetry-log.js create:new-project
```

## Variables

INPUT: $ARGUMENTS

### Project name resolution
- If `$ARGUMENTS` includes a project name → use it
- Otherwise → fall back to the basename of the current working directory, confirm with the user in Step 3 Round 1
- The project name is used for the report, the `_project-context.md` title, and nothing else — sub-commands derive their own slugs

### Flag detection
If `$ARGUMENTS` contains `--yolo`:
- Set YOLO_MODE = true
- Strip `--yolo` from INPUT (remaining text is the project name)
- All sub-commands invoked below receive `--yolo` appended to their arguments
- When YOLO_MODE is active, hard gates in sub-commands downgrade to warnings

## Workflow

### 1. Scaffold Docs Structure

Run `node .claude/core/scaffold.js` to copy templates from `.claude/templates/` into `docs/`. This creates the directory structure and blank template files marked with `<!-- @@template -->` as their first line. Existing files are skipped — safe to re-run on partial state.

### 2. Fresh-Project Check

Detect whether any real (filled, non-template) planning doc already exists. A template-marked doc is "scaffolded but unfilled" and doesn't count; a doc without the marker is real content.

```bash
grep -L "@@template" docs/_project-brief.md docs/_project-requirements.md docs/_project-architecture.md docs/todo/_backlog.md 2>/dev/null
```

**If the command returns any filled file** — the project is NOT fresh. Unless YOLO_MODE is active, exit with:

```
Existing planning docs detected:
  {list of files without the @@template marker}

This command is for FRESH projects. To continue an existing one, use the individual setup commands:
  /create:project-brief          — draft the strategic vision
  /create:project-requirements   — write the PRD
  /create:project-architecture   — design the system
  /create:project-epics          — break work into stories

Or re-run with --yolo to steamroll (regenerates existing docs).
```

**If YOLO_MODE is active and filled docs exist** — warn and proceed, re-invoking the pipeline on existing state:

```
WARNING: Filled planning docs detected. Proceeding with --yolo — existing docs will be regenerated.
  {list of files that will be overwritten}
```

**If all planning docs are template-marked or missing** — proceed to Step 3.

### 3. Welcome & Quick Interview

Ask three short rounds. Each question is marked **free-form** (plain conversational ask) or **closed-choice** (use `AskUserQuestion` with concrete options). Keep answers — they feed every sub-command below.

**Round 1: The Elevator Pitch**
- *(free-form)* "What are you building? (1-2 sentences)"
- *(free-form)* "Who is it for? (target users)"
- *(free-form)* "What should we call this project?" — default to the current directory basename; accept user override.

**Round 2: Tech & Scope**
- *(free-form)* "What's the tech stack? (or should I recommend one?)" — paragraph answer; user may name a stack or defer.
- *(closed-choice — `AskUserQuestion`)* "What's the scale?" with options: Small tool / Medium app / Enterprise platform.
- *(closed-choice — `AskUserQuestion`)* "Does this project have a user interface?" with options: Yes / No.

**Round 3: Constraints**
- *(free-form)* "Any hard constraints? (deadline, budget, compliance, existing infrastructure)"
- *(closed-choice — `AskUserQuestion`)* "What's the deployment target?" with options: Cloud / On-prem / SaaS / Hybrid.

#### 3a. Persist interview answers (BEFORE any sub-command runs)

Write the answers to `docs/.output/work/{YYYY-MM-DD}/new-project-interview.md`. Session death between here and Step 8 otherwise loses the entire interview and forces a re-ask. Format:

```markdown
# New Project Interview — {project name} ({YYYY-MM-DD})

## Round 1: Elevator Pitch
- **What we're building:** {answer}
- **Target users:** {answer}
- **Project name:** {answer}

## Round 2: Tech & Scope
- **Tech stack:** {answer}
- **Scale:** {answer}
- **Has UI:** {yes | no}

## Round 3: Constraints
- **Hard constraints:** {answer}
- **Deployment target:** {answer}

## Derived routing
- **Complexity tier:** {simple | medium | complex}  ← from Step 4
- **Pipeline path:** {list of sub-commands to run}
```

### 4. Phase Routing

> **YOLO pass-through**: If YOLO_MODE is active, append `--yolo` to every sub-command invocation below. This causes each command's hard gates to downgrade to warnings.

Classify the project from the interview answers:

**Simple project (small tool, clear scope):**
```
/create:project-requirements (minimal) → /create:project-architecture → /create:project-epics
```

**Medium project (app with multiple features):**
```
/create:project-brief → /create:project-requirements → /create:project-architecture → /create:project-epics
```

**Complex project (enterprise, regulated, multiple integrations):**
```
/brainstorm → /create:project-brief → /create:project-requirements → /create:project-design → /create:project-architecture → /create:project-epics
```

Update the `## Derived routing` section of `new-project-interview.md` with the chosen tier and path before proceeding.

### 5. Phase 1 — Analysis (complex projects only)

1. Run `/brainstorm` with the project description
2. Show output, ask: "Continue to planning?"
3. Optionally run `/research` if there are unknowns

### 6. Phase 2 — Planning

1. Run `/create:project-brief` (if not skipped by tier routing)
   - Pass interview answers as context
   - Show output summary
2. Run `/create:project-requirements`
   - Uses project-brief as input
   - May ask additional interview questions for FRs/NFRs
   - Show output summary
3. Run `/create:project-design` — only if the Round 2 "Has UI" answer was yes
   - Produces the UX design suite (spec, wireframes, light/dark themes, mock layout)
   - Show output summary

### 7. Phase 3 — Solutioning

1. Run `/create:project-architecture`
   - Uses PRD + UX spec (if present) as input
   - May ask interview questions for tech decisions
   - Show output summary
2. Run `/create:project-epics`
   - Uses PRD + Architecture as input
   - Show story count and phase breakdown
3. Run `/review:check-readiness`
   - Validate all docs are complete and consistent
   - If CONCERNS: show issues, ask if user wants to fix
   - If FAIL: fix issues before proceeding

### 8. Specialize `.claude/` for the new stack

After readiness passes, specialize the generic agents and memory for this project:

1. Run `/review:specialize --fix`
   - Extracts tech stack from `_project-architecture.md`
   - Appends `## Project Context` to each default agent in `.claude/agents/*.md`
   - Creates stack-specific agents (e.g., `db-architect.md`, `auth-builder.md`) based on architecture sections
   - Seeds the memory system with ADRs and architectural patterns (confidence 0.9)
   - Audits skills for relevance and flags framework gaps
2. Show the specialization report to the user
3. If framework skill gaps are surfaced, note them — the user can create them later via `/create:component` or defer

### 9. Generate Project Context

Write `docs/_project-context.md`:

```markdown
# Project Context: {Project Name}

**Initialized**: {date}
**Phase**: Implementation Ready
**Tech Stack**: {from _project-architecture.md}

## Quick Reference
- **Brief**: [docs/_project-brief.md](_project-brief.md) (if created)
- **PRD**: [docs/_project-requirements.md](_project-requirements.md)
- **Architecture**: [docs/_project-architecture.md](_project-architecture.md)
- **UX Design**: [docs/_project-design.md](_project-design.md) (if UI project)
- **Wireframes**: [docs/design/_wireframes.md](design/_wireframes.md) (if UI project)
- **Themes**: [docs/design/_design.light.md](design/_design.light.md) / [_design.dark.md](design/_design.dark.md) (if UI project)
- **Mock Layout**: [docs/design/_mock-layout.html](design/_mock-layout.html) (if UI project)
- **Backlog**: [docs/todo/_backlog.md](todo/_backlog.md)

## Implementation Commands
- `/create:module` — plan and document a new feature
- `/create:component` — add a new agent, command, or skill
- `/review:personalize` — give the specialized agents names and soul-level identity
- `/review:code-review` — review code changes
- `/review:qa` — generate tests
- `/review:retro` — retrospective after epic completion
- `/review:changelog` — generate release notes
- `/review:check-sync` — detect doc drift
- `/review:update-docs` — fix doc drift
- `/review:optimize-agents` — re-align agents with codebase
- `/prime` — reload context in new session
- `/do` — execute a single story
- `/run-todo` — execute a full TODO checklist
- `/end` — save session state

## Stats
- **Epics**: {count}
- **Stories**: {count}
- **Must-Have FRs**: {count}
```

### 10. Wrap-up Commit

**What's already committed by now:** each sub-command in Steps 5–8 commits its own work per the Post-Command Commit Convention. By the time this step runs, most planning docs are already in git history.

**What this step commits:** only the files NOT yet staged by any sub-command. In practice that's:
- `docs/_project-context.md` (written in Step 9)
- `docs/.output/work/{date}/new-project-interview.md` (written in Step 3a)
- Any scaffolded template files that were left empty and committed as-scaffolded (edge case — usually not applicable)

Stage specifically those files; never use `git add .` (might pull in unrelated changes in the adopter's working tree).

Write the commit message to `docs/.output/.commit-msg` (Write tool — no shell escaping):

```
feat: /create:new-project — {project name} initialized
```

Then run:

```bash
git add docs/_project-context.md docs/.output/work/{date}/new-project-interview.md
node .claude/core/commit.js
```

### 10b. Capture Feedback Report

Chain `/review:feedback` as the final action so every newly-initialized project leaves a baseline template-performance report (`docs/.output/reviews/feedback-{date}.md` + `.json`). It rolls up the pipeline's telemetry (sub-command invocations, gate runs, hooks, memories) plus a short agent self-review, and self-commits.

```
/review:feedback
```

Answer the self-review honestly from this run (friction, what broke, one change you'd make). Best-effort: if it fails, note it and continue to the report.

### 11. Final Report

```markdown
## Project Initialized!

**Project**: {name}
**Tech Stack**: {stack}
**Complexity tier**: {simple | medium | complex}

### Documents Created
| Document | Path | Status |
|----------|------|--------|
| Project Brief | docs/_project-brief.md | {Created / Skipped — tier routing} |
| PRD | docs/_project-requirements.md | Created |
| UX Design | docs/_project-design.md | {Created / Skipped — no UI} |
| Wireframes | docs/design/_wireframes.md | {Created / Skipped — no UI} |
| Light Theme | docs/design/_design.light.md | {Created / Skipped — no UI} |
| Dark Theme | docs/design/_design.dark.md | {Created / Skipped — no UI} |
| Mock Layout | docs/design/_mock-layout.html | {Created / Skipped — no UI} |
| Architecture | docs/_project-architecture.md | Created |
| Backlog | docs/todo/_backlog.md | Created |
| Feature Ideas | docs/todo/_feature-ideas.md | {Created — complex tier only / Skipped} |
| Project Context | docs/_project-context.md | Created |

### Specialization: {report summary}

### Readiness Check: {PASS / CONCERNS}

**Committed**: {hash} — `feat: /create:new-project — {summary}`

### Ready to Build!

Recommended next commands:

1. **`/review:personalize`** — give your specialized agents names, personas, and soul-level identity. Makes the team memorable and easier to reference by name. See `docs/guides/personalize.md` for the walkthrough.
2. **`/do {first-story-id}`** — implement the first story from the backlog.
3. **`/run-todo docs/todo/TODO_{project}.md`** — if the per-project TODO was generated, execute the whole checklist end-to-end.
4. **`/prime`** — in a new session, reload context from the handoff.
```

## Anti-Patterns

- **DO NOT run this on a project with filled planning docs** unless `--yolo` is explicit — the fresh-project check exists for a reason
- **DO NOT skip the interview persistence step** — session death without the scratch file forces the user to re-interview, which is the single most frustrating way to lose work
- **DO NOT auto-invoke `/review:personalize`** — personalize is opinionated work and should be an adopter choice, not a default
- **DO NOT use `git add .` in the wrap-up commit** — always stage specific files; the adopter may have unrelated changes in their working tree
