# Project Context

Defines the format for `docs/_project-context.md` — the single-file quick reference that `/prime` loads first in every session.

## Document Template

The document you produce — the canonical, scaffold-blessed template — lives in `../assets/_project-context.md` (raw, with the `<!-- @@template -->` first-line marker). Read it to know the artifact's structure; `scaffold.js` seeds `docs/_project-context.md` from the same file.

## Maintenance Rules

- **Updated by**: scaffold.js (creates), `/end` (updates state), `/do` (updates active work)
- **Read by**: `/prime` (first thing loaded each session)
- **Frequency**: Should be updated after every completed story or significant change
- Keep it under 100 lines — it's a quick reference, not documentation

## Quality Criteria

### Good _project-context.md
- Can understand the project in 30 seconds by reading this file
- All doc links are valid
- Current state reflects actual progress
- Tech stack summary matches _project-architecture.md

### Bad _project-context.md
- Outdated state (shows stories as pending that are done)
- Broken doc links
- Missing architecture summary
- No current state section

## Cross-References
- Created by: scaffold.js
- Updated by: `/end`, `/do`
- Read by: `/prime`
