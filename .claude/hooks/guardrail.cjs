#!/usr/bin/env node
/**
 * Guardrail — PreToolUse:Bash Hook
 *
 * Reads .claude/guardrail-rules.yaml and checks the incoming bash command
 * against configured rule sets before Claude executes it.
 *
 * Exit codes (Claude Code semantics):
 *   0 = pass — proceed silently
 *   0 + JSON permissionDecision:"ask" = confirm — user is prompted yes/no
 *   2 = blocked — hard stop (exit 1 is non-blocking in Claude Code)
 *
 * Implementation split (P2.3): Core YAML parsing, rule matching, and response
 * building live in three _lib modules. This file owns: stdin IO, env-based
 * path resolution, stderr warnings, commit-message sanitization, process.exit.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { readHookInput } = require('../core/_lib/hook-input');
const { parseYaml, stripComment } = require('../core/_lib/yaml-parser');
const { matchesPattern, evaluate, checkPathAccess } = require('../core/_lib/guardrail-rules');
const { buildHookResponse, checkFreezeState } = require('../core/_lib/command-blocker');
const { emitGuardrailHit } = require('../core/_lib/hook-telemetry');

// ─── Path resolution ──────────────────────────────────────────────────────────

function resolveRulesPath() {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
    return path.join(projectDir, '.claude', 'guardrail-rules.yaml');
}

// ─── Rule loader (hook-level: resolves path + stderr warnings) ────────────────

/**
 * Load rules from the configured path. Returns null when the file is missing
 * or unreadable — signals processEvent() to pass through with a stderr warn.
 * The _lib loadRules(yamlPath) is silent and returns emptyRules(); this wrapper
 * preserves the historical null = "warn + pass" behavior for the hook.
 *
 * @returns {object|null}
 */
function loadRules() {
    const rulesPath = resolveRulesPath();

    if (!fs.existsSync(rulesPath)) {
        process.stderr.write(
            '[guardrail] WARNING: guardrail-rules.yaml not found at ' + rulesPath + '\n' +
            '[guardrail] All commands will pass through until the rule file is created.\n'
        );
        return null;
    }

    let raw;
    try { raw = fs.readFileSync(rulesPath, 'utf8'); } catch (err) {
        process.stderr.write('[guardrail] WARNING: Could not read guardrail-rules.yaml: ' + err.message + '\n[guardrail] All commands will pass through.\n');
        return null;
    }

    let rules;
    try { rules = parseYaml(raw); } catch (err) {
        process.stderr.write('[guardrail] WARNING: Could not parse guardrail-rules.yaml: ' + err.message + '\n[guardrail] All commands will pass through.\n');
        return null;
    }

    // Validate rule arrays — a YAML authoring error can corrupt them to objects.
    // Fail safe and warn rather than silently passing all commands.
    for (const key of ['block_patterns', 'nudge_patterns', 'confirm_patterns']) {
        if (rules[key] !== undefined && !Array.isArray(rules[key])) {
            process.stderr.write(
                '[guardrail] WARNING: ' + key + ' in guardrail-rules.yaml is malformed (expected array, got ' + typeof rules[key] + ').\n' +
                '[guardrail] This may be caused by a colon in a list item. Check the rule file.\n' +
                '[guardrail] All commands will pass through until the file is corrected.\n'
            );
            return null;
        }
    }

    // Warn about the legacy path_rules block ONLY when the adopter still has
    // legacy entries AND has not migrated to the enforced four-tier schema
    // (zeroAccessPaths/readOnlyPaths/noDeletePaths). Once any four-tier list is
    // populated, the schema is in use and the legacy key is just redundant — so
    // the migration NOTICE would fire on every single Bash command for no
    // actionable reason. Gating on "unmigrated" keeps the hint where it helps
    // (truly pre-P2.5 configs) and silences the per-command noise everywhere
    // else. (2026-06-06 — noise gate)
    if (rules.path_rules && typeof rules.path_rules === 'object') {
        const legacyPopulated = Object.values(rules.path_rules).some(v => Array.isArray(v) && v.length > 0);
        const fourTierPopulated = ['zeroAccessPaths', 'readOnlyPaths', 'noDeletePaths']
            .some(k => Array.isArray(rules[k]) && rules[k].length > 0);
        if (legacyPopulated && !fourTierPopulated) {
            process.stderr.write(
                '[guardrail] NOTICE: path_rules is a legacy key preserved for backward compatibility and is not enforced.\n' +
                '[guardrail] Migrate entries to zeroAccessPaths / readOnlyPaths / noDeletePaths for enforcement (Bash: guardrail.cjs; Edit/Write: path-guardrail.cjs). See the YAML file header for details.\n'
            );
        }
    }

    return rules;
}

// ─── Pattern matching (array variant — backward compat) ───────────────────────

/**
 * Match a command against a list of pattern strings. Returns the first
 * matching pattern or null. Delegates single-pattern logic to matchesPattern().
 *
 * @param {string} command    - Command to test
 * @param {string[]} patterns - Array of pattern strings
 * @returns {string|null}
 */
function matchPatterns(command, patterns) {
    if (!Array.isArray(patterns)) return null;
    for (const pattern of patterns) {
        if (matchesPattern(command, pattern)) return pattern;
    }
    return null;
}

// ─── Rule checker (backward compat wrapper over evaluate()) ──────────────────

/**
 * Check a command against all rule sets. Block patterns take precedence.
 *
 * @param {string} command - Sanitized command to check
 * @param {object} rules   - Parsed rules with block_patterns and confirm_patterns
 * @returns {{ action: 'block'|'nudge'|'confirm'|'allow', pattern?: string }}
 */
function checkRules(command, rules) {
    const result = evaluate(command, rules);
    if (result.decision === 'block') return { action: 'block', pattern: result.pattern };
    if (result.decision === 'nudge') return { action: 'nudge', pattern: result.pattern };
    if (result.decision === 'confirm') return { action: 'confirm', pattern: result.pattern };
    return { action: 'allow' };
}

// ─── Command sanitization ────────────────────────────────────────────────────

/**
 * Strip git commit message content before pattern matching. Without stripping,
 * a message like 'fix: prevent git push --force' false-positives on the block
 * pattern. Handles: -m "...", -m '...', heredoc -m "$(cat <<'EOF'...EOF)".
 */
function stripCommitMessages(command) {
    let result = command;
    result = result.replace(/-m\s*"\$\(cat\s*<<'?EOF'?\s*\n[\s\S]*?\nEOF\s*\)"/g, '-m ""');
    result = result.replace(/-m\s*"(?:[^"\\]|\\.)*"/g, '-m ""');
    result = result.replace(/-m\s*'[^']*'/g, "-m ''");
    result = result.replace(/-m\s+([^\s"'][^\s]*)/g, '-m STRIPPED');
    return result;
}

// ─── Path extraction for delete-style commands (P2.5 — A3 routing) ───────────

/**
 * Extract candidate path arguments from a delete-style bash command.
 *
 * Best-effort tokenization for `rm`, `rm -rf`, `del`, `unlink`, `Remove-Item`.
 * Returns path-like tokens (those with a `/` or `.` or trailing slash, OR
 * those that look like .env / .githooks / .eslintrc etc.). Callers resolve
 * these to absolute paths via CLAUDE_PROJECT_DIR before tier-checking.
 *
 * @param {string} command
 * @returns {string[]}
 */
function extractDeletePaths(command) {
    if (!command || typeof command !== 'string') return [];
    const trimmed = command.trim();
    // Bash: rm [flags] args   |   Windows cmd: del [flags] args
    // PowerShell: Remove-Item [flags] args   |   POSIX: unlink path
    const match = trimmed.match(/^(rm|del|unlink|Remove-Item)\b\s+(.*)$/i);
    if (!match) return [];

    // Split on whitespace respecting basic quotes.
    const remainder = match[2];
    const tokens = [];
    const tokenRe = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = tokenRe.exec(remainder)) !== null) {
        tokens.push(m[1] || m[2] || m[3]);
    }

    // Drop flag tokens (start with `-` or `--` or `/`, excluding `./` paths).
    return tokens.filter((t) => {
        if (!t) return false;
        if (t.startsWith('-')) return false;
        if (t.startsWith('/') && !t.includes('/', 1) && t.length <= 5) return false; // short /flag
        return true;
    });
}

function resolveAbsPath(p) {
    if (!p) return '';
    if (path.isAbsolute(p)) return p;
    const root = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
    return path.resolve(root, p);
}

// ─── Event processor (testable core logic) ───────────────────────────────────

/**
 * Process a parsed hook payload and return an action result or null.
 * null = allow (no action needed).
 *
 * P2.5: after bash pattern evaluation, additionally routes delete-style
 * commands (rm / del / unlink / Remove-Item) through checkPathAccess() +
 * checkFreezeState() so `zeroAccessPaths` / `readOnlyPaths` / `noDeletePaths`
 * and frozen-investigation paths all enforce at the Bash boundary.
 *
 * @param {object} parsedJson - Parsed hook payload ({ tool_input: { command } })
 * @returns {null | { block: true, feedback: string } | { confirm: true, reason: string }}
 */
function processEvent(parsedJson) {
    const toolInput = (parsedJson && parsedJson.tool_input) || {};
    const command = (toolInput.command || '').trim();
    if (!command) return null;

    const sanitizedCommand = stripCommitMessages(command);
    const rules = loadRules();
    if (!rules) return null;

    const decision = checkRules(sanitizedCommand, rules);

    if (decision.action === 'block') {
        const resp = buildHookResponse('block', { command, pattern: decision.pattern });
        return { block: true, feedback: resp.stderr, telemetry: { decision: 'block', rule: decision.pattern, tier: null } };
    }

    // P2.5 — four-tier path check for delete-style bash ops.
    // MUST run BEFORE the nudge/confirm decision: zeroAccessPaths (and a frozen
    // path) are HARD blocks that the nudge escalation marker can never override.
    // The nudge/confirm `rm`/`del`/`Remove-Item` patterns also match a protected
    // path (`rm -rf .env`), so if the nudge branch returned first, `rm -rf .env
    // # guardrail:confirm` would escalate a should-be-hard-block to a user-
    // approvable confirm — violating the "zero-access = all ops blocked"
    // invariant. Checking the path tier here keeps it non-escalatable. (sweep A1)
    const deletePaths = extractDeletePaths(sanitizedCommand);
    for (const p of deletePaths) {
        const absPath = resolveAbsPath(p);

        // Freeze-state check (A2)
        const freeze = checkFreezeState(absPath);
        if (freeze.blocked) {
            const resp = buildHookResponse('frozen', { command, frozenPath: freeze.frozenPath });
            return { block: true, feedback: resp.stderr, telemetry: { decision: 'block', rule: 'frozen-path', tier: 'frozen' } };
        }

        // Four-tier path check (A3)
        const access = checkPathAccess(absPath, 'delete', rules);
        if (!access.allowed) {
            const resp = buildHookResponse('block', {
                command,
                pattern: access.reason || 'path-tier enforcement',
                tier: access.tier,
            });
            return { block: true, feedback: resp.stderr, telemetry: { decision: 'block', rule: access.reason || 'path-tier enforcement', tier: access.tier || null } };
        }
    }

    if (decision.action === 'nudge') {
        // Soft deny (exit 2) with an alternatives + escalation message. The agent
        // tries a reversible path first; if there is none, it re-runs with the
        // `# guardrail:confirm` marker, which evaluate() routes to a user confirm.
        const resp = buildHookResponse('nudge', { command, pattern: decision.pattern });
        return { block: true, feedback: resp.stderr, telemetry: { decision: 'nudge', rule: decision.pattern, tier: null } };
    }
    if (decision.action === 'confirm') {
        return { confirm: true, reason: `Guardrail: "${decision.pattern}" — ${command}`, telemetry: { decision: 'confirm', rule: decision.pattern, tier: null } };
    }

    return null;
}

// ─── Hook entry point ────────────────────────────────────────────────────────

async function runClaudeHook() {
    const input = await readHookInput({ timeoutMs: null });
    if (!input.trim()) process.exit(0);

    let data;
    try { data = JSON.parse(input); } catch { process.exit(0); }

    const result = processEvent(data);
    if (result === null) process.exit(0);

    // Count the hit. Best-effort + side-effect-free in processEvent (emitted here
    // at the entry point only) so unit tests of processEvent never write telemetry.
    if (result.telemetry) emitGuardrailHit(result.telemetry);

    if (result.block) {
        process.stderr.write(result.feedback);
        process.exit(2);
    }
    if (result.confirm) {
        const resp = buildHookResponse('confirm', { reason: result.reason });
        process.stdout.write(resp.stdout);
        process.exit(0);
    }
    process.exit(0);
}

if (require.main === module) { runClaudeHook(); }

// ─── Exports (backward compat) ───────────────────────────────────────────────

module.exports = {
    processEvent,
    parseYaml,           // re-exported from _lib/yaml-parser
    stripComment,        // re-exported from _lib/yaml-parser
    matchPatterns,       // array variant (takes patterns[], not single pattern)
    stripCommitMessages,
    checkRules,          // backward compat wrapper over evaluate()
    loadRules,           // hook-level wrapper (resolves path, writes stderr warnings)
};
