#!/usr/bin/env node

/**
 * Secret Patterns — Shared Module
 *
 * Provides secret detection patterns, scanning logic, and utility functions
 * shared between the pre-write secret scanner and the post-read scrubber.
 *
 * Used by:
 *   - secret-scanner.cjs (PreToolUse:Write/Edit + git pre-commit)
 *   - post-read-scrubber.cjs (PostToolUse:Read)
 */

const path = require('path');

// ============================================
// Secret Patterns (organized by category)
// ============================================

const PATTERNS = [

    // --- Cloud Providers ---
    { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/g },
    { name: 'AWS Secret Key', regex: /(?:aws_secret_access_key|aws_secret)\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/gi },
    { name: 'AWS Session Token', regex: /(?:aws_session_token|AWS_SESSION_TOKEN)\s*[=:]\s*['"]?[A-Za-z0-9/+=]{100,}['"]?/g },
    { name: 'Azure Storage Key', regex: /AccountKey=[A-Za-z0-9+/=]{88}/g },
    { name: 'Azure Connection String', regex: /DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[^;]+/g },
    { name: 'Azure SAS Token', regex: /[?&]sig=[A-Za-z0-9%+/=]{43,}(?:&|$)/g },
    { name: 'GCP Service Account', regex: /"private_key":\s*"-----BEGIN [A-Z ]+ PRIVATE KEY-----/g },
    { name: 'GCP API Key', regex: /AIza[0-9A-Za-z_-]{35}/g },
    { name: 'DigitalOcean PAT', regex: /dop_v1_[a-f0-9]{64}/g },
    { name: 'DigitalOcean OAuth', regex: /doo_v1_[a-f0-9]{64}/g },

    // --- Platform Tokens ---
    { name: 'GitHub Token', regex: /gh[pousr]_[A-Za-z0-9_]{36,255}/g },
    { name: 'GitHub Fine-Grained PAT', regex: /github_pat_[A-Za-z0-9_]{22,255}/g },
    { name: 'GitLab PAT', regex: /glpat-[A-Za-z0-9\-_]{20,}/g },
    { name: 'Bitbucket App Password', regex: /ATBB[A-Za-z0-9]{32,}/g },
    { name: 'Atlassian API Token', regex: /ATATT3[A-Za-z0-9_\-=]{186}/g },
    { name: 'Slack Token', regex: /xox[bpors]-[0-9]+-[0-9]+-[A-Za-z0-9]+/g },
    { name: 'Slack App Token', regex: /xapp-[0-9]+-[A-Za-z0-9]+-[0-9]+-[A-Za-z0-9]+/g },
    { name: 'Slack Webhook', regex: /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g },
    { name: 'Discord Webhook', regex: /discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+/g },

    // --- AI / LLM Keys ---
    { name: 'OpenAI Key', regex: /sk-(?!proj-|ant-)[A-Za-z0-9]{20,}/g },
    { name: 'OpenAI Project Key', regex: /sk-proj-[A-Za-z0-9_-]{40,}/g },
    { name: 'OpenAI Service Key', regex: /sk-svcacct-[A-Za-z0-9_-]{40,}/g },
    { name: 'Anthropic Key', regex: /sk-ant-[A-Za-z0-9_-]{40,}/g },
    { name: 'HuggingFace Token', regex: /hf_[A-Za-z]{34}/g },
    { name: 'HuggingFace Org Token', regex: /api_org_[A-Za-z]{34}/g },

    // --- Payment / SaaS ---
    { name: 'Stripe Key', regex: /[sr]k_(live|test)_[A-Za-z0-9]{24,}/g },
    { name: 'Square Access Token', regex: /sq0atp-[A-Za-z0-9_-]{22,}/g },
    { name: 'Square OAuth Secret', regex: /sq0csp-[A-Za-z0-9_-]{43,}/g },
    { name: 'Shopify Token', regex: /shp(?:at|ca|pa|ss)_[a-fA-F0-9]{32,}/g },
    { name: 'CoinGecko API Key', regex: /\bCG-[A-Za-z0-9]{20,}\b/g },

    // --- CI/CD & DevOps ---
    { name: 'npm Token', regex: /npm_[A-Za-z0-9]{36}/g },
    { name: 'PyPI Token', regex: /pypi-[A-Za-z0-9_-]{100,}/g },
    { name: 'NuGet API Key', regex: /oy2[a-z0-9]{43}/g },
    { name: 'Docker Hub PAT', regex: /dckr_pat_[A-Za-z0-9_-]{27,}/g },
    { name: 'Grafana API Key', regex: /eyJrIjoi[A-Za-z0-9]{70,400}={0,3}/g },
    { name: 'Grafana Cloud Token', regex: /glc_[A-Za-z0-9+/]{32,400}={0,3}/g },
    { name: 'Grafana Service Token', regex: /glsa_[A-Za-z0-9]{32}_[A-Fa-f0-9]{8}/g },
    { name: 'Databricks Token', regex: /dapi[a-f0-9]{32}/g },
    { name: 'Doppler Token', regex: /dp\.pt\.[A-Za-z0-9]{43}/g },
    { name: 'CircleCI Token', regex: /ccipat_[A-Za-z0-9]{40}/g },

    // --- Infrastructure & Monitoring ---
    { name: 'Hashicorp Vault Token', regex: /hvs\.[A-Za-z0-9_-]{24,}/g },
    { name: 'Hashicorp TF Token', regex: /[a-zA-Z0-9]{14}\.atlasv1\.[a-zA-Z0-9_-]{67}/g },
    { name: 'Cloudflare Origin CA', regex: /v1\.0-[a-f0-9]{24}-[a-f0-9]{146}/g },
    { name: 'Supabase Key', regex: /sbp_[a-f0-9]{40}/g },
    { name: 'Vercel Token', regex: /vercel_[A-Za-z0-9_-]{24,}/gi },
    { name: 'Linear API Key', regex: /lin_api_[A-Za-z0-9]{40}/g },
    { name: 'Postman API Key', regex: /PMAK-[a-f0-9]{24}-[a-f0-9]{34}/g },
    { name: 'Telegram Bot Token', regex: /\b[0-9]{8,10}:[A-Za-z0-9_-]{35}\b/g },

    // --- Communication ---
    { name: 'SendGrid Key', regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g },
    { name: 'Twilio Key', regex: /\bSK[0-9a-fA-F]{32}\b/g },
    { name: 'Mailgun Key', regex: /\bkey-[0-9a-zA-Z]{32}\b/g },

    // --- Auth Tokens ---
    { name: 'JWT Token', regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
    { name: 'Bearer Token', regex: /[Bb]earer\s+[A-Za-z0-9_\-.~+/]{40,}=*/g },

    // --- Cryptographic Material ---
    { name: 'Private Key', regex: /-----BEGIN\s(?:RSA\s|EC\s|DSA\s|OPENSSH\s)?PRIVATE\sKEY-----/g },
    { name: 'PGP Private Key', regex: /-----BEGIN\sPGP\sPRIVATE\sKEY\sBLOCK-----/g },

    // --- Generic Credential Patterns ---
    { name: 'Password Assignment', regex: /(?:password|passwd|pwd)['"]?\s*[=:]\s*['"][^'"]{8,}['"]/gi },
    { name: 'Secret Assignment', regex: /(?:secret|api_?key|apikey|access_?key|auth_?token|client_?secret)['"]?\s*[=:]\s*['"][^'"]{8,}['"]/gi },
    { name: 'Connection String', regex: /(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp|mssql):\/\/[^\s'"]{1,256}:[^\s'"]{1,256}@[^\s'"]{1,2000}/gi },
    { name: 'Database URL', regex: /DATABASE_URL\s*=\s*['"]?[^\s'"]+:\/\/[^\s'"]+/gi },
];

// ============================================
// Placeholder / Dummy Value Allowlist
// ============================================

const PLACEHOLDER_PATTERNS = [
    /^['"]?(?:changeme|password|example|test(?:ing)?|dummy|placeholder|xxx+|sample|default)['"]?$/i,
    /^['"]?(?:your[_-]?(?:key|token|secret|password|api[_-]?key)|TODO|REPLACE[_-]?ME|INSERT[_-]?HERE)['"]?$/i,
    /^['"]?<[^>]+>['"]?$/,                  // <your-key-here>
    /^['"]?\{[^}]+\}['"]?$/,                // {placeholder}
    /^['"]?\$\{[^}]+\}['"]?$/,              // ${VARIABLE}
    /^['"]?\$[A-Z_]+['"]?$/,                // $ENV_VAR
];

function isPlaceholderValue(matched) {
    const valueMatch = matched.match(/[=:]\s*['"]?(.+?)['"]?\s*$/);
    if (!valueMatch) return false;
    const value = valueMatch[1];
    return PLACEHOLDER_PATTERNS.some(p => p.test(value));
}

// ============================================
// High-Risk File Detection
// ============================================

const HIGH_RISK_BASENAMES = [
    /^\.env$/,
    /^\.env\..+$/,
    /^credentials\.json$/,
    /^service[_-]?account\.json$/,
    /\.pem$/,
    /\.key$/,
    /\.p12$/,
    /\.pfx$/,
    /\.jks$/,
    /^id_rsa$/,
    /^id_ed25519$/,
    /\.keystore$/,
    /^\.htpasswd$/,
    /^\.npmrc$/,
    /^\.pypirc$/,
    /^\.netrc$/,
    /^\.pgpass$/,
    /^\.my\.cnf$/,
    /^\.s3cfg$/,
    /^\.boto$/,
    /^terraform\.tfvars$/,
    /^\.terraform\.tfvars$/,
    /^credentials$/,
];

const HIGH_RISK_PATHS = [
    /\.docker\/config\.json$/,
    /\.kube\/config$/,
];

const SKIP_PATHS = [
    /secret-scanner\.cjs$/,
    /secret-patterns\.cjs$/,
    /post-read-scrubber\.cjs$/,
    /\.claude\/skills\//,
    /\.claude\/templates\//,
    /node_modules\//,
    /\.git\//,
    // NOTE: docs/.output/ is deliberately NOT skipped. It holds generated
    // reviews/digests/handoffs that routinely quote config — the single most
    // likely place to echo a real secret (a /review:security report writing
    // into docs/.output/reviews/ is exactly how a live CoinGecko key once
    // leaked past this scanner). Hook-internal writes (telemetry, memories)
    // go through fs, not the Write tool, so they bypass the PreToolUse scan
    // regardless; only Claude-authored Write/Edit + staged-commit content is
    // scanned here, which is precisely what we want covered.
    /package-lock\.json$/,
    /yarn\.lock$/,
    /pnpm-lock\.yaml$/,
    // Test files legitimately contain fixtures (mock secrets, fake passwords for
    // auth-flow integration tests) that match the Password/Secret Assignment
    // patterns. A secret committed here would be a bigger problem than the
    // scanner can solve; code review is the right gate.
    /__test__\//,
    /__tests__\//,
    /\.test\.(ts|tsx|js|jsx|mjs|cjs)$/,
    /\.spec\.(ts|tsx|js|jsx|mjs|cjs)$/,
];

// ============================================
// Scanner Core
// ============================================

function shouldSkipPath(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    return SKIP_PATHS.some(pattern => pattern.test(normalized));
}

function isHighRiskFile(filePath) {
    const basename = path.basename(filePath);
    const normalized = filePath.replace(/\\/g, '/');
    return HIGH_RISK_BASENAMES.some(p => p.test(basename))
        || HIGH_RISK_PATHS.some(p => p.test(normalized));
}

function scanContent(content, filePath) {
    const findings = [];

    if (filePath && isHighRiskFile(filePath)) {
        findings.push({
            type: 'HIGH_RISK_FILE',
            name: 'Sensitive file type',
            file: filePath,
            line: 0,
            match: path.basename(filePath),
        });
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        for (const pattern of PATTERNS) {
            const matches = line.matchAll(pattern.regex);
            for (const match of matches) {
                if ((pattern.name === 'Password Assignment' ||
                    pattern.name === 'Secret Assignment') &&
                    isPlaceholderValue(match[0])) {
                    continue;
                }

                findings.push({
                    type: 'SECRET_PATTERN',
                    name: pattern.name,
                    file: filePath || '<stdin>',
                    line: i + 1,
                    match: redact(match[0]),
                });
            }
        }
    }

    return findings;
}

function redact(value) {
    if (value.length <= 12) return value.substring(0, 4) + '***';
    return value.substring(0, 8) + '...' + value.substring(value.length - 4);
}

/**
 * Replace every detected secret in `content` with a `<REDACTED:PatternName>`
 * marker. Used by post-read-scrubber.cjs to rewrite tool output before Claude
 * sees it (PostToolUse `hookSpecificOutput.updatedToolOutput`).
 *
 * Same placeholder filter as scanContent — Password/Secret Assignment matches
 * whose value is a known placeholder (changeme, ${VAR}, etc.) are NOT redacted.
 *
 * Pattern ordering: PATTERNS is iterated in declaration order; each pattern
 * does a global replaceAll. Once a match is wrapped in `<REDACTED:...>`, later
 * patterns won't re-match the marker text. Test case
 * `redactSecretsInText_multipleSecrets_allReplaced` pins this.
 *
 * @param {string} content - Original tool output to scan and redact
 * @returns {string} Content with detected secrets replaced; unchanged if no findings
 */
function redactSecretsInText(content) {
    if (!content) return content;

    let result = content;
    for (const pattern of PATTERNS) {
        // Reset regex state — patterns are declared with /g, which carries
        // lastIndex across calls if reused. Use replaceAll with a fresh regex
        // built from the source to avoid lastIndex pitfalls.
        const re = new RegExp(pattern.regex.source, pattern.regex.flags);
        result = result.replace(re, (match) => {
            // Same placeholder filter scanContent uses for these two patterns
            if ((pattern.name === 'Password Assignment' ||
                 pattern.name === 'Secret Assignment') &&
                isPlaceholderValue(match)) {
                return match;
            }
            return `<REDACTED:${pattern.name}>`;
        });
    }
    return result;
}

function formatFindings(findings) {
    if (findings.length === 0) return null;

    const lines = [
        '',
        '========================================',
        '  SECRET SCANNER — FINDINGS',
        '========================================',
        '',
    ];

    for (const f of findings) {
        const loc = f.line > 0 ? `:${f.line}` : '';
        lines.push(`  [${f.type}] ${f.name}`);
        lines.push(`    File:  ${f.file}${loc}`);
        lines.push(`    Match: ${f.match}`);
        lines.push('');
    }

    lines.push('----------------------------------------');
    lines.push(`  ${findings.length} potential secret(s) detected.`);
    lines.push('  Remove secrets before proceeding.');
    lines.push('  Use environment variables or a secret manager instead.');
    lines.push('========================================');

    return lines.join('\n');
}

// ============================================
// Stdin reader (shared utility)
// ============================================

function readStdin() {
    return new Promise((resolve) => {
        if (process.stdin.isTTY) {
            resolve('');
            return;
        }

        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', () => resolve(''));
    });
}

module.exports = {
    PATTERNS,
    PLACEHOLDER_PATTERNS,
    SKIP_PATHS,
    HIGH_RISK_BASENAMES,
    HIGH_RISK_PATHS,
    isPlaceholderValue,
    shouldSkipPath,
    isHighRiskFile,
    scanContent,
    redact,
    redactSecretsInText,
    formatFindings,
    readStdin,
};
