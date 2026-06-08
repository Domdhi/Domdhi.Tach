---
description: Capture a template-performance feedback report (telemetry digest + agent self-review) for this project
argument-hint: "[--quiet]"
---

# Feedback

Produce a **template-performance feedback report** for this project: an automated telemetry digest joined to a short qualitative self-review. The point is to flow real signal about how the Domdhi.Agents template performed — on this project, this session — back to the maintainer, instead of letting it evaporate in chat. Works on any project (new or onboarded) and is safe to re-run.

This is **not** `/listen` (that aggregates post-MVP *product* signals into `intake/`) and **not** `/review:status` (workflow progress). This axis is *template/workflow health*.

## Telemetry (run first)

This command is user-typed, so it does not fire `PostToolUse:Skill` — without this it leaves no `command_invocation` row and fleet analytics under-count human-driven runs. Self-log the invocation before anything else (best-effort — if it fails, continue regardless):

```bash
node .claude/core/telemetry-log.js review:feedback
```

## Variables

INPUT: $ARGUMENTS

`--quiet`: skip the qualitative self-review section — emit the automated digest only (fully headless; no judgment required).

## Orchestration Rule

> Runs directly — do NOT delegate to subagents. The agent that ran the session has the context the self-review needs.

## Workflow

### 1. Build the automated digest

Run the digest script and capture BOTH forms:

```bash
node .claude/core/feedback-digest.js          # markdown section (for the report body)
node .claude/core/feedback-digest.js --json   # raw object (for the collectible sidecar + frontmatter)
```

The digest parses captured telemetry (command-usage, hook-events, skill-usage, memory-injection), the gate summary, the memory store, and `.claude/` system-file counts. Missing inputs degrade to zeros — never block on them.

### 2. Write the collectible sidecar

Write the raw JSON to `docs/.output/reviews/feedback-{YYMMDD-HHMM}.json` verbatim. This is the machine-readable record an aggregation step can pull across many projects — keep its shape stable.

### 3. Compose the report

Write `docs/.output/reviews/feedback-{YYMMDD-HHMM}.md` with this structure. The frontmatter mirrors `summarize()` from the digest so aggregation can parse many reports without opening the body.

```markdown
---
type: template-feedback
project: {digest.project}
template_version: {digest.system.version}
stack: {digest.stack}
generated: {digest.generated}
commands_logged: {n}
gate_runs: {n}
gate_pass_rate: {n}
gate_avg_ms: {n}
hook_fires: {n}
hook_failures: {n}
agent_dispatches: {n}
memories: {n}
---

# Template Feedback — {project} ({date})

{paste the markdown digest from step 1}

## Agent Self-Review (qualitative)

> Skipped when `--quiet`. Answer from THIS session's experience. Be blunt; friction is the deliverable. "Didn't observe" beats inventing.

- **What worked smoothly?**
- **Friction / ambiguity** — where did the commands leave you guessing, backtracking, or improvising? Cite the command/step.
- **What broke?** — failures, wrong behavior, gates that fired wrong (or didn't fire when they should have). Severity 🔴 blocking / 🟡 wrong-but-recoverable / 🔵 papercut.
- **Detection / inference quality** — anything inferred that you were unsure about (esp. on /onboard runs).
- **One change to the template** that would most improve the next run.
```

### 4. Sanity-check the numbers

Skim the digest for anomalies and call them out in the report body (one line each) — they are the highest-signal findings:
- `duration: ... (X/Y captured)` where X ≪ Y → most gate runs predate the duration stamp, or aren't going through `gate.js`.
- `invocations logged: N (0 self-instrumented)` on a heavily-used project → user-typed commands aren't self-instrumenting (see `telemetry-log.js`).
- `hook failures > 0` → a hook is erroring.
- system-file counts that don't match `.claude/version.json`'s expectations → an incomplete copy / drift.

### 5. Commit

Follow the **Post-Command Commit Convention**. Stage `docs/.output/reviews/feedback-{YYMMDD-HHMM}.md` and `.json` (same stamp computed once this run), write the message to `docs/.output/.commit-msg`:

```
docs: /review:feedback — {project} template-performance report
```

Then `node .claude/core/commit.js`. Report the path + commit hash.

## Notes for chaining

`/onboard` and `/create:new-project` invoke this as their final step so every bootstrapped project leaves a baseline feedback report automatically. When chained, run it exactly as above — its self-commit is a separate, intentional commit from the bootstrapper's.
