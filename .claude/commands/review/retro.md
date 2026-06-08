---
description: Run a retrospective after completing an epic — analyze what worked, what didn't, extract patterns
argument-hint: [epic name or number]
---

# Retrospective

Analyze a completed epic to extract lessons learned and patterns. Produces `docs/.output/reviews/retro-{epic-slug}.md`.

## Telemetry (run first)

This command is user-typed, so it does not fire `PostToolUse:Skill` — without this it leaves no `command_invocation` row and fleet analytics under-count human-driven runs. Self-log the invocation before anything else (best-effort — if it fails, continue regardless):

```bash
node .claude/core/telemetry-log.js review:retro
```

## Agent Delegation

> **Orchestration rule**: You (the main agent) handle epic identification, data gathering, pattern extraction to memory, and doc sync. The `doc-writer` agent handles the retrospective analysis and output generation. Do NOT write the retro document inline — delegate via Task tool. You DO handle memory operations and committing.

**Agent**: `doc-writer` (via Task tool with `subagent_type: "doc-writer"`)

## Variables

INPUT: $ARGUMENTS

## Workflow

### 1. Identify Epic (main agent)

**If INPUT provided:**
- Match against epic names/numbers in `docs/todo/_backlog.md`

**If no INPUT:**
- Find the most recently completed epic (all stories `[x]`)
- If none fully complete, ask user which epic to review

### 2. Gather Data (main agent)

**From Git:**
- `git log --oneline` for commits related to this epic
- Count commits, files changed, lines added/removed
- Identify date range (first commit → last commit)

**From TODO Files:**
- Read Execution Log for this epic's stories
- Read Key Decisions section
- Note any stories that were deferred `[~]` or blocked `[!]`

**From Work Documents:**
- Read plans from `docs/.output/plans/` related to this epic
- Note any plan revisions or course corrections

**From Memory:**
```bash
node .claude/core/memory-manager.js report
```
Review existing patterns for relevance to this epic.

**From Telemetry:**
- Read `docs/.output/telemetry/command-usage.jsonl` (if it exists)
- Filter entries to the epic's date range (use the first/last commit dates from git log)
- Compute:
  - **Command frequency**: count of each `command_invocation` event grouped by `command` field
  - **Gate results**: count of `gate_run` events grouped by `outcome` (pass/fail)
  - **Command chains**: group events by `session_id`, extract the sequence of commands per session
- If the file doesn't exist or is empty, note "No telemetry data available" and continue

### 3. Run Doc Sync Check (main agent)

Run `/check-sync` to detect any documentation drift from this epic's implementation.
Capture findings for inclusion in the retro output.

### 4. Delegate to Agent (main agent → doc-writer)

Use the Task tool with `subagent_type: "doc-writer"` to generate the retrospective analysis.

**Task prompt must include**:
1. Epic name, number, and story list
2. All gathered data from Step 2 (git stats, TODO context, work doc summaries, memory patterns, telemetry stats)
3. Doc sync findings from Step 3
4. The `doc-writer` agent auto-loads the `project-planning` skill via frontmatter.
5. Instruction to write to `docs/.output/reviews/retro-{epic-slug}.md` using the output template below
6. Instruction to analyze: what went well, what didn't, key decisions, metrics, recommendations
7. Instruction to include a System Improvements section evaluating agent/skill/command/memory effectiveness
8. Instruction to include the Doc Sync Summary from the check-sync findings
9. **Output boundary (MUST include verbatim):** *"Your ONLY output is the retro markdown at the specified path. Do NOT create additional files. Do NOT write memories. Do NOT write to `.claude/agent-memory/`, `docs/.output/memories/`, or anywhere else. Main Agent handles memory extraction in Step 5."* The doc-writer tends to over-deliver when it sees a multi-step workflow described in the prompt — without this boundary, it has authored phantom memory directories outside its assigned task. Reference incident: 2026-04-20 retro MU dispatch.

**Output template for the agent:**

```markdown
# Retrospective: {Epic Name}

**Date**: {YYYY-MM-DD}
**Epic**: {N} — {name}
**Duration**: {start date} → {end date}
**Stories**: {completed}/{total}

---

## What Went Well
- {item}
- {item}

## What Didn't Go Well
- {item with context and root cause}

## Key Decisions Made
| Decision | Rationale | Outcome |
|----------|-----------|---------|
| {decision} | {why} | {good/bad/neutral} |

## Patterns Extracted
| Pattern | Confidence | Status |
|---------|-----------|--------|
| {name} | {0-1} | {New / Promoted / Existing} |

## Metrics
- **Commits**: {count}
- **Files changed**: {count}
- **Lines**: +{added} / -{removed}
- **Build failures**: {count}
- **Test failures**: {count}
- **Stories completed first attempt**: {count}/{total}

## Skill Usage Telemetry

### Command Frequency
| Command | Count |
|---------|-------|
| {command} | {count} |

### Gate Results
| Gate | Pass | Fail | Pass Rate |
|------|------|------|-----------|
| gate:build | {n} | {n} | {%} |
| gate:test | {n} | {n} | {%} |

### Common Command Chains
- {session}: {command1} → {command2} → {command3}

*{Or "No telemetry data available for this period" if no data}*

## Recommendations for Next Epic
- {actionable recommendation}
- {actionable recommendation}

## System Improvements
| Area | Finding | Recommendation |
|------|---------|----------------|
| Agent: {name} | {what happened} | {update instructions / create new agent / no change} |
| Skill: {name} | {what happened} | {update template / create new skill / no change} |
| Command: {name} | {what happened} | {add step / fix workflow / no change} |
| Memory | {pattern useful or missing} | {create pattern / update confidence / no change} |

## Doc Sync Summary
{Summary from `/check-sync` — note any architecture drift, story status drift, or dead references}
```

### 5. Extract Patterns to Memory (main agent)

After the agent completes, review its analysis for patterns to extract:

For any new patterns discovered, create memory entries:

```bash
node .claude/core/memory-manager.js create patterns "{pattern-id}" '{"description":"...", "confidence": 0.8}'
```

**Promote existing patterns:** If a pattern created by `/do` (confidence 0.6) was validated during this epic, update its confidence to 0.8+.

### 6. Commit (main agent)

Follow the **Post-Command Commit Convention** in CLAUDE.md. Stage all files created or modified by this command and commit with a descriptive message.

### 7. Report (main agent)

```markdown
## Retrospective Complete

**Output**: docs/.output/reviews/retro-{epic-slug}.md
**Patterns extracted**: {count}
**Key takeaway**: {1 sentence}

**Committed**: {hash} — `docs: /retro — {summary}`
**Next epic**: {name of next epic to implement}
```
