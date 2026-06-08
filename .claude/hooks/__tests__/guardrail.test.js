// AC→source map (TDD-5.2 / guardrail):
//   - parseYaml: fixture YAML with block list, confirm list, nested keys, comments, quoted strings
//   - stripComment: inline comments, # inside quotes preserved, empty lines
//   - matchPatterns: exact match, prefix/substring match, regex match → correct block/confirm/pass
//   - checkRules: rm -rf / → block; git push --force → confirm; ls → allow
//   - processEvent: end-to-end with fixture rules file; rules missing → graceful default
//
// Note: AC named the function "matchesRule" and "checkRules(command, rules)".
//   matchesRule → source name preserved as matchPatterns (takes an array, not a rule).
//   checkRules is a NEW named function extracted from runClaudeHook during refactor.
//
// CJS cache-busting strategy:
//   guardrail.cjs loads rules via loadRules() which reads CLAUDE_PROJECT_DIR at call time.
//   The module exports are pure functions OR functions that read env at call time.
//   loadRules() reads CLAUDE_PROJECT_DIR every invocation — no cache-busting needed for
//   processEvent tests; we manipulate CLAUDE_PROJECT_DIR and use tmp dirs instead.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
    processEvent,
    parseYaml,
    stripComment,
    matchPatterns,
    stripCommitMessages,
    checkRules,
    loadRules,
} = require('../guardrail.cjs');

const { createTmpDir } = require('../../core/__tests__/_helpers/tmp-dir');

// ─── Fixture YAML ─────────────────────────────────────────────────────────────

const FIXTURE_YAML = `
# Test rules
block_patterns:
  - "rm -rf /"
  - "/dangerous.*/"

confirm_patterns:
  - "git push --force"

nested:
  sub_key: "value with # hash inside"
  another:
    - item1
    - item2

string_val: "quoted value"
unquoted: plain text
`;

// ─── parseYaml ────────────────────────────────────────────────────────────────

describe('guardrail', () => {
    describe('parseYaml', () => {
        it('parseYaml_blockPatterns_parsedAsArray', () => {
            // Arrange / Act
            const result = parseYaml(FIXTURE_YAML);

            // Assert
            expect(Array.isArray(result.block_patterns)).toBe(true);
            expect(result.block_patterns).toContain('rm -rf /');
            expect(result.block_patterns).toContain('/dangerous.*/');
        });

        it('parseYaml_confirmPatterns_parsedAsArray', () => {
            // Arrange / Act
            const result = parseYaml(FIXTURE_YAML);

            // Assert
            expect(Array.isArray(result.confirm_patterns)).toBe(true);
            expect(result.confirm_patterns).toContain('git push --force');
        });

        it('parseYaml_nestedKeys_parsedAsObject', () => {
            // Arrange / Act
            const result = parseYaml(FIXTURE_YAML);

            // Assert
            expect(typeof result.nested).toBe('object');
            expect(result.nested).not.toBeNull();
            expect(result.nested.sub_key).toBe('value with # hash inside');
        });

        it('parseYaml_nestedList_parsedAsArray', () => {
            // Arrange / Act
            const result = parseYaml(FIXTURE_YAML);

            // Assert
            expect(Array.isArray(result.nested.another)).toBe(true);
            expect(result.nested.another).toContain('item1');
            expect(result.nested.another).toContain('item2');
        });

        it('parseYaml_quotedStringValue_stripsQuotes', () => {
            // Arrange / Act
            const result = parseYaml(FIXTURE_YAML);

            // Assert
            expect(result.string_val).toBe('quoted value');
        });

        it('parseYaml_unquotedValue_preservedAsIs', () => {
            // Arrange / Act
            const result = parseYaml(FIXTURE_YAML);

            // Assert
            expect(result.unquoted).toBe('plain text');
        });

        it('parseYaml_topLevelComment_ignored', () => {
            // Arrange / Act
            const result = parseYaml(FIXTURE_YAML);

            // Assert — "# Test rules" line should not appear as a key
            const keys = Object.keys(result);
            expect(keys.every(k => !k.startsWith('#'))).toBe(true);
        });

        it('parseYaml_hashInsideQuotedSubKey_preserved', () => {
            // Arrange — the fixture has: sub_key: "value with # hash inside"
            // Act
            const result = parseYaml(FIXTURE_YAML);

            // Assert — the # is inside quotes, so it must NOT be stripped
            expect(result.nested.sub_key).toContain('# hash inside');
        });

        it('parseYaml_emptyInput_returnsEmptyObject', () => {
            // Arrange / Act
            const result = parseYaml('');

            // Assert
            expect(result).toEqual({});
        });
    });

    // ─── stripComment ──────────────────────────────────────────────────────────

    describe('stripComment', () => {
        it('stripComment_noHash_returnsLineUnchanged', () => {
            // Arrange / Act / Assert
            expect(stripComment('plain text here')).toBe('plain text here');
        });

        it('stripComment_hashOutsideQuotes_stripsFromHash', () => {
            // stripComment returns line.slice(0, hashIdx) — preserves the space
            // before the #. Don't trim; downstream parsers do that.
            expect(stripComment('key: value # inline comment')).toBe('key: value ');
        });

        it('stripComment_hashInsideDoubleQuotes_preserved', () => {
            // Arrange / Act / Assert
            const line = 'sub_key: "value with # hash inside"';
            expect(stripComment(line)).toBe(line);
        });

        it('stripComment_hashInsideSingleQuotes_preserved', () => {
            // Arrange / Act / Assert
            const line = "sub_key: 'value with # hash inside'";
            expect(stripComment(line)).toBe(line);
        });

        it('stripComment_hashAtStart_returnsEmpty', () => {
            // Arrange / Act / Assert
            expect(stripComment('# full line comment').trim()).toBe('');
        });

        it('stripComment_emptyLine_returnsEmpty', () => {
            // Arrange / Act / Assert
            expect(stripComment('')).toBe('');
        });
    });

    // ─── matchPatterns ────────────────────────────────────────────────────────

    describe('matchPatterns', () => {
        it('matchPatterns_exactSubstringMatch_returnsMatchedPattern', () => {
            // Arrange
            const patterns = ['rm -rf /'];
            const command = 'rm -rf /tmp/foo';

            // Act
            const result = matchPatterns(command, patterns);

            // Assert
            expect(result).toBe('rm -rf /');
        });

        it('matchPatterns_caseInsensitiveMatch_returnsPattern', () => {
            // Arrange
            const patterns = ['GIT PUSH --FORCE'];
            const command = 'git push --force origin main';

            // Act
            const result = matchPatterns(command, patterns);

            // Assert
            expect(result).toBe('GIT PUSH --FORCE');
        });

        it('matchPatterns_prefixSubstringMatch_returnsPattern', () => {
            // Arrange
            const patterns = ['git push'];
            const command = 'git push --force main';

            // Act
            const result = matchPatterns(command, patterns);

            // Assert
            expect(result).toBe('git push');
        });

        it('matchPatterns_regexPattern_matchesWhenRegexMatches', () => {
            // Arrange
            const patterns = ['/dangerous.*/'];
            const command = 'dangerous command here';

            // Act
            const result = matchPatterns(command, patterns);

            // Assert
            expect(result).toBe('/dangerous.*/');
        });

        it('matchPatterns_regexPattern_noMatchWhenRegexDoesNotMatch', () => {
            // Arrange
            const patterns = ['/dangerous.*/'];
            const command = 'safe command here';

            // Act
            const result = matchPatterns(command, patterns);

            // Assert
            expect(result).toBeNull();
        });

        it('matchPatterns_noMatchingPattern_returnsNull', () => {
            // Arrange
            const patterns = ['rm -rf /', 'git push --force'];
            const command = 'ls -la';

            // Act
            const result = matchPatterns(command, patterns);

            // Assert
            expect(result).toBeNull();
        });

        it('matchPatterns_emptyPatternArray_returnsNull', () => {
            // Arrange / Act / Assert
            expect(matchPatterns('rm -rf /', [])).toBeNull();
        });

        it('matchPatterns_nonArrayPatterns_returnsNull', () => {
            // Arrange / Act / Assert
            expect(matchPatterns('rm -rf /', null)).toBeNull();
            expect(matchPatterns('rm -rf /', undefined)).toBeNull();
        });

        it('matchPatterns_invalidRegex_skipsAndContinues', () => {
            // Arrange — invalid regex followed by a valid plain pattern
            const patterns = ['/[invalid/', 'rm -rf /'];
            const command = 'rm -rf /tmp';

            // Act
            const result = matchPatterns(command, patterns);

            // Assert — skips the bad regex, matches the plain pattern
            expect(result).toBe('rm -rf /');
        });
    });

    // ─── checkRules ───────────────────────────────────────────────────────────

    describe('checkRules', () => {
        const rules = {
            block_patterns: ['rm -rf /'],
            confirm_patterns: ['git push --force'],
        };

        it('checkRules_commandMatchesBlockPattern_returnsBlock', () => {
            // Arrange / Act
            const result = checkRules('rm -rf /tmp/foo', rules);

            // Assert
            expect(result.action).toBe('block');
            expect(result.pattern).toBe('rm -rf /');
        });

        it('checkRules_commandMatchesConfirmPattern_returnsConfirm', () => {
            // Arrange / Act
            const result = checkRules('git push --force main', rules);

            // Assert
            expect(result.action).toBe('confirm');
            expect(result.pattern).toBe('git push --force');
        });

        it('checkRules_commandMatchesNeither_returnsAllow', () => {
            // Arrange / Act
            const result = checkRules('ls -la', rules);

            // Assert
            expect(result.action).toBe('allow');
            expect(result.pattern).toBeUndefined();
        });

        it('checkRules_blockPatternTakesPrecedenceOverConfirm', () => {
            // Arrange — command that could match both if both lists had it
            const overlappingRules = {
                block_patterns: ['git push'],
                confirm_patterns: ['git push --force'],
            };

            // Act
            const result = checkRules('git push --force main', overlappingRules);

            // Assert — block wins because it is checked first
            expect(result.action).toBe('block');
        });

        it('checkRules_emptyRules_returnsAllow', () => {
            // Arrange / Act
            const result = checkRules('rm -rf /', { block_patterns: [], confirm_patterns: [] });

            // Assert
            expect(result.action).toBe('allow');
        });

        it('checkRules_missingPatternKeys_returnsAllow', () => {
            // Arrange — rules object without block_patterns or confirm_patterns
            const result = checkRules('rm -rf /', {});

            // Assert
            expect(result.action).toBe('allow');
        });
    });

    // ─── processEvent ─────────────────────────────────────────────────────────

    describe('processEvent', () => {
        let tmp;
        let originalDir;

        beforeEach(() => {
            tmp = createTmpDir();
            originalDir = process.env.CLAUDE_PROJECT_DIR;
        });

        afterEach(() => {
            if (originalDir === undefined) {
                delete process.env.CLAUDE_PROJECT_DIR;
            } else {
                process.env.CLAUDE_PROJECT_DIR = originalDir;
            }
            tmp.cleanup();
        });

        function writeRules(content) {
            tmp.write('.claude/guardrail-rules.yaml', content);
            process.env.CLAUDE_PROJECT_DIR = tmp.root;
        }

        const STANDARD_RULES = `
block_patterns:
  - "rm -rf /"
confirm_patterns:
  - "git push --force"
`;

        it('processEvent_rmRfSlash_returnsBlock', () => {
            // Arrange
            writeRules(STANDARD_RULES);

            // Act
            const result = processEvent({ tool_input: { command: 'rm -rf /tmp/foo' } });

            // Assert
            expect(result).not.toBeNull();
            expect(result.block).toBe(true);
            expect(result.feedback).toEqual(expect.stringContaining('BLOCKED'));
        });

        it('processEvent_gitPushForce_returnsConfirm', () => {
            // Arrange
            writeRules(STANDARD_RULES);

            // Act
            const result = processEvent({ tool_input: { command: 'git push --force main' } });

            // Assert
            expect(result).not.toBeNull();
            expect(result.confirm).toBe(true);
            expect(typeof result.reason).toBe('string');
            expect(result.reason).toContain('git push --force');
        });

        it('processEvent_safeCommand_returnsNull', () => {
            // Arrange
            writeRules(STANDARD_RULES);

            // Act
            const result = processEvent({ tool_input: { command: 'ls -la' } });

            // Assert
            expect(result).toBeNull();
        });

        it('processEvent_rulesMissing_returnsNullAndWarnsStderr', () => {
            // Arrange — point to an empty tmp dir with no rules file
            process.env.CLAUDE_PROJECT_DIR = tmp.root;
            const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

            try {
                // Act
                const result = processEvent({ tool_input: { command: 'rm -rf /tmp/foo' } });

                // Assert
                expect(result).toBeNull();
                expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[guardrail]'));
            } finally {
                stderrSpy.mockRestore();
            }
        });

        it('processEvent_emptyCommand_returnsNull', () => {
            // Arrange
            writeRules(STANDARD_RULES);

            // Act
            const result = processEvent({ tool_input: { command: '' } });

            // Assert
            expect(result).toBeNull();
        });

        it('processEvent_missingToolInput_returnsNull', () => {
            // Arrange
            writeRules(STANDARD_RULES);

            // Act
            const result = processEvent({});

            // Assert
            expect(result).toBeNull();
        });

        it('processEvent_commitMessageContainingBlockedPhrase_notBlocked', () => {
            // Arrange — commit message mentions "rm -rf /" but the actual command is just git commit
            writeRules(STANDARD_RULES);
            const command = `git commit -m "fix: prevent rm -rf / accidents"`;

            // Act
            const result = processEvent({ tool_input: { command } });

            // Assert — stripCommitMessages removes the -m content so no false positive
            expect(result).toBeNull();
        });
    });

    // ─── loadRules (missing file) ─────────────────────────────────────────────

    describe('loadRules', () => {
        let tmp;
        let originalDir;

        beforeEach(() => {
            tmp = createTmpDir();
            originalDir = process.env.CLAUDE_PROJECT_DIR;
        });

        afterEach(() => {
            if (originalDir === undefined) {
                delete process.env.CLAUDE_PROJECT_DIR;
            } else {
                process.env.CLAUDE_PROJECT_DIR = originalDir;
            }
            tmp.cleanup();
        });

        it('loadRules_missingFile_returnsNull', () => {
            // Arrange — empty tmp dir, no guardrail-rules.yaml
            process.env.CLAUDE_PROJECT_DIR = tmp.root;
            const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

            try {
                // Act
                const result = loadRules();

                // Assert
                expect(result).toBeNull();
            } finally {
                stderrSpy.mockRestore();
            }
        });

        it('loadRules_missingFile_writesWarningToStderr', () => {
            // Arrange
            process.env.CLAUDE_PROJECT_DIR = tmp.root;
            const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

            try {
                // Act
                loadRules();

                // Assert
                expect(stderrSpy).toHaveBeenCalledWith(
                    expect.stringContaining('guardrail-rules.yaml not found')
                );
            } finally {
                stderrSpy.mockRestore();
            }
        });

        it('loadRules_validFile_returnsRulesObject', () => {
            // Arrange
            tmp.write('.claude/guardrail-rules.yaml', `
block_patterns:
  - "rm -rf /"
confirm_patterns:
  - "git push --force"
`);
            process.env.CLAUDE_PROJECT_DIR = tmp.root;

            // Act
            const result = loadRules();

            // Assert
            expect(result).not.toBeNull();
            expect(Array.isArray(result.block_patterns)).toBe(true);
            expect(Array.isArray(result.confirm_patterns)).toBe(true);
        });
    });
});

// ─── Live guardrail-rules.yaml (the REAL repo file, not a fixture) ─────────────
// These lock in the narrowed rm -rf / find -exec confirm patterns against the
// actual shipped rule file — fixtures wouldn't catch a regression in the real
// YAML. (fixture-test-checker-not-live-tree lesson.)

const path = require('path');
const REPO_ROOT = path.resolve(path.dirname(require.resolve('../guardrail.cjs')), '..', '..');

describe('guardrail — live rules (tmp-exempt rm -rf + destructive find -exec)', () => {
    let originalDir;

    beforeEach(() => {
        originalDir = process.env.CLAUDE_PROJECT_DIR;
        process.env.CLAUDE_PROJECT_DIR = REPO_ROOT;
    });

    afterEach(() => {
        if (originalDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
        else process.env.CLAUDE_PROJECT_DIR = originalDir;
    });

    const decision = (command) => {
        const r = processEvent({ tool_input: { command } });
        return r === null ? 'pass' : r.block ? 'block' : r.confirm ? 'confirm' : '?';
    };

    it('rmRf_tmpVar_passesWithoutConfirm', () => {
        // sub-agent tmp cleanup — the exact shape that used to prompt every run
        expect(decision('rm -rf "$T"')).toBe('pass');
        expect(decision('rm -rf "$TMPDIR/scratch"')).toBe('pass');
    });

    it('rmRf_tmpPath_passesWithoutConfirm', () => {
        expect(decision('rm -rf /tmp/tmp.abc123')).toBe('pass');
    });

    it('rmRf_realProjectPath_confirms', () => {
        expect(decision('rm -rf dist')).toBe('confirm');
        expect(decision('rm -fr build')).toBe('confirm');
    });

    it('findExec_readOnlyCommand_passes', () => {
        expect(decision('find . -name "*.js" -exec grep foo {} ;')).toBe('pass');
        expect(decision('find . -type f -exec cat {} ;')).toBe('pass');
    });

    it('findExec_destructiveCommand_confirms', () => {
        expect(decision('find . -exec rm {} ;')).toBe('confirm');
        expect(decision('find /var -name x -exec mv {} /dest ;')).toBe('confirm');
    });

    it('gitPushForce_stillBlocked', () => {
        expect(decision('git push --force')).toBe('block');
    });
});

// ─── Real rules file: rm autonomy exemptions (regression for 2026-06-05 widen) ──
//
// Guards the actual shipped .claude/guardrail-rules.yaml so the temp-path
// exemption that keeps autonomous sub-agents from stalling on `rm -rf` cleanups
// can't silently regress, while real project-path deletes still confirm.
describe('real guardrail-rules.yaml — rm -rf autonomy exemptions', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const here = path.dirname(new URL(import.meta.url).pathname);
    const realRules = parseYaml(
        fs.readFileSync(path.resolve(here, '..', '..', 'guardrail-rules.yaml'), 'utf8')
    );
    const act = (cmd) => checkRules(cmd, realRules).action;

    it('allows recursive deletes of clearly-disposable paths (no confirm)', () => {
        for (const cmd of [
            'rm -rf /tmp/install-test-xY',
            'rm -rf /tmp',
            'rm -rf "$TMPDIR/foo"',
            'rm -rf ./tmp/scratch',
            'rm -rf node_modules',
            'rm -rf .sandbox/mfahub',
            'rm -rf /var/folders/ab/cd/T/scratch',
        ]) {
            expect(act(cmd)).toBe('allow');
        }
    });

    it('still confirms recursive deletes of real project paths', () => {
        for (const cmd of [
            'rm -rf ./src',
            'rm -rf /home/user/code/my-project',
            'rm -rf ~/Documents',
            'sudo rm -fr /etc',
        ]) {
            expect(act(cmd)).toBe('confirm');
        }
    });

    it('confirms dangerous deletes even when an exempt token appears LATER on the line (no whole-line bypass)', () => {
        // Regression for the whole-line-lookahead bypass: a trailing /tmp, a
        // chained safe rm, a node_modules comment, etc. must NOT disarm the guard
        // for a dangerous first target. The exemption binds to the FIRST arg.
        for (const cmd of [
            'rm -rf ~/important && echo /tmp',
            'rm -rf ~/important && echo done; ls /tmp',
            'rm -rf "$HOME" --no-preserve-root; mktemp -d',
            'rm -rf ~/data && npm run build  # node_modules',
            'rm -rf /tmp/a && rm -rf ~/b',          // chained: dangerous 2nd rm
            'rm -rf ~/node_modules_backup_critical', // substring look-alike
            'rm -rf ~/my-tmp/photos',
        ]) {
            expect(act(cmd)).toBe('confirm');
        }
    });

    it('still blocks catastrophic commands', () => {
        expect(act('git push --force')).toBe('block');
        expect(act('mkfs.ext4 /dev/sda')).toBe('block');
    });
});
