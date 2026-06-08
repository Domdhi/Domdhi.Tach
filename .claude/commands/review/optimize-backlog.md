---
description: Analyze backlog for dependency optimization, critical path, and parallel workstreams
---

# Optimize Backlog

Analyze `docs/todo/_backlog.md` for dependency optimization, critical path identification, and parallel workstream mapping. This is the analytical counterpart to `/create:project-epics` — where epic creation thinks in coverage and phasing, this command thinks in graphs, parallelism, and realistic developer workflow.

## Telemetry (run first)

This command is user-typed, so it does not fire `PostToolUse:Skill` — without this it leaves no `command_invocation` row and fleet analytics under-count human-driven runs. Self-log the invocation before anything else (best-effort — if it fails, continue regardless):

```bash
node .claude/core/telemetry-log.js review:optimize-backlog
```

## Agent Delegation

> **Orchestration rule**: You (the main agent) handle graph construction and validation. The `project-planner` agent handles optimization analysis and rewrite. Do NOT write the optimization inline — delegate via Task tool.

**Agent**: `project-planner` (via Task tool with `subagent_type: "project-planner"`)

**Prompt mode**: Analytical/optimization — not generative. The agent critiques and restructures existing work, it does not create new stories.

## Workflow

### 1. Check Prerequisites (main agent)

#### Check --yolo flag
If arguments contain `--yolo`, set YOLO_MODE = true.

- **Required**: Read `docs/todo/_backlog.md` — if it doesn't exist or first line is `<!-- @@template -->`, it's not real
- **Required**: Read `docs/_project-architecture.md` — needed for package boundary analysis
- **Optional**: Read `docs/_project-requirements.md` — for FR priority context (only if real, not template)

If `_backlog.md` doesn't exist or is template-only:
- If YOLO_MODE → warn and skip optimization
- Otherwise → **STOP**: "No backlog found. Run `/create:project-epics` first. Use `--yolo` to bypass this gate."

### 2. Build Dependency Graph (main agent)

Extract from `_backlog.md`:
1. **All stories** with their ID, epic, phase, estimate, domain tag, and dependencies
2. **Build adjacency list**: For each story, list what it depends on and what depends on it
3. **Identify**:
   - **Root nodes**: Stories with no dependencies (can start immediately)
   - **Leaf nodes**: Stories nothing depends on (can finish last)
   - **High fan-out nodes**: Stories that many others depend on (bottlenecks)
   - **Cross-phase dependencies**: Stories in Phase N that depend on Phase N+2 stories (ordering problems)
   - **Cross-package boundaries**: Stories that touch different packages/modules (identify from `docs/_project-architecture.md` component boundaries)

4. **Compute critical path**: The longest dependency chain from any root to any leaf. This is the minimum total time regardless of parallelism.

5. **Identify parallel workstreams**: Groups of stories that share no dependencies and touch different packages/domains. These can be developed simultaneously.

### 3. Delegate Optimization Analysis (main agent → project-planner)

Use the Task tool with `subagent_type: "project-planner"` to analyze and optimize.

**Task prompt must include**:
1. The full story list with dependencies (extracted in step 2)
2. The dependency graph summary (roots, leaves, bottlenecks, cross-phase deps)
3. The architecture package boundaries (extracted from `docs/_project-architecture.md` component architecture)
4. The `project-planner` agent auto-loads the `project-planning` skill via frontmatter.
5. Instruction to read `docs/todo/_backlog.md` for the full backlog context
6. Instruction to read `docs/_project-architecture.md` for package boundaries

**The agent must produce these sections**:

#### A. Dependency Graph (ASCII)
```
Story 1.1 ──→ Story 1.2 ──→ Story 1.4
                  └──→ Story 2.1 ──→ Story 2.2
                                  ──→ Story 2.3
```
Show the full DAG with critical path highlighted.

#### B. Critical Path Analysis
- The single longest dependency chain
- Total estimated hours for the critical path
- Bottleneck stories (high fan-out) that block the most downstream work
- Recommendations to shorten the critical path (can any dependencies be relaxed?)

#### C. Parallel Workstreams
Identify independent tracks that can be developed simultaneously:
```
Track A (Runtime):  3.1 → 4.1 → 4.2 → ...
Track B (Frontend): 10.1 → 10.2 → 10.3 → ...
Track C (Types):    2.1 → 2.2 → 2.3 → ...
```
For each track: stories, total estimate, package(s) touched, which phases it spans.

#### D. Over-Specified Dependencies
Stories where a listed dependency isn't strictly necessary. Example: "Story 14.1 lists 10.5 as a dependency, but 14.1 only needs the shell layout (10.3), not the API client."

#### E. Phase Optimization
- Are any phases artificially sequential when they could overlap?
- Are there stories in late phases that could move earlier (their dependencies are already met)?
- Are there stories in early phases that should move later (they block nothing critical)?

#### F. Developer Workflow Recommendation
A realistic sprint-by-sprint (or week-by-week) plan showing:
- Which stories to work on in parallel
- When to context-switch between packages
- Suggested pairing of backend + frontend stories for same-feature integration

### 4. Validate (main agent)

After the agent completes, verify:
- Critical path is actually the longest chain (spot-check a few paths)
- Parallel workstreams don't share hidden dependencies
- Recommendations don't violate architecture boundaries
- If issues found, note them in the report
- **Sub-agent return contract (F13):** the delegated agent must return its **full** analysis as its result, not a headline summary. If it returns only a summary, request the complete artifact (via `SendMessage`) before proceeding — do not reconstruct it from the summary.
- **Count integrity (F14):** if the agent rewrote the backlog, re-derive the totals yourself from the rewritten file (epics, stories, done/total per phase) and confirm they match the rewrite's stated counts. Rewrite agents frequently introduce count drift ("41 total / 13 done", "13 of 27"). Fix any mismatch before commit.

### 5. Ask: Apply Optimizations? (main agent)

Present the optimization report to the user and ask:

> **Options:**
> 1. **Report only** — Keep the analysis as reference, don't modify `_backlog.md`
> 2. **Apply annotations** — Add parallel workstream markers and critical path notes to `_backlog.md` without changing story order
> 3. **Full rewrite** — Restructure phases and dependencies based on optimizations (delegate back to agent)

If option 2 or 3: delegate the rewrite to the project-planner agent with specific instructions.

> **Rewrite in place — never emit a parallel file (F12).** A "full rewrite" must update the canonical `docs/todo/_backlog.md` **in place** (overwriting it). Do NOT write a parallel `_epics.md`/`_backlog-optimized.md` and leave the human to rename it — a parallel file forces out-of-band file management and leaves stale self-references (wrong title, circular "derived from" notes, self-links, wrong counts) that then have to be hand-repaired. If the user wants to preview first, use option 1 (report only); when they choose rewrite, write the canonical file directly and re-run the count check in Step 4.

### 6. Persist Output (main agent)

Write the full analysis to disk before committing:

```bash
mkdir -p docs/.output/reviews
```

Write the complete backlog optimization report (dependency graph + critical path + parallel workstreams + recommendations) to:
`docs/.output/reviews/{YYMMDD-HHMM}-backlog-optimization.md`

File format:
```markdown
# Backlog Optimization — {YYYY-MM-DD}

**Input**: docs/todo/_backlog.md
**Stories analyzed**: {count}

{full report content — dependency graph, critical path analysis, parallel workstreams, over-specified deps, phase optimization, developer workflow recommendation}
```

### 7. Commit (main agent)

Follow the **Post-Command Commit Convention** in CLAUDE.md. Stage all files created or modified by this command — including `docs/.output/reviews/{YYMMDD-HHMM}-backlog-optimization.md` — and commit with a descriptive message.

### 8. Report (main agent)

```markdown
## Backlog Optimization Complete

**Input**: docs/todo/_backlog.md
**Stories analyzed**: {count}
**Output**: `docs/.output/reviews/{YYMMDD-HHMM}-backlog-optimization.md`
**Critical path**: {count} stories, ~{hours} hours ({story chain})
**Parallel tracks**: {count} independent workstreams identified
**Optimizations found**: {count} over-specified deps, {count} phase moves

### Critical Path
{story} → {story} → ... → {story} ({total hours}h)

### Parallel Workstreams
| Track | Package | Stories | Est. Hours | Phases |
|-------|---------|---------|-----------|--------|
| {name} | {pkg} | {count} | {hours} | {range} |

### Key Findings
- {finding 1}
- {finding 2}
- {finding 3}

**Applied**: {Report only / Annotations added / Full rewrite}
**Committed**: {hash} — `docs: /optimize-backlog — {summary}`
**Next step**: Run `/check-readiness` to validate implementation readiness.
```

## When to Run

- After `/create:project-epics` — optimize before implementation begins
- After adding new stories mid-sprint — re-check the dependency graph
- After completing a phase — verify remaining work is still optimally ordered
- Before sprint planning — identify what can be parallelized this sprint
