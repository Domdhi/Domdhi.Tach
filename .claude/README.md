# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project

Domdhi.Agents is a portable `.claude/` directory template for AI-assisted software development. Drop it into any project for structured workflows from idea to implementation using slash commands, native subagents, and a memory system. Tech-agnostic until specialized via `/review:specialize`.

## Three-Tier Architecture

```
Commands (.claude/commands/**/*.md)   — Orchestration (gates, interviews, delegation, validation, commit)
Agents (.claude/agents/*.md)          — 11 subagents with personalities, auto-load skills via frontmatter
Skills (.claude/skills/*/SKILL.md)    — Domain knowledge (templates, quality criteria, checklists)
```

**No duplication between layers.** Commands reference skill checklists — they don't copy them. Agents auto-load skills via frontmatter — commands don't tell them to read skill files.

## Agents

| Agent | Model | Role | Skills |
|-------|-------|------|--------|
| `product-strategist` | sonnet ⇡ | Brainstorming, research, briefs, PRDs | project-planning |
| `architect` | sonnet ⇡ | System design, ADRs, tech stack | architecture |
| `ux-designer` | sonnet ⇡ | UX specs, wireframes, themes | ux-design, brand-guidelines, tailwind-css-patterns, design-taste-frontend, redesign-existing-projects |
| `project-planner` | sonnet ⇡ | Epics, stories, backlog | project-planning |
| `general-purpose` | sonnet ⇡ | Code implementation | full-output-enforcement, systematic-debugging, verification-before-completion, finishing-a-development-branch, using-git-worktrees |
| `code-reviewer` | sonnet ⇡ | Code quality review (read-only) | code-review |
| `security-auditor` | **opus** 🔒 | Security review (write scope: reviews only) | code-review |
| `qa-engineer` | sonnet | Test strategy and execution | qa-engineer |
| `doc-writer` | sonnet | Documentation and changelogs | project-planning, documentation |
| `playwright` | sonnet | Browser testing and automation | playwright-cli |
| `shadow` | sonnet | Voice-matched ghostwriting and articles | ghostwriting, content-formats |

Model column: `sonnet ⇡` = Sonnet floor, escalates to Opus per-dispatch (dual-use — see its `## Model Routing` block); `opus 🔒` = pinned Opus, no downgrade; bare `sonnet` = always Sonnet, no escalation path.

**Model hierarchy (Sonnet floor + Opus escalated per-dispatch):** Sonnet is the floor for all subagent work; the main session (Opus) plans, verifies, and owns the TaskList. Opus is **escalated per-call** for high-stakes subagent work — new ADRs, HIGH-risk code review, strategic briefs, multi-component refactors — and **pinned** for `security-auditor` (always Opus, never downgraded). Haiku is not used for agent work (it fabricates results). `inherit` resolves to the **main-session model** — nothing more (it does NOT "become Opus when called from a command"; that earlier claim was false). **Resolution precedence:** `CLAUDE_CODE_SUBAGENT_MODEL` env var > per-call `model` param > frontmatter `model:` > main-session model. Because a call-time `model` pin overrides frontmatter, a command **escalates by passing `model: opus`** and **stays on the floor by omitting `model`** — it must never pin a *cheaper* model than an agent's floor (that silently overrides it).

**Model Policy (floor + escalation, two layers):** Each agent's frontmatter `model:` is its **floor** — the single place to change its baseline tier. Dual-use agents (`sonnet ⇡`) carry a `## Model Routing` block stating when to escalate; the **dispatching command** is the enforcement layer — it encodes that routing deterministically, passing `model: opus` for the high-stakes cases and omitting `model` otherwise. `security-auditor` is pinned Opus; commands must never pass it a cheaper override. **Kill-switch:** `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` (in gitignored, publish-excluded `.claude/settings.local.json`) routes ALL subagents to Sonnet for a budget session — never commit it, and never leave it on for a session that runs `security-auditor`. **Review tiers:** `/review:code-review` is **risk-routed** — HIGH-risk-tier changes dispatch `code-reviewer` with `model: opus`; LOW/MEDIUM changes use the Sonnet floor. `review.backup` (for `--deep`/`--council`) = the **opposite tier from the primary** (cross-tier diversity, not a re-run), referenced as `{review.backup}`, never hardcoded.

**Native types:** Commands also use `Explore` (Claude Code's built-in research agent) — not a custom agent in `.claude/agents/`.

**Agent-shape exception:** `shadow` intentionally omits the standard `## Skills` section and role-suffix heading — its prose persona is its convention. `/review:check-templates` treats Shadow as conforming.

`/review:specialize` creates stack-specific agents from the architecture doc. `/review:personalize` gives agents names and personalities.

## Commands

### Setup (run once per project)
- `/brainstorm` — Guided ideation → `_brainstorm.md` + `_feature-ideas.md`
- `/research` — Validate assumptions → `_research.md`
- `/interview` — Interactive Q&A to gather requirements
- `/create:project-brief` — Strategic vision → `_project-brief.md`
- `/create:project-requirements` — PRD with FRs/NFRs → `_project-requirements.md`
- `/create:project-design` — UX spec, wireframes, themes, mock → `docs/design/`
- `/create:project-architecture` — Tech stack, ADRs → `_project-architecture.md`
- `/create:project-epics` — Break requirements into stories → `todo/_backlog.md`
- `/create:project-todo` — Master implementation index → `TODO_{ProjectName}.md`
- `/create:project-epics-todo` — Per-epic story checklists → `todo/TODO_epic{NN}.md`
- `/create:component` — Create a new agent, command, or skill following conventions
- `/create:new-project` — Master orchestrator — scaffolds `docs/` and walks the full planning pipeline
- `/onboard` — Brownfield bootstrapper — reverse-engineers `_project-architecture.md` + `_project-context.md`; merges CLAUDE.md additively; chains `/review:specialize`

### Build Loop (daily)
- `/prime` — Load context at session start from the latest per-branch handoff (resolved via `handoff-path.js`) + git log
- `/todo` — Create execution-ready checklist with research, AC, wave plan, self-review
- `/do` — Execute one task: size-aware (Opus direct or Sonnet delegate) → gate → AC verify → commit
- `/run-todo` — Execute entire checklist with wave-based execution, AC gates, auto-commit
- `/run-tests` — Manual/E2E testing with parallel playwright agents, screenshots, status protocol. **Canary Mode** (`--baseline` / `--compare {baseline.json}` / `--tolerance N`) adds post-deploy golden-signal monitoring. Full canary = `/loop 60s /run-tests --compare …` (scheduling is `/loop`'s job; no standalone `/canary`). → `docs/.output/canary/`
- `/end` — Save handoff context → `docs/.output/handoffs/{stamp}-{caller}-{branch}.md`

### Supporting
- `/create:module` — Add new feature area → `docs/app/{module}/` + TODO checklist
- `/investigate` — Structured debug investigation with root cause analysis → `docs/.output/investigations/`
- `/remember` — Capture a conversational insight to the daily log
- `/listen` — **Post-MVP Tier 1:** aggregate signals (git, telemetry, agent-updates, backlog drift, external) → `docs/.output/intake/{date}.md`. For when the backlog drains and work shifts from pull-from-plan to push-from-reality. Pairs with `/triage`.
- `/triage` — **Post-MVP Tier 2:** turn a `/listen` intake into ranked backlog stories. Scores **Severity** objectively, then decides **Priority** (promote/defer/kill/research) — auto-deciding mechanical calls, interviewing only genuine judgment calls. Kills/defers land in an append-only ledger (`docs/.output/triage/_decisions.md`). Severity≠Priority + the durable ledger are the load-bearing ideas. → `docs/todo/_backlog.md`
- `/evolve` — **Post-MVP Tier 3:** cycle rollover when the backlog is *fully delivered*. Archives drained `_backlog.md`/`TODO_*.md` to `docs/todo/_archive/cycle-{N}-{stamp}/` via `git mv` (history-preserving) + `_cycle-summary.md`, then regenerates the cycle N+1 plan from production evidence (intake + retros + deferred items), not a blank interview. Gated; `--force` carries incomplete forward; architecture carries forward unless `--replan-arch`; `--dry-run` previews.

### Review (periodic)
- `/review:code-review` — Risk-tiered architecture compliance review (read-only). `--deep` adds a cross-model second opinion (Sonnet+Opus); `--council` runs an N-reviewer council (one `code-reviewer` per lens — correctness/security/architecture/performance — → anonymized cross-validation → Opus chairman, aggregated by `council.js`). Single-vendor by design; the survival rule rewards independent confirmation, never agreement.
- `/review:feedback` — Template-performance report: telemetry digest (`feedback-digest.js`) + agent self-review → `docs/.output/reviews/feedback-{date}.{md,json}`. Auto-chained by `/onboard` + `/create:new-project`. Fleet rollup: `npm run feedback:rollup -- <projectDir>…` (maintainer-only).
- `/review:security` — OWASP audit, vulnerability detection, secret scanning → `docs/.output/reviews/`
- `/review:qa` — Generate tests for existing code
- `/review:check-readiness` — Gate check before implementation (read-only)
- `/review:check-sync` — Detect documentation drift (read-only)
- `/review:check-templates` — Audit `.claude/` system health — orphaned agents, unused skills, missing hooks
- `/review:update-docs` — Fix drift found by check-sync
- `/review:optimize-backlog` — Dependency graph, critical path analysis
- `/review:retro` — Epic retrospective + pattern extraction
- `/review:changelog` — Release notes from stories + git
- `/review:specialize` — Customize agents for your tech stack
- `/review:optimize-agents` — Re-align agents with actual codebase
- `/review:evolve-skills` — **Self-improving skills:** mines `agent-updates` misalignments (IMPROVE) + clustered `workflows`/`patterns` memories (CREATE) into skill proposals, gated by a differential eval (`with_skill` must beat baseline, via `skill-eval.js`). Drives `skill-creator`; wired into `/sweep` Phase 5b as propose-only.
- `/review:personalize` — Give agents names and personalities
- `/review:memory-health` — Compile + lint + decay report (headless-compatible)
- `/review:promote-memories` — Surface high-confidence concepts for promotion to templates/skills
- `/sweep` — Autonomous post-work maintenance: code-review → retro → implement recs → promote → optimize-agents → defrag → memory-health, one auto-approved pass (defrag LAST on the grown store). Per-phase commits, resumable Phase Log, final report.
- `/review:timeline` — Generate/update weekly commit history → `_project-timeline.md`
- `/review:status` — Parse TODO files, show progress, HTML dashboard → `docs/.output/status.html` (chat-only)
- `/review:organize` — Move plan files to dated folders (chat-only; runs `organize.cjs`)

## Document Naming

All generated docs use an underscore prefix in `docs/`. Producers: `_project-brief.md` (`/create:project-brief`), `_project-requirements.md` (`/create:project-requirements`), `_project-architecture.md` (`/create:project-architecture`), `_project-design.md` (`/create:project-design`), `todo/_backlog.md` (`/create:project-epics`), `.output/handoffs/{stamp}-{caller}-{branch}.md` (`/end` + `/do` + `/run-todo` + `/run-tests` + `/todo` — per-session/per-branch, resolved by `handoff-path.js`), `_project-context.md` (scaffold.js), `_project-timeline.md` (`/review:timeline`).

`/brainstorm` is a dynamic utility command — it always writes the seed `_brainstorm.md`, plus topic-driven satellites (e.g. `_feature-ideas.md`) as the session warrants, not a fixed schema.

### Directory Structure
```
docs/
├── _project-*.md          # Planning pipeline documents
├── design/                 # UX spec, wireframes, themes, mock layout
├── todo/                   # _backlog.md, _feature-ideas.md, TODO_epic*.md
│   └── _archive/           # /evolve: cycle-{N}-{stamp}/ — closed cycles
├── app/{module}/           # Feature-scoped: _brief.md, brainstorm.md, research.md
└── .output/                # All operational output
    ├── reviews/ investigations/ research/ plans/ telemetry/
    ├── handoffs/           # /end + /do + /run-todo + /run-tests + /todo per-session handoffs
    ├── memories/           # Auto-compounded daily logs + compiled concepts
    ├── intake/             # /listen signal intake ({YYYY-MM-DD}.md, day-rotated)
    ├── triage/             # /triage records + _decisions.md ledger (append-only)
    ├── canary/             # /run-tests canary: baseline-{slug}.json + {date}/canary-{HH:MM}.md
    ├── skill-evolution/    # /review:evolve-skills: intake + {skill}-workspace/iteration-N + proposals.md
    └── agent-updates/      # Agent misalignment feedback ({YYYY-MM-DD}.md, day-rotated)
```

## Template Marker Convention

Template files contain `<!-- @@template -->` as their first line; `scaffold.js` preserves it when copying into `docs/`. **Hard gate checks treat files with this marker as non-existent.** When a command fills a template it writes new content *without* the marker — distinguishing "scaffolded but unfilled" from "actually created."

**Skill-owned document templates live in each producing skill's `assets/`** (e.g. `ux-design/assets/_project-design.md`, `project-planning/assets/_backlog.md`) — single-sourced so skill and scaffold share one copy. `scaffold.js` seeds `docs/` from them via `SKILL_TEMPLATE_MANIFEST`. Only no-owner templates remain in `.claude/templates/`: the `CLAUDE.md` docs-structure guide and `root/` configs.

## Skill Authoring & Spec Conformance

Skills follow the [Agent Skills open standard](https://agentskills.io/specification). Enforced by `node .claude/core/skill-conformance.js` (wired into `/review:check-templates` Step 2b): `SKILL.md` body ≤ 500 lines (WARN), `name` frontmatter must equal the parent directory name (ERROR), `description` ≤ 1024 chars (ERROR).

**`description` content (CSO):** state **both** what the skill does (a brief clause) **and** when to use it, keeping the `"Use WHEN… Triggers: …"` structure. Naming *what it covers* is fine; **never summarize the step-by-step workflow** — that lets Claude follow the description as a shortcut and skip the body. (Authoritative: `skill-authoring/SKILL.md`.)

**Progressive disclosure** — move heavy content out of `SKILL.md` into spec subdirectories, one logical unit per file, referenced one level deep: `references/` (read on demand), `assets/` (copied into output — **the scaffold source of record** for doc templates, raw with the marker, wired into `SKILL_TEMPLATE_MANIFEST`), `scripts/` (executable code). The split is the largest recurring token win: the whole `SKILL.md` loads on every activation; subdirectory files load only when a pointer calls for them. When relocating content, move it **verbatim** (byte-for-byte) and verify with a set-difference against the git blob — do not paraphrase.

**Skill doctrine & evolution** (2026-06-06, ADR `docs/.output/reviews/2026-06-06-adr-self-improving-skills.md`): the old `skill-authoring` "**failing test FIRST**" Iron Law was replaced by **evidence-of-a-gap-first + differential-eval-after** (`with_skill` must beat `without_skill`/`old_skill`) — one rule for human and machine authoring. The operational loop is the ported **`skill-creator`** skill (Create/Eval/Improve/Benchmark; zero-dep harness in `skill-eval.js`). The autonomous driver is **`/review:evolve-skills`**. `skill-authoring` owns *doctrine*; `skill-creator` owns *mechanics*.

## Hard Gates

Create commands enforce prerequisite checks (real, non-template files) to prevent out-of-sequence execution:

| Command | Requires |
|---------|----------|
| `/create:project-requirements` | One of: `_project-brief.md`, `_brainstorm.md`, `_research.md` |
| `/create:project-architecture` | `_project-requirements.md` |
| `/create:project-epics` | `_project-requirements.md` AND `_project-architecture.md` |
| `/create:project-design` | `_project-requirements.md` |
| `/create:project-todo`, `/create:project-epics-todo`, `/review:optimize-backlog` | `todo/_backlog.md` |
| `/review:check-readiness` | Required docs PLUS no unacknowledged epic overlaps in `_backlog.md` (`epic-overlap.js`) |

**`--yolo`** bypasses hard gates (downgrades to warnings) — an explicit user override only.

**Gate posture (F3):** hitting a hard gate means *generate the missing prerequisite, then resume* — not bypass. Commands must never present "proceed off the stub/stale doc" or `--yolo` as the **Recommended** option in a clarifying question. **Enforcement (F8):** gate checks (the `<!-- @@template -->` first-line test) are instruction-level, not tool-enforced — they rely on the agent performing the check. `doc-drift.js`'s `isRealDoc()` is the reusable tool-checkable primitive (real doc vs scaffold stub).

## TODO Hierarchy

```
/create:project-epics       →  docs/todo/_backlog.md        (epic definitions — source of truth)
/create:project-todo        →  docs/TODO_{Project}.md       (master index — epic-level status)
/create:project-epics-todo  →  docs/todo/TODO_epic{NN}.md   (per-epic checklists — story tasks)
/do | /run-todo             →  picks task, implements, updates checklists
```

## Build & Test Gate

`gate.js` auto-detects the build system: `package.json` → `npm run build`/`npm test`; `Cargo.toml` → cargo; `go.mod` → go; `*.sln`/`*.csproj` → dotnet; `pyproject.toml` → ruff+mypy/pytest; `Makefile` → make. Override with `gate.config.json`.

**This repo (self-hosted):** `package.json` at the repo root means `node .claude/core/gate.js test` auto-detects `node` and runs the real Vitest suite — no `gate.config.json` needed. `_latest-summary.json` records `{ stack, overall, ... }`.

## Publishing

Two-repo workflow: this private workshop publishes a curated subset to a public storefront (`Agents.Domdhi`).

```bash
npm run publish:public -- <path-to-public-repo> --dry-run   # preview
npm run publish:public -- <path-to-public-repo>             # do it
```

Ships only what `tools/publish-manifest.json` (the allowlist) permits. A hardcoded `DEFAULT_EXCLUDES` in `tools/publish.js` always strips working state (`docs/.output/**` — which covers handoffs — `docs/todo/**`, `docs/research/**`, `docs/app/**`, `docs/design/**`, `.claude/settings.local.json`, `.claude/agent-memory/**`, `tools/**`, etc.) even if the manifest would match.

**Publish vs update — two operations.** Use `publish:public` for the FIRST publish to an empty target (creates the target's `.claude/`). For incremental sync to an existing `.claude/`-bearing project, use `node .claude/core/template-updater.js update <path>` — it enforces the zone model (Template/Project/Mixed) to preserve customizations.

### Fleet orchestration

`publish:public` and `template-updater` act on **one** repo. The fleet (every adopter that carries a copy of `.claude/`) is driven from a single roster, `tools/fleet.json` (storefront + adopters with `path`/`branch`/optional `exclude` reason). `tools/fleet.js` wraps the per-repo CLIs into one roster-driven pass with a consolidated pass/fail rollup, so the fleet list lives in a file, not in prose.

```bash
npm run fleet:status                                  # roster + each adopter's version vs the workshop
npm run fleet:sync -- --dry-run                       # preview a fleet-wide template-updater --merge + orphan scan
npm run fleet:sync                                    # sync all active adopters, gate each, rollup
npm run fleet:sync -- --prune-orphans                 # also delete template fossils (+ their colocated tests)
npm run fleet:release -- --note "<changelog prose>"  # gate workshop → bump version.json → publish → sync → rollup
```

**Safety model:** adopters are **never committed/pushed** — `fleet.js` only writes their working trees; you review + commit each by hand (the rollup says so). `release` requires `--note` (the version bump is mechanical bookkeeping — `--bump minor|major` on the two-part `X.Y` version — but the changelog prose is never fabricated) and **gates the workshop before publishing** so a red template aborts. **Orphan detection** uses the git-history intersection (a file is a fossil only if the template once shipped it *and* no longer does) confined to template-owned subtrees (`commands/ core/ hooks/ skills/ templates/` — never `agents/` or `settings*`); orphans are **report-only** unless `--prune-orphans` is passed. Excluded adopters (e.g. Domdhi.DMO with its unprovisioned `.venv`) are skipped, not deleted from the roster.

## Output Persistence Convention

**All agent output MUST be written to a file before reporting to chat.** Work that only exists in chat is lost on compaction. No exceptions.

**Path rules** (by output type): planning docs → `docs/_project-*.md`; feature-scoped research/brainstorm/investigation → `docs/app/{feature}/`; general research → `docs/.output/research/`; reviews & audits (incl. `retro-{epic-slug}.md`) → `docs/.output/reviews/`; investigations → `docs/.output/investigations/`; execution plans → `docs/.output/plans/`; session handoffs → `docs/.output/handoffs/{stamp}-{caller}-{branch}.md` (resolved via `handoff-path.js`); task working files → `docs/.output/work/{date}/{task}/`; status/metrics → `docs/.output/`; telemetry → `docs/.output/telemetry/`; agent feedback → `docs/.output/agent-updates/{date}.md`; signal intake → `docs/.output/intake/{date}.md`; triage → `docs/.output/triage/{date}.md` + `_decisions.md`; cycle archive → `docs/todo/_archive/cycle-{N}-{stamp}/`; canary → `docs/.output/canary/`; skill evolution → `docs/.output/skill-evolution/{date}/`.

**Context-bundled output:** when brainstorm/research/investigation is about a specific feature, it goes under `docs/app/{feature}/`; when project-wide, under `.output/`. The command decides; if unclear, ask.

### Run-Stamp Convention (universal)

Every fresh-each-run output **file** is named with a `{YYMMDD-HHMM}` prefix (from `date +%y%m%d-%H%M`). **Compute the stamp once per command run and reuse it verbatim for every file that run writes** (so same-day re-runs never clobber and one run's artifacts sort together). In `/sweep` all phases share one stamp; on resume, reuse the in-progress stamp. When a command writes a file early and `git add`s it later (`/do`, `/run-todo` plans), the stamp must be identical at both points.

**Applies to:** all `/review:*` reports + workspaces under `reviews/` (incl. `feedback-{stamp}.{md,json}`, `council-{stamp}/`); `research/`, `investigations/` slugs; `/do`/`/run-todo` plans (`plans/{stamp}-do-{slug}.md` — these stay **flat**; `organize.cjs` recognizes the stamp as already-organized).

**Does NOT apply to** (deliberate exceptions): append-style day logs (`intake/`, `triage/`, `agent-updates/`, `memories/daily/` — stay `YYYY-MM-DD`, append a `## Run {HH:MM}` section inside); per-day/per-run dirs whose inner files already carry a time/slug (`work/`, `screenshots/`, `canary/`, `pending-curation/`, `skill-evolution/`); predictable resume-state files (`onboard-scan.md`, `new-project-interview.md`, epic-keyed `retro-{slug}.md`); and date values inside file *content* (display, not filenames).

## Post-Command Commit Convention

After any lifecycle command that creates/modifies files, commit before reporting:

1. Stage the specific files created/modified (not `git add .`)
2. Write the commit message to `docs/.output/.commit-msg` (Write tool, no shell escaping). Format: `docs|feat|refactor: /command-name — brief summary`. Do NOT add `Co-Authored-By` — `commit.js` appends it exactly once. Then run `node .claude/core/commit.js`. Inline `git commit -m` is blocked by the commit-guard hook.
3. Do NOT push — commit locally only.
4. Include the commit hash in the Report output.

**Commit:** all `/create:*`, `/brainstorm`, `/research`, `/review:*` (except chat-only `/review:status` + `/review:organize`), `/investigate`. **Chat-only:** `/prime`, `/todo`, `/review:status`, `/review:organize`. **Own commit logic:** `/do`, `/run-todo` (commit per wave).

## Memory System

```bash
node .claude/core/memory-manager.js report                       # View all memories
node .claude/core/memory-manager.js search "topic"               # Search by relevance
node .claude/core/memory-manager.js create|update|delete {cat} {id} ['{json}']
node .claude/core/memory-manager.js inbox-list|inbox-promote|inbox-discard {id}
node .claude/core/memory-manager.js decay-report | lint | analytics | prune-unused | supersede
node .claude/core/memory-promoter.js scan [--top N] | mark <slug> <target>
```

`scan`/`mark` operate on hand-created JSON memories (`docs/.output/memories/{cat}/{slug}.json`) + extractor output. Hand-created memories bypass the minimum-source filter (intentional human curation). Confidence levels: 0.9 (architecture) → 0.8 (retro-validated) → 0.7 (implementation-proven) → 0.6 (story-discovered) → 0.5 (session-observed).

**LOCAL-only (F5):** `docs/.output/memories/` is ignored by the `.gitignore` managed block — memories are regenerable, per-project, decay-on-active-days working state, not version-controlled. `git add docs/.output/memories/...` is *expected* to no-op; no command should imply memories persist in git. (`/onboard`'s reconcile + `git ls-files -ci` untrack any committed before the ignore rule — F7.)

**Acquisition:** the Main Agent writes 0–3 structured memories per session-handoff (every `/do`, `/run-todo` wave, `/run-tests`, `/todo`, `/end`) by promoting reusable-learning bullets from the session handoff it just authored, via `memory-manager.js create`. Zero extra LLM cost (it already holds context). `memory-extractor.js` is now manual/brownfield-only (ADR `docs/.output/reviews/2026-04-20-adr-memory-unification.md`). Assign each memory an `importance` 1–5 (`content.importance`, default 3) — the retention floor.

**Inbox staging:** sub-agents never write straight into the curated store — they drop draft JSON into `docs/.output/memories/_inbox/` (per each agent's **Memory Inbox Protocol**). Only the Main Agent promotes (`inbox-promote`) or discards. The Stop hook (`memory-capture.cjs`) captures raw daily logs + optionally runs the Sonnet curator (`MEMORY_PROFILE=strict`) which *dedups*, it does not create.

**Decay** (active work days, not calendar — untouched project = zero decay): `decisions 0.98^days` (~35-day half-life), `constraints 0.97^days` (~23), `patterns 0.95^days` (~14), `workflows 0.93^days` (~10). <0.3 stale, <0.1 archive. Config: `constants.js MEMORY_DECAY`. **Importance is the retention floor:** `calculateDecayedConfidence` multiplies the curve by `importance/3` so importance ≤2 can cross the stale threshold even on an active repo (the hoarding root cause), ≥4 resists. Decay-independent dead-weight → `memory-manager.js analytics` / `prune-unused` (dry-run by default).

**Supersession forgets by validity:** memories that became *wrong* (not just decayed) get `invalid_at` + `superseded_by` and are hidden from current-state reads (`includeSuperseded: true` reads history). Flag-then-confirm: `createMemory` flags overlapping predecessors via a cheap FTS5 query; the Main Agent confirms at `/end` with `memory-manager.js supersede`. Never automatic. **Honest usage:** `usage_count` increments only on genuine retrieval (not passive injection / update); ages via `halveUsageCount` (every 14 silent active-days). Injection ranking (`session-start-prime.cjs`) = importance-floored decayed_confidence × recency primary, aged usage as tiebreaker only, hard top-N budget. Validated by `npm run memory:eval`.

## Hooks

| Hook | Trigger | Purpose |
|------|---------|---------|
| `session-start-prime.cjs` | SessionStart | Inject top structured memories as a system-reminder |
| `secret-scanner.cjs` | Pre-Write/Edit | Block secrets from being written |
| `guardrail.cjs` | Pre-Bash | Block/nudge/confirm destructive commands via `guardrail-rules.yaml`; logs each **hit** (block/nudge/confirm — not allows) to `guardrail-events.jsonl` for the hit counter (`npm run guardrail:stats`) |
| `pre-compaction-archive.cjs` | Pre-Compact | Snapshot state + daily log before compaction |
| `post-read-scrubber.cjs` | Post-Read | Warn on secrets in read files (non-blocking) |
| `organize.cjs` | Post-ExitPlanMode/Bash | Organize plans + screenshots into dated folders |
| `damage-control.cjs` | Post-Bash | Error analysis on failures — prevents retry spin loops |
| `command-usage-logger.cjs` | Post-Skill/Bash | Log command invocations + gate runs to telemetry |
| `memory-guard.cjs` | Post-Write | Warn when a memory category nears its limit |
| `memory-capture.cjs` | Stop, Post-Bash | Daily-log capture + curate (strict); commit context on Bash |
| `edit-capture.cjs` | Post-Edit | Capture edits to canonical docs as daily-log entries (strict) |
| `path-guardrail.cjs` | Pre-Write/Edit | Enforce the four-tier path schema + freeze-state checks |

Secret hooks share `secret-patterns.cjs`. The scanner fires on two paths: (1) the Claude Code `PreToolUse:Write/Edit` hook (blocks Claude writing a secret), and (2) **`commit.js` runs `secret-scanner.cjs --git-precommit` over the staged set before every commit** — this is the project's pre-commit gate, living in our own commit flow rather than a fossil-prone `.git/hooks/pre-commit` (the old `.githooks/` fallback stays retired). Bypass the commit scan only with `--no-scan` / `CLAUDE_COMMIT_NO_SCAN=1`. **Gap that remains:** a raw `git commit` typed in a plain terminal (not via `commit.js`) still gets no scan — use `commit.js`. **`docs/.output/` is deliberately NOT on the scanner skip-list** (its generated reviews/digests quote config — the likeliest place to echo a real secret; a `/review:security` report leaked a live key there once), and `/review:security` now redacts secrets in its reports so a finding stays safe to commit.

## Key File Paths

`.claude/core/`: `gate.js` (build/test gate, auto-detect) · `constants.js` (system constants, phase artifacts, doc chain, `MEMORY_DECAY`) · `daily-log.js` · `memory-manager.js` (CRUD + search + decay + lint, JSON + SQLite FTS5) · `memory-extractor.js` (manual/brownfield only) · `memory-curator.js` (Sonnet dedup, strict) · `memory-promoter.js` · `gen-timeline.js` · `telemetry-log.js` (self-instrument user-typed commands) · `feedback-digest.js` (`/review:feedback` rollup, headless) · `_lib/doc-drift.js` (`isRealDoc()` + legacy/dup planning-doc detection) · `skill-conformance.js` · `skill-eval.js` (differential eval math) · `skill-evolution.js` (`/review:evolve-skills` intake) · `council.js` (council aggregation) · `metrics.js` · `template-updater.js` (zone-aware sync) · `guardrail-stats.js` (guardrail hit-counter reporter — reads `guardrail-events.jsonl`) · `status.js` · `scaffold.js` (seeds from `SKILL_TEMPLATE_MANIFEST`) · `_lib/hook-telemetry.js` (`emitHookEvent` timing + `emitGuardrailHit` hit counter).

`.claude/`: `version.json` (template semver) · `hooks/secret-scanner.cjs` (50+ patterns) · `templates/` (no-owner only: CLAUDE.md docs-guide + `root/` configs; `root/gitignore` → `.gitignore` at scaffold) · `agents/*.md` · `skills/` (23 modules).

`docs/reference/`: `system-map.md` (system inventory + workflow graphs) · `customization.md` (zone map) · `engineering-conventions.md` (durable rules for contributors).

## Build & Test

**The toolkit has zero runtime dependencies** — `git clone` and the hooks work immediately. `npm install` pulls only devDeps (vitest), needed solely to run the test suite. (The guardrail rule-file validator is hand-rolled — `zod` was dropped so non-Node adopters stay drop-in.)

**Memory FTS5 search is also zero-dependency on Node 24+** — runs on built-in `node:sqlite` (ships FTS5 as of Node 24 stable). `better-sqlite3` is an **optional** fallback for Node < 24; without either, search degrades to a JSON linear scan. No mandatory `npm install` for memory search.

Vitest is configured at the repo root; tests colocate under `.claude/core/__tests__/` and `.claude/hooks/__tests__/`.

- `npm test` — run all suites · `npm run test:watch` — watch · `npm run test:coverage` — v8 coverage (→ `docs/.output/telemetry/coverage/`)

`node .claude/core/gate.js test` auto-detects the Node stack and runs `npm test`. Coverage thresholds on `.claude/core/**`: 70% lines, 60% branches. Test dirs (`__tests__/`, `_helpers/`) are excluded from `template-updater.js` propagation. After `/review:specialize`, this section should also describe the project's actual build/test commands.
