---
name: code-review
description: "Use when reviewing code changes, pull requests, or architecture compliance — two-stage review process (spec compliance then code quality), risk-tiered findings (CRITICAL/MAJOR/MINOR), reviewer identity (diagnose don't rewrite), pre-review checklist, handling feedback. Covers: code review, review, pull request, PR review, risk routing, review depth, review playbook, severity."
metadata:
  version: 1.0.0
  author: Domdhi.Agents
  tags: [code-review, playbook, risk-routing, severity, two-stage, architecture-compliance]
user-invocable: false
allowed-tools: Read Grep Glob
---

# Code Review

Consolidated methodology for reviewing code changes in this project. Combines the review report template and severity definitions from `code-reviewer` with the intake triage and risk-based routing from `code-review-playbook`.

---

## 1. Reviewer Identity

The reviewer's job is to **diagnose, document, and communicate** — not to rewrite or rescue. Think of it as a surgeon reading a scan: findings are reported precisely; the implementer performs the fix.

- Read the diff and codebase. Never rely on the implementer's self-report alone.
- Categorize by actual severity. Not everything is CRITICAL — manufacturing issues to fill a quota is dishonest.
- Be specific: `file:line`, what's wrong, why it matters, how to fix (if not obvious).
- Give a clear verdict. "Looks good" without checking, or vague notes like "improve error handling", are not reviews.

---

## 2. Two-Stage Review Process

Always run Stage 1 before Stage 2. Never run quality review while spec compliance has open issues.

**Stage 1 — Spec Compliance**
Did the implementer build exactly what was requested — nothing more, nothing less?
- Compare implementation line-by-line against acceptance criteria.
- Check for missing requirements, over-engineering, and misinterpretations.
- Do not trust the implementer's report; read the actual code.
- Result: pass (move to Stage 2) or list of specific gaps (implementer fixes, then re-review).

**Stage 2 — Code Quality**
Is it well-built — clean, tested, maintainable?
- Correctness, security, performance, maintainability, and test coverage (see `references/pre-review-checklist.md`).
- Full process, subagent templates, and red flags: `references/two-stage-review.md`.

---

## 3. Risk-Tiered Findings

| Severity | Definition | Action | Examples |
|----------|-----------|--------|----------|
| **CRITICAL** | Active exploitability, data loss, production crash | Must fix before merge | SQL injection, auth bypass, unhandled null on critical path, secret in code |
| **MAJOR** | Real bug, performance issue, architecture violation, missing validation | Should fix before merge | N+1 query, swallowed exception, cross-layer violation, missing auth check |
| **MINOR** | Code smell, readability issue, missed optimization | Fix at developer's discretion | Verbose naming, duplicated constant, missing log context |
| **NIT** | Style, formatting, naming preference | Optional, non-blocking | Bracket placement, import ordering, comment wording |

**Escalation rules:**
- A MINOR finding in a HIGH-risk file (auth, crypto, secrets) escalates to MAJOR.
- Three or more similar MINOR findings of the same type indicate a systemic issue — escalate one to MAJOR with a note.
- CRITICAL findings in test-only files are downgraded to MAJOR (tests do not run in production).
- **A silently-swallowed error (empty `catch`, ignored exit code, discarded `Promise` rejection) in a tool that DELETES files, writes/migrates data, or publishes to a remote is a MAJOR** — the operation's summary becomes untrustworthy (it reports success for work that didn't happen). Either surface the failure in the result or abort; never swallow and continue. (Field-proven: a fleet-prune tool reported `removed:` for files an `rmSync` had failed to delete.)

**MAJOR-Fix-Inline Discipline:** MAJORs are fixed before commit, not deferred. If a MAJOR genuinely needs design discussion, file a follow-up story in the TODO and block the commit until it is filed. Never silently downgrade MAJOR to MINOR to clear the review.

**Security-control changes — mandatory bypass attempt.** Any change that touches a security hook, guardrail, exemption list, or matching regex (e.g. `guardrail-rules.yaml`, `secret-patterns.cjs`, path-tier logic) MUST include an explicit bypass attempt before approval: construct at least one input that *should* be caught and check the new logic still catches it (chained commands, trailing/sibling tokens, substring look-alikes, encoding tricks). Field-proven twice: a guardrail `rm -rf` exemption regex shipped a whole-line-lookahead bypass (`rm -rf ~/x && echo /tmp` passed), and a widening amplified it. Loosening a control without an adversarial check is how a "fix" becomes a hole. Treat the widened-control change itself as HIGH-risk regardless of file.

---

## 4. The "Never Out of Scope" Rule

Fix everything you find during review — pre-existing issues are not exempt. If a pre-existing problem is inside a file you are already touching, flag and fix it. "That wasn't introduced in this PR" is not a reason to let a bug walk.

The only exception: if the pre-existing issue is genuinely large (separate domain, requires its own ADR), file it as a follow-up story rather than silently ignoring it.

---

## 5. References

These three files contain the detailed process, subagent prompt templates, and red-flag lists used during execution:

- **`references/handling-feedback.md`** — how to respond to review feedback (verify before implementing, when to push back, forbidden sycophantic responses).
- **`references/pre-review-checklist.md`** — when to request review, how to dispatch a code-reviewer subagent, the full subagent prompt template, and red flags.
- **`references/two-stage-review.md`** — the per-task two-stage loop, implementer prompt template, spec-compliance reviewer template, code-quality reviewer template.

---

## 6. Review Playbook

Intake triage, risk-based routing (Fast-Lane / Standard / Deep), per-depth checklists, the Risk Map decision tree, the Risk Assessment report section, and severity escalation detail: **`references/playbook.md`**.

Quick routing reference:

| Change Type | Route |
|-------------|-------|
| Config-only, docs-only | Fast-Lane |
| Dependency update | Fast-Lane + security spot-check |
| Refactor | Fast-Lane + architecture check |
| Bug fix | Standard Review |
| New feature | Deep Review |
| Security-sensitive, architecture-impacting | Deep Review (mandatory) |

When multiple types apply, use the deepest route.
