#!/usr/bin/env node

/**
 * Status — Parse TODO files and generate an HTML dashboard.
 *
 * Scans for TODO files in docs/, parses checkbox markers, and produces:
 *   - A compact text summary to stdout
 *   - An HTML dashboard at docs/.output/status.html
 *
 * Usage:
 *   node .claude/core/status.js              # Full scan + HTML
 *   node .claude/core/status.js --text-only  # Text summary only (no HTML)
 *
 * Supported TODO formats:
 *   - Master index (TODO_{Project}.md) — Phase Map + Epic Index tables
 *   - Per-epic checklists (TODO_epic*.md) — flat checkbox lists
 *   - /todo output — Story Index tables with Status column
 *
 * Architecture note (P2.4):
 *   Metrics loading is delegated to _lib modules:
 *     loadCodeMetrics   — LOC + file count
 *     loadMemoryMetrics — memory store health via MemoryManager API
 *     loadGitMetrics    — commit count, branch, 7-day velocity
 *     readSummary       — last gate build/test outcome
 *   HTML generation is delegated to _lib/status-html.js.
 *   TODO parsing (findTodoFiles, parseTodoFile) stays inline — tightly coupled to
 *   output formatter, no other consumer.
 */

const fs = require('fs');
const path = require('path');
const { globSync } = (() => {
  try { return require('glob'); } catch { return { globSync: null }; }
})();

const { loadCodeMetrics }   = require('./_lib/code-metrics');
const { loadMemoryMetrics } = require('./_lib/memory-metrics');
const { loadGitMetrics }    = require('./_lib/git-metrics');
const { readSummary }       = require('./_lib/gate-summary');
const { generateHtml, esc } = require('./_lib/status-html');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
const OUTPUT_DIR   = path.join(PROJECT_ROOT, 'docs', '.output');
const OUTPUT_FILE  = path.join(OUTPUT_DIR, 'status.html');
const TEXT_ONLY    = process.argv.includes('--text-only');

// ── Find TODO files ──────────────────────────────────────────────

function findTodoFiles() {
  const patterns = [
    'docs/TODO_*.md',
    'docs/todo/TODO_*.md',
    'docs/todo/TODO*.md',
    'docs/app/**/TODO*.md',
  ];
  const found = new Set();
  if (globSync) {
    for (const pattern of patterns) {
      for (const f of globSync(pattern, { cwd: PROJECT_ROOT })) {
        found.add(path.join(PROJECT_ROOT, f));
      }
    }
  } else {
    const SKIP_DIRS = new Set(['.archive', '.output', 'node_modules', '.git']);
    const scanDir = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') && SKIP_DIRS.has(entry.name)) continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isFile() && /^TODO.*\.md$/i.test(entry.name)) found.add(full);
        else if (entry.isDirectory()) scanDir(full);
      }
    };
    scanDir(path.join(PROJECT_ROOT, 'docs'));
  }
  return [...found].sort();
}

// ── Parse a TODO file ────────────────────────────────────────────

function parseTodoFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const relativePath = path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');
  const titleMatch = content.match(/^#\s+TODO:\s*(.+)/m);
  const title = titleMatch ? titleMatch[1].trim() : path.basename(filePath, '.md');
  const isMasterIndex = /## Phase Map/i.test(content) || /## Epic Index/i.test(content);
  const result = {
    path: relativePath, title,
    type: isMasterIndex ? 'master' : 'checklist',
    stories: { total: 0, done: 0, inProgress: 0, blocked: 0, deferred: 0, pending: 0 },
    epics: [], phases: [],
  };
  if (isMasterIndex) parseMasterIndex(lines, result);
  else parseChecklist(lines, result);
  return result;
}

function parseMasterIndex(lines, result) {
  let section = null;
  for (const line of lines) {
    if (/## Phase Map/i.test(line)) { section = 'phases'; continue; }
    if (/## Epic Index/i.test(line)) { section = 'epics'; continue; }
    if (/^## /.test(line) && section) { section = null; continue; }
    if (section === 'phases' && line.startsWith('|') && !line.includes('---') && !line.includes('Phase')) {
      const cols = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length >= 7) {
        const stories = parseInt(cols[4]) || 0;
        const done = parseInt(cols[5]) || 0;
        result.phases.push({ id: cols[0], name: cols[1], goal: cols[2], epics: parseInt(cols[3]) || 0, stories, done, status: cols[6] });
        result.stories.total += stories;
        result.stories.done += done;
      }
    }
    if (section === 'epics' && line.startsWith('|') && !line.includes('---') && !line.includes('Epic')) {
      const cols = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length >= 7) {
        const statusRaw = cols[5].trim();
        const status = /\[x\]/i.test(statusRaw) ? 'done'
          : /\[>\]/.test(statusRaw) ? 'in_progress'
          : /\[!\]/.test(statusRaw) ? 'blocked'
          : /\[~\]/.test(statusRaw) ? 'deferred' : 'pending';
        result.epics.push({ id: cols[0], title: cols[1], phase: cols[2], stories: parseInt(cols[3]) || 0, estHours: parseFloat(cols[4]) || 0, status });
      }
    }
  }
  if (result.stories.total === 0 && result.epics.length > 0) {
    result.stories.total = result.epics.reduce((s, e) => s + e.stories, 0);
    result.stories.done = result.epics.filter(e => e.status === 'done').reduce((s, e) => s + e.stories, 0);
  }
  result.stories.pending = result.stories.total - result.stories.done - result.stories.inProgress - result.stories.blocked - result.stories.deferred;
}

function parseChecklist(lines, result) {
  // The canonical per-epic format generated by /create:project-epics-todo puts
  // each story behind a `## Story N.M:` header, with plain `- [ ] task`
  // checkboxes (and footer ACs) underneath — NOT bold-prefixed checkbox lines.
  // If this file uses that format, count STORIES (the headers), deriving each
  // story's status from its task checkboxes (F20). Otherwise fall back to the
  // legacy checkbox/table parse below.
  // Accept BOTH story-ID styles after "Story ": dotted (`1.2`) AND epic-story
  // (`E11-S1`, `E0-S2`). The old `[\d.]+` only matched dotted IDs, so the
  // brownfield `## Story E11-S1` headers fell through to the legacy parser and
  // counted 0 (C13). `[A-Za-z]*\d` = optional letters then a required digit, so
  // a non-story header like `## Story Index` (no digit) still won't match.
  const storyHeader = /^##\s+Story\s+[A-Za-z]*\d[\w.-]*/i;
  if (lines.some(l => storyHeader.test(l.trim()))) {
    parseStoryHeaderChecklist(lines, result, storyHeader);
    return;
  }
  for (const line of lines) {
    const checkboxMatch = line.match(/- \[([ x>!~])\]/);
    const tableStatusMatch = line.match(/\|\s*\[([ x>!~])\]\s*\|/);
    const marker = checkboxMatch ? checkboxMatch[1] : tableStatusMatch ? tableStatusMatch[1] : null;
    if (marker === null) continue;
    if (checkboxMatch) {
      if (!/^- \[.\] \*\*/.test(line.trim())) continue;
    }
    result.stories.total++;
    switch (marker) {
      case 'x': result.stories.done++; break;
      case '>': result.stories.inProgress++; break;
      case '!': result.stories.blocked++; break;
      case '~': result.stories.deferred++; break;
      default:  result.stories.pending++; break;
    }
  }
}

// Parse a per-epic checklist where each story is a `## Story N.M:` header.
//
// Story-level status is taken from the STORY HEADER's own marker when it has one
// — e.g. `## Story 3.1 (Config): Title \`[x]\``. `/run-todo` Step 8a marks the
// story done at the header at wave commit, so the header marker is authoritative
// (R7). Only when the header carries NO status marker do we fall back to deriving
// status from the story's task checkboxes (done = all `[x]`, in-progress = some,
// etc.) — that keeps the F20/F21 behavior for generators that don't mark headers.
//
// A non-Story `## ` heading (`## Validation`, `## Notes`, `## Dependencies`…)
// ENDS the current story, so trailing-section checkboxes never leak into the last
// story's task list (R7). Bold prose annotations between stories are ignored —
// they aren't under a `## Story` header (F20/F21).
function parseStoryHeaderChecklist(lines, result, storyHeader) {
  let current = null; // { headerMarker: string|null, markers: [] }
  const flush = () => {
    if (!current) return;
    result.stories.total++;
    const hm = current.headerMarker;
    if (hm) {
      // Header marker is authoritative.
      switch (hm) {
        case 'x': result.stories.done++; break;
        case '>': result.stories.inProgress++; break;
        case '!': result.stories.blocked++; break;
        case '~': result.stories.deferred++; break;
        default:  result.stories.pending++; break;
      }
    } else {
      // No header marker — derive from the story's task checkboxes.
      const m = current.markers;
      if (m.length > 0 && m.every(x => x === 'x'))      result.stories.done++;
      else if (m.some(x => x === '!'))                  result.stories.blocked++;
      else if (m.some(x => x === '~'))                  result.stories.deferred++;
      else if (m.some(x => x === 'x' || x === '>'))     result.stories.inProgress++;
      else                                              result.stories.pending++;
    }
    current = null;
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (storyHeader.test(trimmed)) {
      flush();
      // Capture the header's own status marker if present. Matches a single
      // status char in brackets (`[x]`, `\`[ ]\``, `[>]`) — a descriptive
      // annotation like `[CP — critical path]` is multi-char and won't match.
      const hm = trimmed.match(/\[([ x>!~])\]/);
      current = { headerMarker: hm ? hm[1] : null, markers: [] };
      continue;
    }
    // Any OTHER `## ` heading closes the current story (R7 — stops a trailing
    // `## Validation`/`## Notes` section's checkboxes leaking into the last story).
    if (/^##\s+/.test(trimmed)) { flush(); continue; }
    if (!current) continue;
    const cb = line.match(/- \[([ x>!~])\]/);
    if (cb) current.markers.push(cb[1]);
  }
  flush();
}

// ── Inline telemetry metrics (commands + gates + sessions) ───────
// NOTE: git data delegated to loadGitMetrics(); only JSONL parsing and
// session-count remain inline — both are tightly coupled to the telemetry
// directory layout and have no other consumers.

function computeTelemetryMetrics(projectRoot) {
  const telemetryFile = path.join(projectRoot, 'docs', '.output', 'telemetry', 'command-usage.jsonl');
  if (!fs.existsSync(telemetryFile)) return null;
  let raw;
  try { raw = fs.readFileSync(telemetryFile, 'utf8'); } catch { return null; }
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length === 0) return null;

  const commands = {};
  const gates = {};
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type === 'command_invocation' && entry.command)
      commands[entry.command] = (commands[entry.command] || 0) + 1;
    if (entry.type === 'gate_run' && entry.command) {
      if (!gates[entry.command]) gates[entry.command] = { pass: 0, fail: 0, rate: 0 };
      // A4 telemetry schema: outcome is 'success' | 'failure' | 'unknown'.
      // 'pass'/'fail' are retained for backward-compat with any pre-A4 JSONL
      // still lingering in the file (the schema rename shipped in Wave 2 of
      // Phase 1's core-hooks-refactor — commit 6c8e474).
      if (entry.outcome === 'success' || entry.outcome === 'pass') gates[entry.command].pass++;
      else if (entry.outcome === 'failure' || entry.outcome === 'fail') gates[entry.command].fail++;
      // 'unknown' is ignored — no signal, neither pass nor fail.
    }
  }
  for (const name of Object.keys(gates)) {
    const g = gates[name];
    const total = g.pass + g.fail;
    g.rate = total > 0 ? Math.round((g.pass / total) * 100) : 0;
  }

  let sessions = 0;
  const sessionsDir = path.join(projectRoot, 'docs', '.output', 'sessions');
  try {
    if (fs.existsSync(sessionsDir))
      sessions = fs.readdirSync(sessionsDir, { withFileTypes: true }).filter(e => e.isDirectory()).length;
  } catch { /* non-fatal */ }

  const memoryBenchmark = parseMemoryBenchmark(projectRoot);
  return { commands, gates, sessions, memoryBenchmark };
}

// Parse memory-benchmark.jsonl for last-30-days hit rate (AMEM-8.1).
function parseMemoryBenchmark(projectRoot) {
  const file = path.join(projectRoot, 'docs', '.output', 'telemetry', 'memory-benchmark.jsonl');
  if (!fs.existsSync(file)) return null;
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length === 0) return null;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const cutoffISO = cutoff.toISOString();
  let total = 0; let hits = 0; const ranks = [];
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== 'memory_benchmark') continue;
    if (typeof entry.timestamp !== 'string' || entry.timestamp < cutoffISO) continue;
    total++;
    if (entry.hit) hits++;
    if (typeof entry.retrieval_rank === 'number') ranks.push(entry.retrieval_rank);
  }
  if (total === 0) return null;
  const rate = Math.round((hits / total) * 100);
  const meanRank = ranks.length > 0 ? Number((ranks.reduce((a, b) => a + b, 0) / ranks.length).toFixed(2)) : null;
  return { total, hits, rate, meanRank };
}

// ── Grand-total aggregation (dedup master vs per-epic) ───────────
// A master index (TODO_{Project}.md) already aggregates every story via its
// Epic Index; the per-epic checklists (TODO_epic*.md) re-count those same
// stories. Summing both double-counts (F21). When a master index is present it
// is the canonical aggregate, so the grand TOTAL derives from master files
// only; per-epic files are still shown individually but not summed in. With no
// master index, fall back to summing the checklists.
function computeGrandTotals(files) {
  const masters = files.filter(f => f.type === 'master');
  const source = masters.length > 0 ? masters : files;
  return source.reduce((acc, f) => {
    acc.total += f.stories.total; acc.done += f.stories.done;
    acc.inProgress += f.stories.inProgress; acc.blocked += f.stories.blocked;
    acc.deferred += f.stories.deferred; acc.pending += f.stories.pending;
    return acc;
  }, { total: 0, done: 0, inProgress: 0, blocked: 0, deferred: 0, pending: 0 });
}

// ── Text output ──────────────────────────────────────────────────

function printTextSummary(files, telemetry, gitMetrics, memMetrics) {
  if (files.length === 0) { console.log('No TODO files found.'); return; }
  console.log('');
  for (const f of files) {
    const s = f.stories;
    const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
    const bar = progressBar(pct, 20);
    console.log(`  ${f.title}`);
    console.log(`  ${f.path}`);
    console.log(`  ${bar} ${pct}%  (${s.done}/${s.total} done`
      + (s.inProgress ? `, ${s.inProgress} active` : '')
      + (s.blocked ? `, ${s.blocked} blocked` : '')
      + (s.deferred ? `, ${s.deferred} deferred` : '') + ')');
    if (f.epics.length > 0) {
      for (const e of f.epics) {
        const icon = e.status === 'done' ? '[x]' : e.status === 'in_progress' ? '[>]' : e.status === 'blocked' ? '[!]' : e.status === 'deferred' ? '[~]' : '[ ]';
        console.log(`    ${icon} Epic ${e.id}: ${e.title} (${e.stories} stories, ~${e.estHours}h)`);
      }
    }
    console.log('');
  }
  const totals = computeGrandTotals(files);
  if (files.length > 1) {
    const pct = totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0;
    console.log(`  TOTAL: ${totals.done}/${totals.total} stories (${pct}%)`);
    console.log('');
  }
  if (!telemetry) {
    console.log('  Metrics: No telemetry data available');
  } else {
    console.log('  Metrics');
    const topCmds = Object.entries(telemetry.commands).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => `${name} (${count})`).join(', ');
    console.log(`    Commands: ${topCmds || 'none'}`);
    const gateEntries = Object.entries(telemetry.gates);
    if (gateEntries.length > 0) {
      console.log(`    Gates: ${gateEntries.map(([name, g]) => `${name.replace('gate:', '')} ${g.rate}% pass`).join(', ')}`);
    } else {
      console.log('    Gates: no gate data');
    }
    const commitVelocity = gitMetrics ? gitMetrics.activeDays : 0;
    console.log(`    Commits (7d): ${commitVelocity}  |  Sessions: ${telemetry.sessions}`);
    if (telemetry.memoryBenchmark) {
      const mb = telemetry.memoryBenchmark;
      const tag = mb.rate >= 70 ? 'Green' : mb.rate >= 50 ? 'Yellow' : 'Red';
      console.log(`    Memory Hit Rate (30d): ${mb.rate}% [${tag}]  (${mb.hits}/${mb.total}${mb.meanRank !== null ? `, mean rank ${mb.meanRank}` : ''})`);
    }
    if (memMetrics && memMetrics.total > 0) {
      const tag = memMetrics.healthScore >= 50 ? 'Green' : memMetrics.healthScore >= 35 ? 'Yellow' : 'Red';
      const topCats = Object.entries(memMetrics.byCategory)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ');
      console.log(`    Memory: ${memMetrics.healthScore}/70 [${tag}]  (${memMetrics.total} total, ${memMetrics.staleCount} stale${topCats ? ` — ${topCats}` : ''})`);
    }
  }
  console.log('');
}

function progressBar(pct, width) {
  const filled = Math.round((pct / 100) * width);
  return '[' + '#'.repeat(filled) + '-'.repeat(width - filled) + ']';
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  const todoFiles = findTodoFiles();
  const parsed    = todoFiles.map(parseTodoFile);

  // Load metrics — three delegated loaders + inline telemetry
  const codeMetrics     = loadCodeMetrics(PROJECT_ROOT);
  const memMetricsPromise = loadMemoryMetrics(PROJECT_ROOT);
  const gitMetrics      = loadGitMetrics(PROJECT_ROOT);
  const gateSummary     = readSummary(PROJECT_ROOT) ?? null;
  const telemetry       = computeTelemetryMetrics(PROJECT_ROOT);

  const memMetrics = await memMetricsPromise;
  // gateSummary + codeMetrics remain TODO — surfacing them is a future
  // dashboard story (gate-status badge + LOC trend).
  void gateSummary; void codeMetrics;

  printTextSummary(parsed, telemetry, gitMetrics, memMetrics);

  if (!TEXT_ONLY) {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const html = generateHtml(parsed, telemetry, gitMetrics, OUTPUT_DIR, memMetrics);
    fs.writeFileSync(OUTPUT_FILE, html, 'utf8');
    console.log(`  Dashboard: ${path.relative(PROJECT_ROOT, OUTPUT_FILE)}`);
    try {
      const { generateDecisionsHtml } = require('./decision-viz');
      const decisionsFile = path.join(OUTPUT_DIR, 'decisions.html');
      generateDecisionsHtml({ outputPath: decisionsFile });
      console.log(`  Decisions:  ${path.relative(PROJECT_ROOT, decisionsFile)}`);
    } catch (err) {
      process.stderr.write(`  [status] decisions.html skipped: ${err.message}\n`);
    }
    console.log('');
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}

// Public API — note: `generateHtml` and `esc` are re-exports from `_lib/status-html`.
// After the P2.4 split, `generateHtml(files, telemetry, gitMetrics, outputDir)`
// is the canonical signature. Earlier single-arg callers (if any existed in
// downstream projects) must migrate — the new signature is NOT backward-compat.
module.exports = { findTodoFiles, parseTodoFile, computeTelemetryMetrics, computeGrandTotals, generateHtml, printTextSummary, esc };
