// AC→source map (P2.1 / decision-graph):
//   Single export: loadDecisionData({ projectRoot, cutoffDate, categories })
//   Loads git commits, concepts, daily logs, cross-references, and ADRs.
//   Returns normalized { concepts, crossReferences, commits, adrs, memories, dailyLogs }.
//   Extracted from decision-viz.js:112-334 (data parsers + collectData aggregate).
//
//   DI seam: accepts optional { execSync } injection for git calls — do not vi.mock
//   child_process across CJS/ESM boundary (causes hoisting failures).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { loadDecisionData } = require('../decision-graph');
const { createTmpDir } = require('../../__tests__/_helpers/tmp-dir');
const { createConcept } = require('../../__tests__/_helpers/concept-fixture');

const CATEGORIES = ['patterns', 'constraints', 'decisions', 'workflows', 'rejected-approaches'];

let tmp;
beforeEach(() => { tmp = createTmpDir({ prefix: 'decision-graph-' }); });
afterEach(() => { tmp.cleanup(); });

// ─── loadDecisionData shape ───────────────────────────────────────────────────

describe('loadDecisionData', () => {

  it('loadDecisionData_emptyProjectRoot_returnsEmptyCollections', () => {
    // Arrange — tmp.root has no docs/ or git history
    const cutoffDate = new Date('2000-01-01');
    const result = loadDecisionData({
      projectRoot: tmp.root,
      cutoffDate,
      categories: CATEGORIES,
    });

    // Assert — all six keys present and empty
    expect(result).toHaveProperty('concepts');
    expect(result).toHaveProperty('crossReferences');
    expect(result).toHaveProperty('commits');
    expect(result).toHaveProperty('adrs');
    expect(result).toHaveProperty('memories');
    expect(result).toHaveProperty('dailyLogs');
    expect(result.concepts).toEqual([]);
    expect(result.commits).toEqual([]);
    expect(result.adrs).toEqual([]);
    expect(result.memories).toEqual([]);
    expect(result.dailyLogs).toEqual([]);
    expect(result.crossReferences).toEqual({});
  });

  it('loadDecisionData_withConceptFile_returnsConceptInCollection', () => {
    // Arrange — write one concept article matching concept-fixture format
    createConcept(tmp, 'patterns', 'test-pattern', {
      title: 'Test Pattern',
      confidence: 0.8,
      sources: ['2026-01-15'],
      content: 'A test pattern for unit testing.',
    });

    const cutoffDate = new Date('2000-01-01');
    const result = loadDecisionData({
      projectRoot: tmp.root,
      cutoffDate,
      categories: CATEGORIES,
    });

    // Assert — concept parsed with expected fields
    expect(result.concepts).toHaveLength(1);
    const c = result.concepts[0];
    expect(c.slug).toBe('test-pattern');
    expect(c.title).toBe('Test Pattern');
    expect(c.category).toBe('patterns');
    expect(c.confidence).toBeCloseTo(0.8, 2);
    expect(Array.isArray(c.sources)).toBe(true);
  });

  it('loadDecisionData_withADRDoc_parsesADRsFromArchitectureFile', () => {
    // Arrange — write minimal _project-architecture.md with one ADR section
    const archContent = `# Project Architecture

## Architecture Decision Records

### ADR-1: Use Node.js for core scripts

**Status:** Accepted
**Date:** 2026-01-10

Using Node.js for portability across CI environments.
`;
    tmp.write('docs/_project-architecture.md', archContent);

    const cutoffDate = new Date('2000-01-01');
    const result = loadDecisionData({
      projectRoot: tmp.root,
      cutoffDate,
      categories: CATEGORIES,
    });

    // Assert — ADR extracted correctly
    expect(result.adrs).toHaveLength(1);
    const adr = result.adrs[0];
    expect(adr.number).toBe(1);
    expect(adr.title).toContain('Node.js');
    expect(adr.status).toMatch(/accepted/i);
    expect(adr.date).toBe('2026-01-10');
  });

  it('loadDecisionData_gitExecSyncInjection_callsInjectedFn', () => {
    // Arrange — inject a fake execSync that returns a known git log line
    const fakeCommitDate = '2026-04-01 12:00:00 +0000';
    let capturedArgs = null;
    const fakeExecSync = (cmd, opts) => {
      capturedArgs = { cmd, opts };
      // Return one commit line in "%H|%ad|%s" format
      return `abc1234abc1234abc1234abc1234abc1234abc1234|${fakeCommitDate}|feat: test commit\n`;
    };

    const cutoffDate = new Date('2000-01-01');
    const result = loadDecisionData({
      projectRoot: tmp.root,
      cutoffDate,
      categories: CATEGORIES,
      execSync: fakeExecSync,
    });

    // Assert — injected execSync was called and commit was parsed
    expect(capturedArgs).not.toBeNull();
    expect(result.commits).toHaveLength(1);
    expect(result.commits[0].message).toBe('feat: test commit');
    expect(result.commits[0].hash).toContain('abc1234');
  });

  it('loadDecisionData_withCrossRefsFile_loadsCrossReferenceMap', () => {
    // Arrange — write a cross-references.json in the concepts dir
    const crossRefs = {
      'pattern-a': { related: ['pattern-b', 'decision-c'] },
      'pattern-b': { related: ['pattern-a'] },
    };
    tmp.write(
      'docs/.output/memories/concepts/cross-references.json',
      JSON.stringify(crossRefs, null, 2)
    );

    const cutoffDate = new Date('2000-01-01');
    const result = loadDecisionData({
      projectRoot: tmp.root,
      cutoffDate,
      categories: CATEGORIES,
    });

    // Assert — cross-references loaded as an object
    expect(result.crossReferences).toHaveProperty('pattern-a');
    expect(result.crossReferences['pattern-a'].related).toContain('pattern-b');
  });

  it('loadDecisionData_dailyLogWithinCutoff_includesLogEntry', () => {
    // Arrange — write a daily log file within the cutoff window
    const today = new Date().toISOString().slice(0, 10);
    const dailyContent = `# Daily Log ${today}

## 09:00 — Stop hook

**Branch:** main

### Recent Commits
- abc1234 feat: something
`;
    tmp.write(`docs/.output/memories/daily/${today}.md`, dailyContent);

    const cutoffDate = new Date('2000-01-01');
    const result = loadDecisionData({
      projectRoot: tmp.root,
      cutoffDate,
      categories: CATEGORIES,
    });

    // Assert — daily log entry parsed
    expect(result.dailyLogs.length).toBeGreaterThan(0);
    const log = result.dailyLogs[0];
    expect(log.date).toBe(today);
    expect(log.trigger).toBe('Stop hook');
  });

  it('loadDecisionData_dailyLogBeforeCutoff_excludesLogEntry', () => {
    // Arrange — write a daily log file BEFORE the cutoff
    const oldDate = '2020-01-01';
    const dailyContent = `# Daily Log ${oldDate}

## 09:00 — Old trigger

**Branch:** main
`;
    tmp.write(`docs/.output/memories/daily/${oldDate}.md`, dailyContent);

    // Cutoff is yesterday → old log is excluded
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const result = loadDecisionData({
      projectRoot: tmp.root,
      cutoffDate: yesterday,
      categories: CATEGORIES,
    });

    // Assert — old log excluded
    expect(result.dailyLogs).toHaveLength(0);
  });

  it('loadDecisionData_memoryJsonRecord_parsedIntoMemoriesArray', () => {
    // Arrange — write a JSON memory record in a known category dir
    const record = {
      id: 'my-decision-record',
      category: 'decisions',
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-15T00:00:00.000Z',
      usage_count: 2,
      metadata: { confidence: 0.9 },
      content: { description: 'A test decision memory' },
    };
    tmp.write(
      'docs/.output/memories/decisions/my-decision-record.json',
      JSON.stringify(record, null, 2)
    );

    const cutoffDate = new Date('2000-01-01');
    const result = loadDecisionData({
      projectRoot: tmp.root,
      cutoffDate,
      categories: CATEGORIES,
    });

    // Assert — memory record in memories array
    expect(result.memories).toHaveLength(1);
    const m = result.memories[0];
    expect(m.id).toBe('my-decision-record');
    expect(m.category).toBe('decisions');
    expect(m.confidence).toBeCloseTo(0.9, 2);
    expect(m.description).toBe('A test decision memory');
  });

});
