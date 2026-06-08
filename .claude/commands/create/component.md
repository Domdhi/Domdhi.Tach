---
description: Create a new agent, command, or skill following established conventions
argument-hint: [agent|command|skill] [name] [description]
---

# Create Component

Create a new agent, command, or skill in the `.claude/` system. Ensures proper structure, frontmatter, wiring, and consistency with the three-tier architecture.

## Telemetry (run first)

This command is user-typed, so it does not fire `PostToolUse:Skill` — without this it leaves no `command_invocation` row and fleet analytics under-count human-driven runs. Self-log the invocation before anything else (best-effort — if it fails, continue regardless):

```bash
node .claude/core/telemetry-log.js create:component
```

## Variables

INPUT: $ARGUMENTS

- `INPUT` (required): Format: `{type} {name} {description}`. Type is `agent`, `command`, or `skill`. Name is kebab-case. Description is natural language.

## Workflow

### Step 1: Parse Input & Load the Type-Specific Creator Skill

Parse `INPUT` into:
- **type**: agent | command | skill
- **name**: kebab-case identifier
- **description**: what it does and when to use it

If any part is ambiguous, ask with `AskUserQuestion`.

Then load the creator skill for that type (each owns its template, field rules, and wiring checklist):

```
agent   → Read .claude/skills/agent-creator/SKILL.md
command → Read .claude/skills/command-creator/SKILL.md
skill   → Read .claude/skills/skill-authoring/SKILL.md   (doctrine + toolkit conventions; use skill-creator for the create→eval→improve loop)
```

The shared three-tier architecture + "no duplication between layers" rule lives in CLAUDE.md.

### Step 2: Check for Conflicts

**For agents:**
```
Read .claude/agents/{name}.md — must NOT exist
Glob .claude/agents/*.md — check for role overlap
```

**For commands:**
```
Read .claude/commands/{name}.md OR .claude/commands/create/{name}.md OR .claude/commands/review/{name}.md — must NOT exist
```

**For skills:**
```
Read .claude/skills/{name}/SKILL.md — must NOT exist
```

If a conflict exists, report it and ask the user whether to update the existing component or create with a different name.

### Step 3: Gather Context

**For agents** — determine:
- Model tier: planning (`inherit`), implementation (`sonnet`), or documentation (`sonnet`)?
- Tools needed: implementation set, research set, or read-only set?
- Existing skills to wire, or does a new skill need to be created too?
- Which commands will delegate to this agent?

**For commands** — determine:
- Category: setup (`create/`), review (`review/`), or build loop (top-level)?
- Does it commit or is it read-only?
- Which agents does it delegate to?
- What prerequisites (gates) does it require?

**For skills** — determine:
- Which agent(s) will load this skill?
- Does it provide a document template, quality criteria, interview questions, or reference material?
- Is there an existing skill it might overlap with?

If the description doesn't make the answers obvious, ask with `AskUserQuestion` — one focused question covering the key decisions, not a multi-part interview.

### Step 4: Generate

Follow the template in the type-specific creator skill loaded in Step 1 exactly. Write the file:

- **Agent** → `.claude/agents/{name}.md`
- **Command** → `.claude/commands/{name}.md` (or `create/` or `review/` based on category)
- **Skill** → `.claude/skills/{name}/SKILL.md`

The generated content must:
- Use the exact frontmatter field order from the skill template
- Include all required sections from the body structure template
- Have a distinct personality/perspective (agents) — not generic
- Reference real file paths and agent names (commands) — not placeholders
- Contain domain knowledge, not orchestration (skills) — not process steps

### Step 5: Wire It Up

**For agents:**
- If skills were specified, verify they exist. If a new skill is needed, create it first (repeat Step 4 for the skill).
- Check if any existing command should delegate to this agent. If so, note it in the report (don't modify commands automatically).

**For commands:**
- Verify all agents referenced in the workflow exist.
- If the command uses a new agent, note it in the report.

**For skills:**
- Update the agent(s) that should load this skill — add the skill name to their frontmatter `skills:` list.

### Step 6: Verify

Run the wiring checklist from the type-specific creator skill (loaded in Step 1) against the created component. Report any issues. For skills, also run `node .claude/core/skill-conformance.js` to confirm name/dir match, description CSO, and the ≤500-line budget.

### Step 7: Commit

Follow the **Post-Command Commit Convention** in CLAUDE.md. Stage all files created or modified.

### Step 8: Report

```markdown
## Component Created

**Type:** {agent|command|skill}
**Name:** {name}
**File:** {path}

### Wiring
| Connection | Status |
|-----------|--------|
| {skill → agent} | {Wired / Needs manual wiring} |
| {agent → command} | {Wired / Needs manual wiring} |

### Checklist
- [x] {checks that passed}
- [ ] {any manual steps remaining}

**Committed**: {hash} — `feat: /create:component — {summary}`
```

## Examples

```
# New agent
/create:component agent data-engineer ETL pipeline design, data modeling, and migration strategy

# New command
/create:component command remember Query-driven memory enrichment that captures Q&A to daily log

# New skill
/create:component skill supabase-postgres Supabase + PostgreSQL patterns including RLS, edge functions, and migrations
```

## Anti-Patterns

- **DO NOT create agents that overlap with existing ones** — check the inventory first
- **DO NOT put orchestration logic in skills** — that belongs in commands
- **DO NOT put domain knowledge in commands** — that belongs in skills
- **DO NOT create a skill without wiring it to at least one agent**
- **DO NOT generate generic personalities** — every agent needs a distinct point of view
