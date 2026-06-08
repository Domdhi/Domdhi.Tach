import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
    PATTERNS,
    scanContent,
    shouldSkipPath,
    formatFindings,
    redact,
    redactSecretsInText,
} = require('../secret-patterns.cjs');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build secret fixtures at runtime (string concatenation) to avoid tripping
 * the repo's own pre-commit secret-scanner hook.
 */
function fakeAwsKey() {
    return 'AKIA' + 'IOSFODNN7' + 'EXAMPLE123456';   // 16 chars after AKIA
}

function fakeOpenAiKey() {
    return 'sk-' + 'abcdefghij' + 'klmnopqrstu' + 'vwxyz01234' + '5678901234';
}

function fakeOpenAiProjectKey() {
    return 'sk-proj-' + 'abcdefghijklmnopqrstuvwxyz01234567890ABCDEFGHIJ';
}

function fakeAnthropicKey() {
    return 'sk-ant-' + 'abcdefghijklmnopqrstuvwxyz01234567890ABCDE';
}

function fakeGitHubPAT() {
    return 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789AB';
}

function fakeGitHubFineGrainedPAT() {
    return 'github_pat_' + 'abcdefghijklmnopqrstuvwxyz0123456789';
}

function fakeStripeKey() {
    return 'sk_live_' + 'abcdefghijklmnopqrstuvwx';   // 24 chars after prefix
}

function fakeNpmToken() {
    return 'npm_' + 'abcdefghijklmnopqrstuvwxyz0123456789';
}

function fakeJWT() {
    return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
        '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ' +
        '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
}

function fakePrivateKeyHeader() {
    // Built at runtime so the repo's own secret-scanner pre-commit doesn't flag
    // this literal in the test file. The scanner is the thing under test.
    return '-----BEGIN ' + 'RSA' + ' PRIVATE ' + 'KEY-----';
}

function fakeSlackToken() {
    return 'xoxb-' + '123456789012' + '-' + '123456789012' + '-' + 'abcdefghijklmnopqrstuvwx';
}

function fakeSendGridKey() {
    // Pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/
    // Needs SG + . + 22 chars + . + 43 chars. Built at runtime.
    return 'SG.' + 'a'.repeat(22) + '.' + 'b'.repeat(43);
}

// ─── PATTERNS array ───────────────────────────────────────────────────────────

describe('PATTERNS', () => {
    it('PATTERNS_array_hasAtLeast50Entries', () => {
        expect(Array.isArray(PATTERNS)).toBe(true);
        expect(PATTERNS.length).toBeGreaterThanOrEqual(50);
    });

    it('PATTERNS_eachEntry_hasNameAndRegex', () => {
        for (const p of PATTERNS) {
            expect(typeof p.name).toBe('string');
            expect(p.name.length).toBeGreaterThan(0);
            expect(p.regex).toBeInstanceOf(RegExp);
        }
    });

    it('PATTERNS_names_areUnique', () => {
        const names = PATTERNS.map(p => p.name);
        const uniqueNames = new Set(names);
        expect(uniqueNames.size).toBe(names.length);
    });
});

// ─── scanContent — secret detections ─────────────────────────────────────────

describe('scanContent', () => {

    describe('scanContent_awsKey', () => {
        it('scanContent_awsAccessKey_detected', () => {
            const content = `const key = "${fakeAwsKey()}";`;
            const findings = scanContent(content, 'config.js');
            const names = findings.map(f => f.name);
            expect(names).toContain('AWS Access Key');
        });
    });

    describe('scanContent_openaiKey', () => {
        it('scanContent_openAiKey_detected', () => {
            const content = `OPENAI_API_KEY=${fakeOpenAiKey()}`;
            const findings = scanContent(content, 'config.js');
            const names = findings.map(f => f.name);
            expect(names).toContain('OpenAI Key');
        });

        it('scanContent_openAiProjectKey_detected', () => {
            const content = `const apiKey = "${fakeOpenAiProjectKey()}";`;
            const findings = scanContent(content, 'config.js');
            const names = findings.map(f => f.name);
            expect(names).toContain('OpenAI Project Key');
        });
    });

    describe('scanContent_anthropicKey', () => {
        it('scanContent_anthropicKey_detected', () => {
            const content = `ANTHROPIC_API_KEY=${fakeAnthropicKey()}`;
            const findings = scanContent(content, 'config.js');
            const names = findings.map(f => f.name);
            expect(names).toContain('Anthropic Key');
        });
    });

    describe('scanContent_githubPAT', () => {
        it('scanContent_githubPAT_detected', () => {
            const content = `token: ${fakeGitHubPAT()}`;
            const findings = scanContent(content, 'config.yml');
            const names = findings.map(f => f.name);
            expect(names).toContain('GitHub Token');
        });

        it('scanContent_githubFineGrainedPAT_detected', () => {
            const content = `GH_TOKEN=${fakeGitHubFineGrainedPAT()}`;
            const findings = scanContent(content, '.env');
            const names = findings.map(f => f.name);
            expect(names).toContain('GitHub Fine-Grained PAT');
        });
    });

    describe('scanContent_sshPrivateKey', () => {
        it('scanContent_sshPrivateKeyHeader_detected', () => {
            const content = fakePrivateKeyHeader() + '\nMIIEowIBAAKCAQEA...';
            const findings = scanContent(content, 'id_rsa');
            const names = findings.map(f => f.name);
            expect(names).toContain('Private Key');
        });
    });

    describe('scanContent_jwt', () => {
        it('scanContent_jwtToken_detected', () => {
            const content = `Authorization: Bearer ${fakeJWT()}`;
            const findings = scanContent(content, 'request.http');
            const names = findings.map(f => f.name);
            expect(names).toContain('JWT Token');
        });
    });

    describe('scanContent_stripeKey', () => {
        it('scanContent_stripeLiveKey_detected', () => {
            const content = `STRIPE_SECRET_KEY=${fakeStripeKey()}`;
            const findings = scanContent(content, '.env');
            const names = findings.map(f => f.name);
            expect(names).toContain('Stripe Key');
        });
    });

    describe('scanContent_npmToken', () => {
        it('scanContent_npmToken_detected', () => {
            const content = `//registry.npmjs.org/:_authToken=${fakeNpmToken()}`;
            const findings = scanContent(content, '.npmrc');
            const names = findings.map(f => f.name);
            expect(names).toContain('npm Token');
        });
    });

    describe('scanContent_slackToken', () => {
        it('scanContent_slackBotToken_detected', () => {
            const content = `SLACK_TOKEN=${fakeSlackToken()}`;
            const findings = scanContent(content, 'config.js');
            const names = findings.map(f => f.name);
            expect(names).toContain('Slack Token');
        });
    });

    describe('scanContent_sendgridKey', () => {
        it('scanContent_sendgridKey_detected', () => {
            const content = `SENDGRID_API_KEY=${fakeSendGridKey()}`;
            const findings = scanContent(content, 'config.js');
            const names = findings.map(f => f.name);
            expect(names).toContain('SendGrid Key');
        });
    });

    describe('scanContent_connectionString', () => {
        it('scanContent_postgresConnectionString_detected', () => {
            const content = 'postgres://user:' + 'mypassword123' + '@db.example.com/mydb';
            const findings = scanContent(content, 'config.js');
            const names = findings.map(f => f.name);
            expect(names).toContain('Connection String');
        });
    });

    describe('scanContent_jsonQuotedAssignment', () => {
        // Regression: JSON config writes the key name in quotes ("api_key": "…"),
        // which put a quote between the key and the `:` separator and slipped the
        // Secret/Password assignment patterns — the most common place a key lives.
        it('scanContent_jsonQuotedApiKey_detected', () => {
            const content = '{ "api_key": "CG-abcd1234efgh5678" }';
            const findings = scanContent(content, 'config.local.json');
            expect(findings.map(f => f.name)).toContain('Secret Assignment');
        });

        it('scanContent_jsonQuotedPassword_detected', () => {
            const content = '{ "password": "hunter2hunter2" }';
            const findings = scanContent(content, 'config.local.json');
            expect(findings.map(f => f.name)).toContain('Password Assignment');
        });
    });

    describe('scanContent_coinGeckoKey', () => {
        // Regression: a bare CG-… token in prose (e.g. inside a security report)
        // slipped every pattern — only the "api_key": "…" assignment forms caught
        // it. A live CoinGecko key leaked this exact way.
        it('scanContent_coinGeckoBareToken_detected', () => {
            const content = 'leaked key CG-' + 'abcDEF123456ghiJKL789mn' + ' in config';
            const findings = scanContent(content, 'docs/.output/reviews/audit.md');
            expect(findings.map(f => f.name)).toContain('CoinGecko API Key');
        });

        it('scanContent_coinGeckoShortRef_noDetection', () => {
            // A changelog reference like "CG-1" must not false-positive.
            const findings = scanContent('see CG-1 in the changelog', 'CHANGELOG.md');
            expect(findings.filter(f => f.name === 'CoinGecko API Key')).toHaveLength(0);
        });
    });

    describe('scanContent_findings_structure', () => {
        it('scanContent_finding_hasRequiredFields', () => {
            const content = `key = "${fakeAwsKey()}"`;
            const findings = scanContent(content, 'config.js');
            expect(findings.length).toBeGreaterThan(0);
            const f = findings[0];
            expect(f).toHaveProperty('type');
            expect(f).toHaveProperty('name');
            expect(f).toHaveProperty('file');
            expect(f).toHaveProperty('line');
            expect(f).toHaveProperty('match');
        });

        it('scanContent_finding_lineNumberIsOneBased', () => {
            const content = 'line1\nline2\n' + fakeAwsKey();
            const findings = scanContent(content, 'test.js');
            const awsFinding = findings.find(f => f.name === 'AWS Access Key');
            expect(awsFinding.line).toBe(3);
        });

        it('scanContent_cleanContent_returnsEmptyArray', () => {
            const findings = scanContent('const x = 1;\nconsole.log(x);\n', 'clean.js');
            expect(findings).toEqual([]);
        });
    });

    // ─── False-positive boundary tests ───────────────────────────────────────

    describe('scanContent_falsePositives', () => {
        it('scanContent_akiaInComment_withNonCredentialChars_noDetection', () => {
            // AKIA followed by lowercase / mixed-case that won't match [0-9A-Z]{16}
            const content = '// AKIA example in a comment — not a real key';
            const findings = scanContent(content, 'README.md');
            const awsFindings = findings.filter(f => f.name === 'AWS Access Key');
            expect(awsFindings).toHaveLength(0);
        });

        it('scanContent_skDashDocumentation_noDetection', () => {
            // A documentation mention "pattern like sk-..." with only a few chars
            const content = 'The API key format looks like `sk-...` or `sk-proj-...`';
            const findings = scanContent(content, 'docs.md');
            const openAiFindings = findings.filter(f =>
                f.name === 'OpenAI Key' || f.name === 'OpenAI Project Key'
            );
            expect(openAiFindings).toHaveLength(0);
        });

        it('scanContent_passwordPlaceholder_changeme_noDetection', () => {
            const content = "password = 'changeme'";
            const findings = scanContent(content, 'config.js');
            const passwordFindings = findings.filter(f => f.name === 'Password Assignment');
            expect(passwordFindings).toHaveLength(0);
        });

        it('scanContent_secretPlaceholder_templateVariable_noDetection', () => {
            const content = 'api_key = "${API_KEY}"';
            const findings = scanContent(content, 'config.js');
            const secretFindings = findings.filter(f => f.name === 'Secret Assignment');
            expect(secretFindings).toHaveLength(0);
        });

        it('scanContent_emptyString_returnsEmptyArray', () => {
            const findings = scanContent('', 'empty.js');
            expect(findings).toEqual([]);
        });
    });
});

// ─── shouldSkipPath ───────────────────────────────────────────────────────────

describe('shouldSkipPath', () => {
    it('shouldSkipPath_gitDirectory_returnsTrue', () => {
        expect(shouldSkipPath('/project/.git/config')).toBe(true);
    });

    it('shouldSkipPath_nodeModules_returnsTrue', () => {
        expect(shouldSkipPath('/project/node_modules/lodash/index.js')).toBe(true);
    });

    it('shouldSkipPath_docsOutput_returnsFalse', () => {
        // docs/.output/ is deliberately NOT skipped — its generated reviews/
        // digests routinely quote config and are the most likely place to echo
        // a real secret (a /review:security report once leaked a live key here).
        expect(shouldSkipPath('/project/docs/.output/reviews/x-security-audit.md')).toBe(false);
        expect(shouldSkipPath('/project/docs/.output/handoffs/x-end-main.md')).toBe(false);
        expect(shouldSkipPath('/project/docs/.output/plans/my-plan.md')).toBe(false);
    });

    it('shouldSkipPath_secretScannerItself_returnsTrue', () => {
        expect(shouldSkipPath('/project/.claude/hooks/secret-scanner.cjs')).toBe(true);
    });

    it('shouldSkipPath_secretPatternsItself_returnsTrue', () => {
        expect(shouldSkipPath('/project/.claude/hooks/secret-patterns.cjs')).toBe(true);
    });

    it('shouldSkipPath_regularSourceFile_returnsFalse', () => {
        expect(shouldSkipPath('/project/src/index.js')).toBe(false);
    });

    it('shouldSkipPath_envFile_returnsFalse', () => {
        // .env is NOT in SKIP_PATHS — it's a high-risk file but still scanned
        expect(shouldSkipPath('/project/.env')).toBe(false);
    });

    it('shouldSkipPath_windowsBackslash_normalizedCorrectly', () => {
        // Windows-style paths should be handled via normalization
        expect(shouldSkipPath('C:\\project\\node_modules\\lodash\\index.js')).toBe(true);
    });
});

// ─── formatFindings ───────────────────────────────────────────────────────────

describe('formatFindings', () => {
    it('formatFindings_emptyArray_returnsNull', () => {
        expect(formatFindings([])).toBeNull();
    });

    it('formatFindings_singleFinding_containsExpectedFields', () => {
        const findings = [{
            type: 'SECRET_PATTERN',
            name: 'AWS Access Key',
            file: 'config.js',
            line: 3,
            match: 'AKIA1234...5678',
        }];
        const output = formatFindings(findings);
        expect(typeof output).toBe('string');
        expect(output).toContain('AWS Access Key');
        expect(output).toContain('config.js');
        expect(output).toContain(':3');
        expect(output).toContain('AKIA1234...5678');
    });

    it('formatFindings_multiplefindings_containsCount', () => {
        const findings = [
            { type: 'SECRET_PATTERN', name: 'AWS Access Key', file: 'a.js', line: 1, match: 'AKIA...1234' },
            { type: 'SECRET_PATTERN', name: 'OpenAI Key', file: 'b.js', line: 5, match: 'sk-ab...cdef' },
        ];
        const output = formatFindings(findings);
        expect(output).toContain('2 potential secret(s)');
    });

    it('formatFindings_output_containsSeparators', () => {
        const findings = [{
            type: 'SECRET_PATTERN',
            name: 'Test Pattern',
            file: 'test.js',
            line: 1,
            match: 'redacted',
        }];
        const output = formatFindings(findings);
        expect(output).toContain('========================================');
        expect(output).toContain('SECRET SCANNER');
    });

    it('formatFindings_finding_lineZero_omitsLineNumber', () => {
        const findings = [{
            type: 'HIGH_RISK_FILE',
            name: 'Sensitive file type',
            file: '.env',
            line: 0,
            match: '.env',
        }];
        const output = formatFindings(findings);
        // line: 0 → no ":0" suffix appended
        expect(output).not.toContain(':0');
    });
});

// ─── redact ──────────────────────────────────────────────────────────────────

describe('redact', () => {
    it('redact_shortValue_showsFirstFourPlusMask', () => {
        const result = redact('abc123');
        expect(result).toMatch(/^abc1\*{3}$/);
    });

    it('redact_longValue_showsHeadAndTail', () => {
        const longVal = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const result = redact(longVal);
        expect(result).toContain('ABCDEFGH');
        expect(result).toContain('...');
        expect(result.endsWith(longVal.slice(-4))).toBe(true);
    });

    it('redact_exactlyTwelveChars_useShortPath', () => {
        // length <= 12 → short path
        const val = '123456789012';
        const result = redact(val);
        expect(result).toMatch(/^1234\*{3}$/);
    });

    it('redact_thirteenChars_useLongPath', () => {
        // length > 12 → long path
        const val = '1234567890123';
        const result = redact(val);
        expect(result).toContain('...');
    });
});

// ─── redactSecretsInText (R7 — tool-output secret redaction) ──────────────────

describe('redactSecretsInText', () => {

    it('redactSecretsInText_secretInContent_replacedWithToken', () => {
        // AC1: secret detected in content → replaced with <REDACTED:PatternName>
        const fakeKey = fakeAwsKey();
        const content = `export const key = "${fakeKey}";`;
        const result = redactSecretsInText(content);

        expect(result).not.toContain(fakeKey);
        expect(result).toContain('<REDACTED:AWS Access Key>');
    });

    it('redactSecretsInText_multipleSecrets_allReplaced', () => {
        // AC1: multi-pattern coverage — AWS + Anthropic in one blob, both replaced
        const aws = fakeAwsKey();
        const ant = fakeAnthropicKey();
        const content = `aws=${aws}\nant=${ant}\n`;
        const result = redactSecretsInText(content);

        expect(result).not.toContain(aws);
        expect(result).not.toContain(ant);
        expect(result).toContain('<REDACTED:AWS Access Key>');
        expect(result).toContain('<REDACTED:Anthropic Key>');
    });

    it('redactSecretsInText_placeholderNotRedacted', () => {
        // AC2: Password Assignment with placeholder value → unchanged
        const content = 'password = "changeme"';
        const result = redactSecretsInText(content);

        expect(result).toBe(content);
    });

    it('redactSecretsInText_placeholderEnvVarNotRedacted', () => {
        // AC2: ${VARIABLE} placeholder → unchanged
        const content = 'api_key = "${API_KEY}"';
        const result = redactSecretsInText(content);

        expect(result).toBe(content);
    });

    it('redactSecretsInText_cleanContent_unchanged', () => {
        // AC1 negative: no patterns match → content returned as-is
        const content = 'const x = 42;\nconsole.log(x);\n';
        const result = redactSecretsInText(content);

        expect(result).toBe(content);
    });

    it('redactSecretsInText_emptyContent_returnsEmpty', () => {
        // Edge case: empty input
        expect(redactSecretsInText('')).toBe('');
    });

    it('redactSecretsInText_preservesSurroundingText', () => {
        // Substitution must not damage surrounding non-secret content
        const fakeKey = fakeAwsKey();
        const content = `before\nkey="${fakeKey}"\nafter`;
        const result = redactSecretsInText(content);

        expect(result).toMatch(/^before\n/);
        expect(result).toMatch(/\nafter$/);
        expect(result).toContain('<REDACTED:AWS Access Key>');
    });

});
