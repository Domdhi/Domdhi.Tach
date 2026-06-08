# Code Review Playbook

Structured review workflow that routes review depth based on change type and directory risk. Use alongside the `code-review` skill — this playbook provides the routing logic while the main skill provides the report template and checklists.

## Intake Triage

Classify every review before starting analysis. The classification determines which checklist to use.

### Change Type Classification

| Type | Signal | Route |
|------|--------|-------|
| **Config-Only** | Only `.json`, `.yaml`, `.toml`, `.env.example`, `.*rc` files changed | Fast-Lane |
| **Docs-Only** | Only `.md`, `.txt`, `CHANGELOG`, `LICENSE` files changed | Fast-Lane |
| **Dependency Update** | Only lockfiles or package manifests changed | Fast-Lane + Security Spot-Check |
| **Refactor** | No new exports, no new files, no behavior change | Fast-Lane + Architecture Check |
| **Bug Fix** | Touches existing logic, has corresponding test change | Standard Review |
| **New Feature** | New files, new exports, new routes/endpoints | Deep Review |
| **Security-Sensitive** | Touches auth, crypto, permissions, secrets, input validation | Deep Review (mandatory) |
| **Architecture-Impacting** | New patterns, new dependencies, cross-module changes, schema changes | Deep Review (mandatory) |

**When multiple types apply, use the deepest route.** A refactor that also adds a new export is a "New Feature" review.

---

## Fast-Lane Review

For low-risk changes. Target: 5-10 minutes.

### Fast-Lane Checklist

- [ ] **No secrets or credentials** in the diff
- [ ] **No breaking changes** to public APIs or exports
- [ ] **Consistent formatting** with existing codebase (no mixed conventions)
- [ ] **No unnecessary file additions** (temp files, build artifacts, IDE configs)
- [ ] **Dependency changes are intentional** (lockfile matches manifest, no phantom updates)
- [ ] **Config values are environment-appropriate** (no hardcoded production URLs, no localhost in staging configs)

### Fast-Lane Verdict

If all items pass: **Approved**
If any item fails: escalate to Standard Review for that item

---

## Standard Review

For moderate-risk changes. Covers correctness and testing.

### Standard Checklist

All Fast-Lane items, plus:

- [ ] **Code does what the story/ticket requires** (check acceptance criteria)
- [ ] **Edge cases handled** (null/empty inputs, boundary values, concurrent access)
- [ ] **Error paths return meaningful context** (no swallowed exceptions, no bare `catch {}`)
- [ ] **New code has tests** (unit tests for logic, integration tests for data access)
- [ ] **Tests are meaningful** (not just coverage padding — they assert real behavior)
- [ ] **Coverage claims are verified, not trusted** — a "covered" file can still be fictitiously tested if assertions key off mocked/seeded data that never exercised the real code path. Spot-check that the asserted behavior actually ran. (See the AC-vs-Test anti-patterns in `two-stage-review.md`.)
- [ ] **No N+1 queries or unbounded collections** in data access paths
- [ ] **Logging is appropriate** (enough to debug, not so much it's noisy)

---

## Deep Review

For high-risk changes. Full analysis including architecture compliance and security.

### Deep Review Checklist

All Standard items, plus:

#### Architecture Compliance
- [ ] **Follows documented architecture patterns** (check `docs/_project-architecture.md`)
- [ ] **Respects module boundaries** (no direct cross-layer calls that bypass contracts)
- [ ] **New patterns are justified** (if introducing a pattern not in the architecture doc, flag for ADR)
- [ ] **Database schema changes have migration** (no raw DDL, migration is reversible)
- [ ] **No circular dependencies introduced** between modules

#### Security (OWASP-Aligned)
- [ ] **Input validation at system boundaries** (user input, API input, file uploads)
- [ ] **Output encoding appropriate** (HTML, SQL, shell — context-specific)
- [ ] **Authentication checks on all protected paths** (no auth bypass via new route)
- [ ] **Authorization is granular** (not just "is logged in" but "has permission for this resource")
- [ ] **Sensitive data not logged or exposed** in error messages
- [ ] **Cryptographic operations use established libraries** (no hand-rolled crypto)
- [ ] **Rate limiting or abuse prevention** on public-facing endpoints

#### Integration Points
- [ ] **API contracts are versioned or backward-compatible**
- [ ] **External service calls have timeout and retry logic**
- [ ] **State mutations are atomic** (no partial updates on failure)
- [ ] **Event/message schemas are documented** (if applicable)

---

## Risk-Based Routing

When a **Risk Map** exists in the `code-reviewer` agent's `## Project Context` section, use it to adjust review depth per file. This section is populated by `/review:specialize` — if it hasn't been run, fall through to the No Risk Map Fallback below.

### Risk Map Decision Tree

```
For each changed file:
  1. Match file path against risk map patterns
  2. Determine risk tier: HIGH / MEDIUM / LOW
  3. Route to checklist:
     - HIGH  → Deep Review (mandatory, all sections)
     - MEDIUM → Standard Review
     - LOW   → Fast-Lane Review
```

### Composite Risk Rule

When a single PR contains files across multiple risk tiers:
- The **overall PR verdict** uses the highest risk tier's checklist
- But **per-file findings** note the applicable tier
- This prevents a LOW-risk config change from dragging a HIGH-risk auth change through only a fast-lane review

### No Risk Map Fallback

If no risk map exists (project hasn't run `/specialize`), default all files to **MEDIUM** risk (Standard Review). This is conservative without being paranoid.

---

## Severity Classification

| Severity | Definition | Action | Examples |
|----------|-----------|--------|----------|
| **CRITICAL** | Active exploitability, data loss, crash in production | Must fix before merge | SQL injection, auth bypass, unhandled null on critical path, secret in code |
| **MAJOR** | Real bug, performance issue, architecture violation, missing validation | Should fix before merge | N+1 query, swallowed exception, cross-layer violation, missing auth check |
| **MINOR** | Code smell, missed optimization, readability issue | Fix at developer's discretion | Verbose naming, duplicated constant, missing log context |
| **NIT** | Style, formatting, naming preference | Optional, non-blocking | Bracket placement, import ordering, comment wording |

### Severity Escalation Rules

- A MINOR finding in a HIGH-risk file escalates to MAJOR
- A pattern of 3+ similar MINOR findings suggests a systemic issue — escalate one to MAJOR with a note
- CRITICAL findings in test files are downgraded to MAJOR (tests don't run in production)

---

## Review Output Format

The playbook routes the review depth, but findings are reported using the `code-review` skill's report template. The playbook adds one section to the report:

### Risk Assessment Section

```markdown
## Risk Assessment

| File | Risk Tier | Review Depth | Source |
|------|-----------|-------------|--------|
| {path} | {HIGH/MEDIUM/LOW} | {Deep/Standard/Fast-Lane} | {Risk map pattern or "default"} |

**Overall Review Depth**: {Deep/Standard/Fast-Lane} (highest tier in changeset)
```

This section appears between the Summary and Findings sections in the standard review report.

---

## Cross-References

- **Report template + severity table**: `.claude/skills/code-review/SKILL.md`
- **Two-stage process + subagent templates**: `.claude/skills/code-review/references/two-stage-review.md`
- **Pre-review checklist + subagent dispatch**: `.claude/skills/code-review/references/pre-review-checklist.md`
- **Handling feedback**: `.claude/skills/code-review/references/handling-feedback.md`
- **Risk map source**: `code-reviewer` agent's `## Project Context > ### Risk Map` (generated by `/review:specialize`)
- **Architecture baseline**: `docs/_project-architecture.md`
- **Memory patterns**: `node .claude/core/memory-manager.js search "{domain}"`
