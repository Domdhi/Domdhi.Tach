# Documentation Structure

Standard documentation layout for projects using the Domdhi.Agents template system.

## Folder Structure

```
docs/
├── _project-requirements.md  # Product requirements (WHAT, not HOW)
├── _project-architecture.md  # Tech stack, ADRs, system design (HOW)
├── _project-design.md        # Design system, components, themes, UX
├── _project-brief.md         # Strategic vision and project scope
├── _project-context.md       # Quick-reference: links, commands, current state
│
├── app/                      # Feature/module docs — mirrors the codebase
│   └── {module}/
│       ├── _brief.md         # Scope, key files, dependencies (always present)
│       └── ...               # Any other module-specific docs as needed
│
├── design/                   # UX specs, wireframes, themes, mock layout
│
├── todo/                     # Implementation checklists
│   └── _backlog.md           # Epic definitions (source of truth)
│
└── .output/                  # Operational output (partly gitignored — see note)
    ├── handoffs/             # Session continuity (per-session/branch, via handoff-path.js)
    ├── reviews/              # Code review, security audit, readiness results
    ├── investigations/       # Root cause analysis
    ├── research/             # General (non-feature) research
    ├── plans/                # Execution plans
    ├── memories/             # Daily logs + compiled concept articles
    ├── telemetry/            # Command usage logs, gate build/test logs
    └── work/                 # Task working files from /todo, /run-todo
```

## Conventions

- **`_project-` prefix** = product-wide docs at the root (requirements, architecture, design, brief, context)
- **`_brief.md`** = module-level scope doc (always present in `app/{module}/`)
- **`app/` mirrors the codebase** — one folder per feature module, structure matches `app/` in source
- **Docs grow with the module** — start with `_brief.md`, add more docs when the module needs them
- **Root-level docs are product-wide** — `_project-requirements.md` covers all features, `_project-architecture.md` covers all ADRs
- **`.output/` is operational** — generated artifacts, reviews, and telemetry live here. Only the regenerable/session-specific subdirs are gitignored (`memories/`, `telemetry/`, `screenshots/`, `sessions/`, and the generated `status.html`/`decisions.html`); the durable records (`plans/`, `reviews/`, `research/`, `investigations/`, `work/`) are **tracked**

## Adding a New Module

```bash
mkdir -p docs/app/{module-name}
# Create _brief.md with: scope, key files, dependencies
```

## Where To Look

| Need To... | Look Here |
|------------|-----------|
| Understand the product | `docs/_project-requirements.md` |
| Understand the tech stack | `docs/_project-architecture.md` |
| Understand the design system | `docs/_project-design.md` |
| Understand a specific module | `docs/app/{module}/_brief.md` |
| Track implementation | `docs/todo/` |
| Find reviews and audits | `docs/.output/reviews/` |
| Session continuity | `docs/.output/handoffs/` (latest, via handoff-path.js) |
