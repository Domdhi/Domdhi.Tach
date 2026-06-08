---
description: Create a technical architecture document with tech stack decisions, ADRs, and system design
argument-hint: [project name or prd path] [--yolo]
---

# Create Architecture

Create a technical architecture document. Produces `docs/_project-architecture.md`.

## Telemetry (run first)

This command is user-typed, so it does not fire `PostToolUse:Skill` — without this it leaves no `command_invocation` row and fleet analytics under-count human-driven runs. Self-log the invocation before anything else (best-effort — if it fails, continue regardless):

```bash
node .claude/core/telemetry-log.js create:project-architecture
```

## Agent Delegation

> **Orchestration rule**: You (the main agent) handle upstream checks, mode detection, and user interviews. The `architect` agent handles document generation. Do NOT write the architecture document inline — delegate via Task tool.

**Agent**: `architect` (via Task tool with `subagent_type: "architect"`)

## Variables

INPUT: $ARGUMENTS

## Workflow

### 1. Check Upstream (main agent)

#### 1a. Check --yolo flag
If `$ARGUMENTS` contains `--yolo`, set YOLO_MODE = true. Strip `--yolo` from INPUT before continuing.

#### 1b. Hard Gate: Require real PRD
Read the first line of `docs/_project-requirements.md`. Check that it exists AND does not contain `<!-- @@template -->`.

**If `docs/_project-requirements.md` is missing or template-only:**
- If YOLO_MODE → warn: "No PRD found. Proceeding in yolo mode with Interview Mode." → go to Interview Mode
- Otherwise → **STOP**: "`docs/_project-requirements.md` has not been created yet. Run `/project-requirements` first. Use `--yolo` to bypass this gate."

- **Optional**: Read `docs/_project-design.md` for component/UI requirements (only if real, not template)
- **Optional**: Read `docs/_project-brief.md` for constraints (only if real, not template)
- **Optional**: Read `docs/app/*/research.md` or `docs/.output/research/**` for technical research findings

### 2. Check for Existing Output (main agent)

- If `docs/_project-architecture.md` exists → ask: **update** or **replace**?

### 3. Detect Mode (main agent)

- If PRD + UX spec exist → **Context Mode** (derive architecture from requirements)
- If only PRD exists → **Context Mode** with interview for tech decisions
- If existing codebase → **Reverse-Engineering Mode** (document current architecture)

### 4a. Interview Mode (main agent)

Use AskUserQuestion to gather tech decisions. Use the Interview Questions from the `architecture` skill as the question bank — cover deployment, tech stack, scale, security, and team constraints.

### 4b. Context Mode (main agent)

Synthesize a context brief from upstream docs:
- Extract NFRs from PRD → quality attributes
- Extract data model from PRD → data architecture needs
- Extract security requirements from PRD → auth model needs
- Extract API surface from PRD → API architecture needs
- Extract constraints from project brief → tech choices
- Extract UI requirements from UX spec → frontend architecture needs

### 5. Delegate to Agent

Use the Task tool with `subagent_type: "architect"` to generate the architecture document.

**Task prompt must include**:
1. Project name and what to produce (`docs/_project-architecture.md`)
2. Summary of upstream context (PRD modules, NFRs, data model, security requirements, API surface)
3. User's tech decisions from interview (if any)
4. Mode (Context/Interview/Reverse-Engineering)

The `architect` agent auto-loads the `architecture` skill via frontmatter — do NOT tell it to read the skill file.

### 6. Validate (main agent)

After the agent completes, read `docs/_project-architecture.md` and validate against the `architecture` skill's **Required Sections Checklist**. If any section is missing, delegate back to the agent to fill it.

### 7. Commit (main agent)

Follow the **Post-Command Commit Convention** in CLAUDE.md. Stage all files created or modified by this command and commit with a descriptive message.

### 8. Report (main agent)

```markdown
## Architecture Complete

**Output**: docs/_project-architecture.md
**Architecture style**: {monolith/microservices/etc.}
**Tech stack**: {backend} + {frontend} + {database}
**ADRs**: {count} decisions documented
**Components**: {count} defined

**Committed**: {hash} — `docs: /create:project-architecture — {summary}`
**Next step**: Run `/create:project-epics` to break requirements into implementable stories.
```
