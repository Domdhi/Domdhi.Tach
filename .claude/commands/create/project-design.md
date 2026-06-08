---
description: Create UX design artifacts — spec, wireframes, themes, and mock layout
argument-hint: [project name or prd path] [--yolo]
---

# Create UX Design Suite

Create a complete UX design package. Produces all design artifacts in `docs/design/`.

## Telemetry (run first)

This command is user-typed, so it does not fire `PostToolUse:Skill` — without this it leaves no `command_invocation` row and fleet analytics under-count human-driven runs. Self-log the invocation before anything else (best-effort — if it fails, continue regardless):

```bash
node .claude/core/telemetry-log.js create:project-design
```

## Agent Delegation

> **Orchestration rule**: You (the main agent) handle upstream checks, mode detection, and user interviews. The `ux-designer` agent handles all artifact generation. Do NOT write design files inline — delegate via Task tool.

**Agent**: `ux-designer` (via Task tool with `subagent_type: "ux-designer"`)

## Output Files

| File | Description |
|------|-------------|
| `docs/_project-design.md` | Design system, principles, component inventory, interaction patterns |
| `docs/design/_wireframes.md` | ASCII wireframes for all key pages |
| `docs/design/_design.light.md` | Light theme color palette and tokens |
| `docs/design/_design.dark.md` | Dark theme color palette and tokens |
| `docs/design/_mock-layout.html` | Self-contained HTML mock of the application shell |
| `.claude/skills/brand-guidelines/SKILL.md` | Brand identity skill populated from UX spec |

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

- **Optional**: Read `docs/_project-brief.md` for brand/vision context (only if real, not template)
- **Optional**: Read existing design files in `docs/design/` for reference

### 2. Check for Existing Output (main agent)

- If any design files exist in `docs/design/` with content → ask: **update** or **replace**?
- Check for existing brand guidelines skill content

### 3. Detect Mode (main agent)

- If PRD has rich user flows → **Context Mode** (derive wireframes from flows)
- If PRD is minimal → **Interview Mode** (need design direction input)
- If existing code has UI → **Reverse-Engineering Mode** (document what exists)

#### 3a. Scope Check — full suite vs lightweight (F9)

The full output suite (spec + wireframes + light/dark themes + mock HTML + personas) is right for an app with real surface area. For a **small UI** — a browser-extension popup, a single options page, a CLI, a one-screen tool — it massively over-produces. Before generating, gauge the surface from the PRD/architecture/asset inventory and, if it's small, **ask the user** which scope they want:

- **Lightweight** (recommended for small UIs): a single `docs/design/_project-design.md` capturing layout, sizing, color/typography tokens, and component notes — skip separate wireframes/theme files/mock HTML/personas.
- **Full suite**: all output files below.

Do not default a 300px popup into the full persona-and-mock pipeline. When in doubt for anything larger than a few screens, full suite is fine.

### 4a. Interview Mode (main agent)

Use AskUserQuestion to gather design direction. Use the Interview Questions from the `ux-design` skill as the question bank — cover design philosophy, visual style, component library, layout approach, and device targets.

### 4b. Context Mode (main agent)

Synthesize a design brief from upstream docs:
- Extract user flows from PRD → derive page inventory
- Map FRs to UI components needed
- Identify data-dense pages (data grids, dashboards)
- Propose layout based on application type
- Note brand-guidelines skill if available

### 5. Delegate to Agent

Use the Task tool with `subagent_type: "ux-designer"` for each artifact.

**Task sequence** (respects dependencies):

1. **UX Spec** — `Task(ux-designer)`: MUST complete first (other files depend on it)
   - Prompt includes: PRD summary, design brief, user interview answers
   - Output: `docs/_project-design.md`
   - Agent auto-loads `ux-design` skill for template/quality criteria

2. **Wireframes + Themes** — Run in parallel after UX spec completes:
   - `Task(ux-designer)`: Create wireframes → `docs/design/_wireframes.md`
     - Prompt includes: reference to the UX spec just created, PRD user flows
   - `Task(ux-designer)`: Create light + dark themes → `docs/design/_design.light.md` and `docs/design/_design.dark.md`
     - Prompt includes: reference to the UX spec color system section

3. **HTML Mock** — `Task(ux-designer)`: After themes complete
   - Output: `docs/design/_mock-layout.html`
   - Prompt includes: reference to UX spec layout + dark theme tokens
   - Must be self-contained (inline CSS, no external dependencies)

**Each Task prompt must include**:
- What to produce and exact file path
- Reference to UX spec (after first task completes)
- Design brief / user preferences from the interview
The `ux-designer` agent auto-loads the `ux-design` skill via frontmatter — do NOT tell it to read the skill file.

### 6. Validate (main agent)

After all agents complete, verify each file:
- UX Spec: all required sections present (philosophy, typography, layout, components, interaction, responsive, accessibility)
- Wireframes: at least 2 pages with ASCII art, desktop AND mobile for primary pages
- Themes: semantic tokens used, WCAG contrast verified
- Mock Layout: self-contained HTML, responsive, uses correct color tokens

If any file fails validation, delegate back to the agent to fix.

### 6b. Sync Brand Guidelines Skill (main agent)

After all design artifacts pass validation, extract brand data from the generated `docs/_project-design.md` and write it into `.claude/skills/brand-guidelines/SKILL.md`.

**Extract from the UX spec:**
- Color palettes for all theme modes (light, dark) — name, HEX, RGB, usage
- Typography matrix — font families per mode, type scale (headline through code)
- CSS variable declarations (`:root` block with all tokens)
- Spacing scale (if defined)
- Accessibility contrast ratios (WCAG AA/AAA results for key pairs)

**Write rules:**
- **Preserve the frontmatter** (`name`, `description`) exactly as-is — only replace the markdown body below the closing `---`
- **Idempotent**: Always overwrite the body. The UX spec is the single source of truth for brand data
- Structure the body using the same sections as the existing template (Color Palette, Typography, CSS Variables, Usage) so downstream consumers don't break
- Append a **Source footer** at the bottom:

```markdown
---

> **Source**: Auto-populated from `docs/_project-design.md` by `/create:project-design` on {YYYY-MM-DD}.
> Re-run `/create:project-design` to update. Do not edit this file manually.
```

- Add `.claude/skills/brand-guidelines/SKILL.md` to the staged files for the commit step

### 7. Commit (main agent)

Follow the **Post-Command Commit Convention** in CLAUDE.md. Stage all files created or modified by this command and commit with a descriptive message.

### 8. Report (main agent)

```markdown
## UX Design Suite Complete

### Files Created
| File | Status |
|------|--------|
| `docs/_project-design.md` | Created |
| `docs/design/_wireframes.md` | Created |
| `docs/design/_design.light.md` | Created |
| `docs/design/_design.dark.md` | Created |
| `docs/design/_mock-layout.html` | Created |
| `.claude/skills/brand-guidelines/SKILL.md` | Updated |

**Design philosophy**: {1 sentence}
**Pages wireframed**: {count}
**Components identified**: {count}
**Themes**: {light/dark/both}

**Committed**: {hash} — `docs: /create:project-design — {summary}`
**Next step**: Run `/create:project-architecture` to make technical decisions.
```
