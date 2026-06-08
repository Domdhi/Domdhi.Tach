---
description: Research and validate market, technical, or domain assumptions
argument-hint: [research topic or question]
---

# Research

Conduct structured research to validate assumptions. Output is **context-bundled** — if researching a specific feature/module, output goes to `docs/app/{feature}/research.md`. If general, output goes to `docs/.output/research/{YYMMDD-HHMM}-{slug}.md`.

## Telemetry (run first)

This command is user-typed, so it does not fire `PostToolUse:Skill` — without this it leaves no `command_invocation` row and fleet analytics under-count human-driven runs. Self-log the invocation before anything else (best-effort — if it fails, continue regardless):

```bash
node .claude/core/telemetry-log.js research
```

## Agent Delegation

> **Orchestration rule**: You (the main agent) handle mode detection, scoping, and output path. The `product-strategist` agent handles research execution and synthesis. Do NOT conduct research inline — delegate via Task tool.

**Agent**: `product-strategist` (via Task tool with `subagent_type: "product-strategist"`)

## Variables

INPUT: $ARGUMENTS

## Workflow

### 1. Detect Mode & Output Path (main agent)

- If INPUT provided → use as research topic
- If no INPUT → ask user what needs to be researched

**Determine output path:**
```
IF researching a specific feature/module with docs/app/{name}/:
  OUTPUT_PATH = docs/app/{name}/research.md
ELIF researching a specific feature/module (new):
  mkdir -p docs/app/{name}/
  OUTPUT_PATH = docs/app/{name}/research.md
ELSE (general/project-wide):
  OUTPUT_PATH = docs/.output/research/{YYMMDD-HHMM}-{slug}.md
```

If unclear whether it's feature-scoped or general, ask with AskUserQuestion.

If output file already exists → ask: **append** findings or **start fresh**?

### 2. Define Research Questions (main agent)

If INPUT is a broad topic, break it into specific questions. This step has two prompts of different types:

- **Free-form prompt** (plain conversational ask, NOT `AskUserQuestion`): "What specific questions do you need answered?" — expects a paragraph answer with multiple sub-questions.
- **Closed-choice question** (use `AskUserQuestion` with concrete options): "What type of research?" with options Market / Technical / Domain / Competitive.

### 3. Delegate to Agent

Use the Task tool with `subagent_type: "product-strategist"` to conduct the research.

**Task prompt must include**:
1. Research questions (specific, not vague)
2. Research type (market/technical/domain/competitive)
3. Where to write output (`{OUTPUT_PATH}`)
4. Whether to append to existing research or start fresh
5. The `product-strategist` agent auto-loads the `project-planning` skill via frontmatter.
6. Instruction to: state questions upfront, document methodology, present findings with confidence levels, cite sources

**For multiple research topics**, launch parallel Task calls — one per topic:
- `Task(product-strategist)`: Research topic A → writes to `{OUTPUT_PATH}` or separate files
- `Task(product-strategist)`: Research topic B
- Main agent consolidates if needed

### 4. Consolidate (main agent)

After agent(s) complete:
- If multiple parallel research tasks ran, read all raw outputs
- Consolidate into `{OUTPUT_PATH}`
- Ensure consistent formatting and source citation

### 5. Commit (main agent)

Follow the **Post-Command Commit Convention** in CLAUDE.md. Stage all files created or modified by this command and commit with a descriptive message.

### 6. Report (main agent)

```markdown
## Research Complete

**Output**: {OUTPUT_PATH}
**Questions investigated**: {count}
**Key findings**: {1-2 sentence summary}

**Committed**: {hash} — `docs: /research — {summary}`
**Next step**: Run `/create:project-brief` to capture strategic vision, or `/create:project-requirements` if requirements are clear.
```
