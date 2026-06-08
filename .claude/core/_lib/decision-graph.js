/**
 * Decision Graph — data loader for the decision-viz pipeline.
 *
 * Extracted from decision-viz.js:112-334 (parseConcepts, parseCrossRefs,
 * parseGitLog, parseADRs, parseDailyLogs, parseMemoryRecords, collectData,
 * plus the helper functions parseFrontmatter, safeReadDir, safeReadFile, warn).
 *
 * Concern separated: all file I/O and subprocess calls for decision data are
 * here; rendering is in decision-html.js. The orchestrator (decision-viz.js)
 * calls loadDecisionData() then passes the result to renderDecisionHtml().
 *
 * DI seam: loadDecisionData accepts optional { execSync } for git calls.
 * Use the injection param in tests instead of vi.mock('child_process') —
 * vi.mock hoisting breaks across the createRequire(import.meta.url) boundary.
 * See project memory: patterns/di-test-seam-over-vi-mock-esm-cjs-boundary.
 *
 * Path anchoring: all I/O anchors to the passed `projectRoot`, never
 * process.cwd(). See project memory: patterns/anchor-paths-to-project-root-not-cwd.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * @param {string} msg
 */
function warn(msg) {
  process.stderr.write(`[decision-graph] WARN: ${msg}\n`);
}

/**
 * @param {string} dir
 * @returns {fs.Dirent[]}
 */
function safeReadDir(dir) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    warn(`Cannot read directory: ${dir}`);
    return [];
  }
}

/**
 * @param {string} filePath
 * @returns {string|null}
 */
function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    warn(`Cannot read file: ${filePath}`);
    return null;
  }
}

/**
 * Parse YAML frontmatter from a markdown string. Supports list fields
 * (sources, tags, aliases, cssclasses) and scalar key: value fields.
 *
 * @param {string} content
 * @returns {object|null}
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const raw = match[1];
  const result = {};
  const listFields = new Set(['sources', 'tags', 'aliases', 'cssclasses']);
  let currentList = null;
  const lists = {};

  for (const line of raw.split('\n')) {
    const listStart = line.match(/^(\w[\w-]*):\s*$/);
    if (listStart && listFields.has(listStart[1])) {
      currentList = listStart[1];
      lists[currentList] = [];
      continue;
    }

    if (currentList && line.trimStart().startsWith('- ')) {
      lists[currentList].push(line.replace(/^\s*-\s*/, '').trim());
      continue;
    }

    if (currentList && !line.trimStart().startsWith('- ')) {
      currentList = null;
    }

    const kv = line.match(/^([\w-]+):\s*(.+)$/);
    if (kv) result[kv[1]] = kv[2].trim();
  }

  for (const [key, values] of Object.entries(lists)) {
    if (values.length > 0) result[key] = values;
  }

  return result;
}

// ── Parser 1: Concept articles ────────────────────────────────────────────────

/**
 * @param {object} args
 * @param {string} args.conceptsDir  Absolute path to memories/concepts/
 * @param {string[]} args.categories Category slugs to scan
 * @returns {object[]}
 */
function parseConcepts({ conceptsDir, categories }) {
  const concepts = [];

  for (const category of categories) {
    const catDir = path.join(conceptsDir, category);
    const entries = safeReadDir(catDir);

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const filePath = path.join(catDir, entry.name);
      const content = safeReadFile(filePath);
      if (!content) continue;

      const fm = parseFrontmatter(content);
      if (!fm) continue;

      const slug = entry.name.replace(/\.md$/, '');

      // Extract summary from ## Summary section
      // \Z is not a valid JS regex anchor; use $ for end-of-string.
      const summaryMatch = content.match(/## Summary\r?\n\r?\n([\s\S]*?)(?=\r?\n## |\r?\n---|$)/);
      const summary = summaryMatch
        ? summaryMatch[1].trim().split('\n')[0].slice(0, 200)
        : '';

      concepts.push({
        slug,
        title: fm.title || slug,
        category: fm.category || category,
        confidence: parseFloat(fm.confidence) || 0.6,
        created: fm.created || null,
        updated: fm.updated || null,
        sources: fm.sources || [],
        tags: fm.tags || [],
        summary,
      });
    }
  }

  return concepts;
}

// ── Parser 2: Cross-references ────────────────────────────────────────────────

/**
 * @param {string} conceptsDir  Absolute path to memories/concepts/
 * @returns {object}
 */
function parseCrossRefs({ conceptsDir }) {
  const crossRefPath = path.join(conceptsDir, 'cross-references.json');
  // A missing cross-references.json is the normal pre-compilation state (no
  // concepts compiled yet), not an error — don't emit a "Cannot read file"
  // warning for it (F22). Only genuine read failures on an existing file warn.
  if (!fs.existsSync(crossRefPath)) return {};
  const content = safeReadFile(crossRefPath);
  if (!content) return {};

  try {
    return JSON.parse(content);
  } catch {
    warn('Invalid JSON in cross-references.json');
    return {};
  }
}

// ── Parser 3: Git log ─────────────────────────────────────────────────────────

/**
 * @param {object} args
 * @param {string}   args.projectRoot  Absolute path to the repo root
 * @param {Date}     args.cutoffDate   Only include commits after this date
 * @param {Function} [args.execSync]   Optional DI seam — defaults to child_process.execSync
 * @returns {object[]}
 */
function parseGitLog({ projectRoot, cutoffDate, execSync = childProcess.execSync }) {
  const commits = [];
  const since = cutoffDate.toISOString().slice(0, 10);

  try {
    const raw = execSync(
      `git log --format="%H|%ad|%s" --date=iso --since="${since}" -500`,
      { cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    );

    for (const line of raw.split('\n').filter(Boolean)) {
      const parts = line.split('|');
      if (parts.length < 3) continue;
      const hash = parts[0];
      const date = parts[1].trim();
      const message = parts.slice(2).join('|').trim();

      commits.push({ hash, date, message });
    }
  } catch {
    warn('Cannot read git log (not a git repo or no commits)');
  }

  return commits;
}

// ── Parser 4: ADRs from architecture doc ─────────────────────────────────────

/**
 * @param {string} projectRoot  Absolute path to the project root
 * @returns {object[]}
 */
function parseADRs({ projectRoot }) {
  const adrs = [];
  const archPaths = [
    path.join(projectRoot, 'docs', '_project-architecture.md'),
  ];

  let content = null;
  for (const p of archPaths) {
    content = safeReadFile(p);
    if (content) break;
  }

  if (!content) return adrs;

  // Match ### ADR-N: Title sections
  // \Z is not a valid JS anchor (it only matches literal 'Z'); use $ for end-of-string.
  const adrRegex = /### ADR-(\d+)[:\s]+(.+?)(?:\r?\n)([\s\S]*?)(?=\r?\n### |\r?\n## |$)/g;
  let match;

  while ((match = adrRegex.exec(content)) !== null) {
    const number = parseInt(match[1], 10);
    const title = match[2].trim();
    const body = match[3].trim();

    // Try to extract status. Pattern handles both "**Status:** Accepted"
    // (bold colon style) and "Status: Accepted" (plain style).
    // \*?\*? only matches 0-1 asterisks each, missing the ** around the colon —
    // using \*{0,2} and matching the colon+trailing-asterisks explicitly fixes it.
    const statusMatch = body.match(/\*{0,2}Status\*{0,2}:\*{0,2}\s*(\w+)/i);
    const status = statusMatch ? statusMatch[1] : 'unknown';

    // Try to extract date. Same bold-colon fix as status.
    const dateMatch = body.match(/\*{0,2}Date\*{0,2}:\*{0,2}\s*([\d-]+)/i)
      || body.match(/(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch ? dateMatch[1] : null;

    // First non-metadata paragraph as summary
    const lines = body.split('\n').filter(l => l.trim() && !l.match(/^\*?\*?(Status|Date|Context|Decision|Consequences)\*?\*?/i));
    const summary = lines[0] ? lines[0].trim().slice(0, 200) : '';

    adrs.push({ number, title, status, date, summary });
  }

  return adrs;
}

// ── Parser 5: Daily logs ──────────────────────────────────────────────────────

/**
 * @param {object} args
 * @param {string} args.dailyDir     Absolute path to memories/daily/
 * @param {Date}   args.cutoffDate   Exclude logs before this date
 * @returns {object[]}
 */
function parseDailyLogs({ dailyDir, cutoffDate }) {
  const logs = [];
  const entries = safeReadDir(dailyDir);

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    // Extract date from filename
    const dateMatch = entry.name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
    if (!dateMatch) continue;

    const fileDate = new Date(dateMatch[1]);
    if (fileDate < cutoffDate) continue;

    const filePath = path.join(dailyDir, entry.name);
    const content = safeReadFile(filePath);
    if (!content) continue;

    // Extract entries: ## HH:MM — {trigger}
    // \Z is not a valid JS anchor (it only matches literal 'Z'); use $ for end-of-string.
    const entryRegex = /## (\d{2}:\d{2}) — (.+?)(?:\r?\n)([\s\S]*?)(?=\r?\n## |$)/g;
    let m;

    while ((m = entryRegex.exec(content)) !== null) {
      const time = m[1];
      const trigger = m[2].trim();
      const body = m[3].trim();

      // Extract branch info
      const branchMatch = body.match(/\*?\*?Branch:\*?\*?\s*(.+)/);
      const branch = branchMatch ? branchMatch[1].trim() : null;

      logs.push({
        date: dateMatch[1],
        time,
        trigger,
        branch,
        hasCommits: body.includes('### Recent Commits'),
        hasDecisions: body.includes('### Key Decisions'),
      });
    }
  }

  return logs;
}

// ── Parser 6: Memory JSON records ────────────────────────────────────────────

/**
 * @param {object} args
 * @param {string}   args.memoriesDir  Absolute path to memories/
 * @param {string[]} args.categories   Category slugs to scan
 * @returns {object[]}
 */
function parseMemoryRecords({ memoriesDir, categories }) {
  const records = [];

  for (const category of categories) {
    const catDir = path.join(memoriesDir, category);
    const entries = safeReadDir(catDir);

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const filePath = path.join(catDir, entry.name);
      const content = safeReadFile(filePath);
      if (!content) continue;

      try {
        const record = JSON.parse(content);
        records.push({
          id: record.id || entry.name.replace(/\.json$/, ''),
          category: record.category || category,
          confidence: record.metadata?.confidence ?? 1.0,
          created: record.created || null,
          updated: record.updated || null,
          usageCount: record.usage_count || 0,
          description: record.content?.description || record.content?.name || '',
        });
      } catch {
        warn(`Invalid JSON in memory record: ${filePath}`);
      }
    }
  }

  return records;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load all decision data for the visualization pipeline.
 *
 * @param {object} args
 * @param {string}   args.projectRoot   Absolute path to the project root (anchors all I/O)
 * @param {Date}     args.cutoffDate    Only include time-bounded data after this date
 * @param {string[]} args.categories    Memory category slugs (from CONSTANTS.MEMORY_CATEGORIES)
 * @param {Function} [args.execSync]    Optional DI seam for git calls (defaults to child_process.execSync)
 * @returns {{ concepts: object[], crossReferences: object, commits: object[], adrs: object[], memories: object[], dailyLogs: object[] }}
 */
function loadDecisionData({ projectRoot, cutoffDate, categories, execSync }) {
  const memoriesDir = path.join(projectRoot, 'docs', '.output', 'memories');
  const conceptsDir = path.join(memoriesDir, 'concepts');
  const dailyDir = path.join(memoriesDir, 'daily');

  return {
    concepts: parseConcepts({ conceptsDir, categories }),
    crossReferences: parseCrossRefs({ conceptsDir }),
    commits: parseGitLog({ projectRoot, cutoffDate, execSync }),
    adrs: parseADRs({ projectRoot }),
    dailyLogs: parseDailyLogs({ dailyDir, cutoffDate }),
    memories: parseMemoryRecords({ memoriesDir, categories }),
  };
}

module.exports = {
  loadDecisionData,
  // Exported for unit testing of individual parsers:
  parseFrontmatter,
  parseConcepts,
  parseCrossRefs,
  parseGitLog,
  parseADRs,
  parseDailyLogs,
  parseMemoryRecords,
};
