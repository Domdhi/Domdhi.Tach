# Domdhi.Agents working instructions

@.agents/startup.md

## This repository

Domdhi.Agents is the agent toolkit workshop. Shared workflows, skills, roles, helpers, hooks and templates are authored under `.agents/`; runtime metadata lives in `.agents/adapters/`. Native `.claude/` and `.codex/` entry points are generated compatibility surfaces. Preserve generated-output conflicts and project-owned customizations through the existing renderer/mergers.

Toolkit tests belong here. `node .claude/core/gate.js test` runs this repository's build and Vitest suite; test files colocate under `.agents/**/__tests__/`. Adopter application gates must never invoke this toolkit suite. Runtime hooks/helpers remain zero-dependency; npm dev dependencies are needed only for toolkit tests. Memory search uses Node 24 built-in SQLite, with the existing optional fallback/JSON scan on older runtimes.

## Task-triggered reference

Detailed toolkit guidance is retained in `.agents/startup-reference.md`. Read only the sections selected by the triggers in `.agents/startup.md`; do not load that entire reference for every task. Consult the invoked command/skill for its actual workflow and required verification.

Project-owned additions belong in this root file or marked blocks of the relevant canonical component. Installer/update guidance must preserve adopter root prose, identity/Project Context and local settings rather than replace them with this workshop's instructions.

# === Domdhi.Agents managed block — do not edit between markers ===
@.agents/startup.md
# === End Domdhi.Agents managed block ===
