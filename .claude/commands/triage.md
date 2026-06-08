---
description: Triage a signal-intake file into the backlog — classify each signal (promote / defer / kill / research), auto-deciding mechanical calls and interviewing only the judgment calls
argument-hint: [optional intake file path | {YYYY-MM-DD} | --dry-run]
---

# /triage — Signal → Backlog Decision Loop

The second **post-MVP lifecycle** command (Tier 2). `/listen` gathers push-from-reality signals into a dated intake file but deliberately does **not** prioritize — it leaves every item un-ranked. `/triage` is the decision half: it reads the newest intake file, classifies each signal, and converts the keepers into ranked backlog stories.

Shape: like `/interview` — reads a file, asks one-at-a-time about the genuine judgment calls, summarizes. But it **auto-decides the mechanical calls** so it never interrogates the user on signals with one obvious answer. The pairing is `/listen` (gather, no opinions) → `/triage` (decide, minimal questions) → backlog → `/do` / `/run-todo`.

## Telemetry (run first)

This command is user-typed, so it does not fire `PostToolUse:Skill` — without this it leaves no `command_invocation` row and fleet analytics under-count human-driven runs. Self-log the invocation before anything else (best-effort — if it fails, continue regardless):

```bash
node .claude/core/telemetry-log.js triage
```

## Design basis

Two axes of best practice, baked into the workflow below:

- **Severity is not Priority** (industry bug-triage canon). *Severity* = the objective technical impact of a signal (engineering-led, no user input). *Priority* = the business decision about whether/when to act (where user judgment enters). A signal can be high-severity **and** low-priority. This command scores Severity mechanically in Step 3, then decides Priority (the disposition) in Steps 4–5. Never conflate them.
- **Frameworks are lenses, not laws.** Promoted items are ordered with a lightweight **ICE** score (Impact × Confidence × Ease) and tagged **MoSCoW** (Must / Should / Could) — fast enough to score a whole intake in minutes, surfaced so the user can override. No heavy RICE/WSJF ceremony for a solo/small-team harness.
- **Decisions are durable** (Paperclip's issue state machine). A killed or deferred signal is recorded in an append-only ledger so the next `/listen` sweep doesn't make you re-adjudicate it. The state machine: `intake → triaged → {promoted | deferred | killed | researching}`.
- **Auto-decide the obvious** (gstack `/autoplan`; same Mechanical / Taste / User-Challenge model as `/do` Step 6c). Only User-Challenge signals reach an `AskUserQuestion`.

## Variables

SCOPE: $ARGUMENTS

- `SCOPE` (optional):
  - An intake file path or a `{YYYY-MM-DD}` date — triage that file. Default: the newest `docs/.output/intake/*.md`.
  - `--dry-run` — classify and report, but write **nothing** (no backlog append, no ledger write, no intake markers, no commit). For previewing dispositions.

## Output

- `docs/todo/_backlog.md` — promoted signals appended as stories (under a `## Triage Intake` epic, created if absent).
- `docs/.output/triage/{YYYY-MM-DD}.md` — the run record (day-rotated; append `## Run {HH:MM}` if today's file exists, never overwrite — like `/listen`).
- `docs/.output/triage/_decisions.md` — append-only **decision ledger** (every kill/defer, with a fingerprint + reason). This is the anti-resurfacing memory.
- The source intake file — each bullet annotated inline with its disposition.

## Workflow

### Step 1: Resolve the intake file

- If `SCOPE` names a file/date, use it. Else Glob `docs/.output/intake/*.md` and take the newest.
- **If no intake file exists:** stop and tell the user to run `/listen` first. Do not invent signals.
- Read the resolved intake file. Read `docs/.output/triage/_decisions.md` if it exists (the ledger).
- State the resolved file + ledger status in the report.

### Step 2: Parse + de-dupe + suppress-already-decided

- Extract every signal bullet across all `## Run` sections: `- [origin: {source}] {signal} — {why}`.
- De-duplicate within the file (the same TODO surfaced by both `git` and `backlog` is one signal).
- **Consult the ledger.** For each signal, compute a short fingerprint (origin + the signal's key noun phrase — e.g. `git:expiring-flag:payment-shim`). If the fingerprint already appears in `_decisions.md` as `killed` or as `deferred` with a future revisit date not yet reached, **suppress it** — don't re-surface what the user already adjudicated. Count suppressions; report the number ("N signals suppressed by prior triage decisions").
- The remaining live signals are the triage set.

### Step 3: Score Severity (objective — no user)

Assign each live signal a **Severity**, anchored to observable impact, not stakeholder urgency. This is engineering-led and deterministic — never ask the user for it.

| Severity | Rule of thumb |
|----------|---------------|
| **Critical** | data loss, security/credential exposure, broken core workflow with no workaround, production-down |
| **High** | major functionality broken for a real segment; recurring gate/build failure; a **past-due** cleanup obligation (expired flag, `remove after {past-date}`); any security/privacy finding regardless of functional reach |
| **Medium** | degraded-but-usable behavior; churn hotspot (maintenance risk); an actionable agent-update not yet folded in |
| **Low** | cosmetic, one-off TODO/FIXME marker, minor drift, nice-to-have |

Security and data-privacy signals are **never** below High, even when functional impact looks small.

### Step 4: Classify the decision type + pre-decide where you can

For each live signal, classify the **decision** (not the severity) using the `/do` Step 6c model, and pre-resolve the disposition for the non-judgment ones:

| Decision type | Examples | Action |
|---------------|----------|--------|
| **Mechanical** (one correct answer) | signal already resolved in git → **kill**; exact duplicate of an existing backlog story or ledger entry → **kill (merge)**; a past-due cleanup obligation → **promote** | Auto-decide **silently**. |
| **Taste** (low-stakes, reversible) | clear maintenance bug of obvious value → **promote**; low-severity noise with no near-term value → **defer** | Auto-decide, **log the call** in the run record so the user can course-correct. |
| **User Challenge** (shapes product direction, adds scope, or genuinely ambiguous intent) | a feature-shaped signal; a "should we even support X?" question; anything that meaningfully constrains the project's future | **Always ask** in Step 5. Never auto-decide. |

The four **dispositions** (the Priority decision):

- **promote** → becomes a backlog story now.
- **defer** → not now; recorded with a revisit hint (and optional revisit date). Stays out of the next sweep until then.
- **kill** → won't do; **reason recorded** so it never resurfaces. Killing without a reason is the cardinal sin (it just comes back next `/listen`).
- **research** → can't be sized yet; needs a spike. Becomes a research-tagged backlog item and a pointer to `/research` or `/investigate`.

### Step 5: Interview ONLY the User-Challenge signals

Mechanical + Taste are already decided. Bring **only** the User-Challenge signals to the user — this is what keeps `/triage` from interrogating one question per signal.

- Use `AskUserQuestion`. Mirror `/interview`'s rules: **≤4 questions per round, ≤3 rounds**, concrete options, short headers (≤12 chars), lead each with your **recommended** disposition first marked "(Recommended)".
- Options per signal: **Promote / Defer / Kill / Research** (+ the user's free-text "Other").
- If there are more than ~12 User-Challenge signals, triage the highest-Severity ones this round and **defer the tail with an explicit note in the report** — never silently cap. (A silent cap reads as "triaged everything" when it didn't.)
- **End with a plain-chat summary** of every disposition. This is load-bearing: the `Elicitation` hook does not fire for `AskUserQuestion` (Issue #44326), so the chat summary is the only downstream-observable record of what was decided — `/end` and memory-acquisition read it, not the multiple-choice UI.

### Step 6: Score + order the promoted set (ICE + MoSCoW)

For each **promote** disposition, attach a lightweight priority lens — agent-computed, not a user interrogation:

- **ICE** — Impact (1–5) × Confidence (1–5) × Ease (1–5). Higher = do sooner. Ease is the inverse of effort (5 = trivial).
- **MoSCoW** — `Must` (Critical/High severity blocking real use), `Should` (clear value, not blocking), `Could` (nice-to-have).
- Order the promoted stories **by ICE descending** before appending, so the backlog insert is pre-ranked.

These are lenses — surface the numbers; if the user disagrees in the Step 5 summary, take their ordering.

### Step 7: Apply dispositions + persist (skip all writes if `--dry-run`)

Output-persistence convention: everything hits disk **before** the report. Chat-only triage is lost on compaction.

**7a. Promote → append stories to `docs/todo/_backlog.md`.** Under a `## Triage Intake` epic (create it once if absent). Use the project-planning story format, annotated:

```
* **Story T.{n} ({Domain}): {Title}**
  * **As a** {persona}, **I want** {capability}, **So that** {benefit}.
  * **AC:**
    * {criterion}
  * **Estimate:** {S/M/L/XL}   ·   **Severity:** {Critical/High/Medium/Low}
  * **ICE:** {I}×{C}×{E} = {score}   ·   **MoSCoW:** {Must/Should/Could}
  * **Source:** [origin: {source}] {signal}  ·  triaged {YYYY-MM-DD}
  * **Dependencies:** {None | Story X.Y}
```

**7b. Kill / Defer → append to the ledger `docs/.output/triage/_decisions.md`** (append-only):

```
- {YYYY-MM-DD} · {fingerprint} · **killed** — {reason}
- {YYYY-MM-DD} · {fingerprint} · **deferred** until {revisit hint/date} — {why}
```

**7c. Research → append a spike story** to the backlog (`Estimate: spike`, AC = "the open question is answered") and note the suggested follow-up command (`/research` or `/investigate`).

**7d. Annotate the source intake file inline** — append a disposition marker to each triaged bullet so a re-read of the intake shows what happened:
`✅ promoted → Story T.{n}` · `⏸ deferred: {hint}` · `❌ killed: {reason}` · `🔬 research: {spike}`

**7e. Write the run record** `docs/.output/triage/{YYYY-MM-DD}.md` (day-rotated; `## Run {HH:MM}` if the file exists) — the decision table (signal · severity · decision-type · disposition · ICE/reason).

### Step 8: Commit (main agent — skip if `--dry-run`)

Follow the **Post-Command Commit Convention** in CLAUDE.md. Stage the backlog, the intake file, and the triage run record + ledger. Write the message to `docs/.output/.commit-msg`, then `node .claude/core/commit.js` (inline `git commit -m` is blocked).
Message: `docs: /triage — {P} promoted, {D} deferred, {K} killed ({YYYY-MM-DD})`.

### Step 9: Report

```
## /triage — {YYYY-MM-DD}

**Intake:** {resolved file}  ·  **Ledger:** {N suppressed by prior decisions}
**Commit:** {hash, or "dry-run — nothing written"}

| Disposition | Count |
|-------------|-------|
| Promoted | {P} |
| Deferred | {D} |
| Killed | {K} |
| Research | {R} |
| Suppressed (prior) | {S} |

**Promoted (by ICE):**
1. Story T.{n} — {title} (Sev {x}, ICE {score}, {MoSCoW})

**Auto-decided (Taste — review if you disagree):**
- {signal} → {disposition}: {one-line why}

**Next:** `/review:optimize-backlog` to slot the new stories, or `/do` the top one.
```

If the triage set is empty (everything suppressed or zero live signals), say so plainly — that's a healthy steady state, and the run record still records that the sweep happened.

## Anti-Patterns

- **Interrogating on mechanical calls.** A signal already fixed in git, or an exact backlog duplicate, has one correct answer — auto-decide it. Only User-Challenge signals reach an `AskUserQuestion`. One-question-per-signal is the failure mode this command exists to avoid.
- **Conflating severity with priority.** Severity is the objective technical read (Step 3, no user). Priority is the disposition (Steps 4–5, user-adjudicated for the judgment calls). A High-severity signal can still be correctly deferred.
- **Killing without a reason.** Every kill writes a reason to the ledger. Otherwise the next `/listen` resurfaces it and you re-litigate it forever.
- **Re-asking what's already decided.** Consult `_decisions.md` in Step 2 and suppress adjudicated signals. The ledger is the durable issue state — honor it.
- **Imposing a heavy framework.** ICE + MoSCoW are fast lenses, agent-computed, user-overridable. Don't make the user hand-score RICE for a maintenance backlog.
- **Silent caps.** If you can't triage every User-Challenge signal in ≤3 rounds, defer the tail **with an explicit note** — never quietly drop the overflow.
- **Chat-only output.** The backlog stories, ledger, run record, and intake markers are the artifacts. They hit disk before the report (except under `--dry-run`, which writes nothing by design and says so).

## Note: `/listen` suppression is forward-looking

`/triage` writes the decision ledger and consults it to avoid re-asking. Wiring `/listen` to *also* read the ledger and suppress killed signals at gather-time (so they never re-enter intake at all) is a natural future enhancement — not built here. For now, suppression happens at triage-time, which is sufficient to stop the user re-adjudicating.
