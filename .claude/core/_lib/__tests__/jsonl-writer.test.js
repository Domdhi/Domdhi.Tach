// AC→source map (Task #4 / jsonl-writer):
//   Single export: appendJsonl(path, entry, {maxLines, tailKeep, onError})
//   Semantics: append one JSON.stringify'd line, rotate tail when over maxLines.
//   Must be silent on I/O failure (telemetry MUST NOT break calling flow).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const fs = require('node:fs');
const path = require('node:path');
const { appendJsonl } = require('../jsonl-writer');
const { createTmpDir } = require('../../__tests__/_helpers/tmp-dir');

let tmp;
beforeEach(() => { tmp = createTmpDir({ prefix: 'jsonl-writer-' }); });
afterEach(() => { tmp.cleanup(); });

describe('appendJsonl', () => {

  it('appendJsonl_singleEntry_createsFileWithOneLine', () => {
    const jsonlPath = path.join(tmp.root, 'out.jsonl');
    appendJsonl(jsonlPath, { type: 'test', n: 1 });
    const content = fs.readFileSync(jsonlPath, 'utf8');
    expect(content).toBe('{"type":"test","n":1}\n');
  });

  it('appendJsonl_createsParentDirectoriesIfMissing', () => {
    const jsonlPath = path.join(tmp.root, 'nested', 'deep', 'out.jsonl');
    appendJsonl(jsonlPath, { x: 1 });
    expect(fs.existsSync(jsonlPath)).toBe(true);
  });

  it('appendJsonl_multipleCalls_accumulateLines', () => {
    const jsonlPath = path.join(tmp.root, 'out.jsonl');
    appendJsonl(jsonlPath, { n: 1 });
    appendJsonl(jsonlPath, { n: 2 });
    appendJsonl(jsonlPath, { n: 3 });
    const lines = fs.readFileSync(jsonlPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toEqual({ n: 1 });
    expect(JSON.parse(lines[2])).toEqual({ n: 3 });
  });

  it('appendJsonl_exceedsMaxLines_rotatesToTailKeep', () => {
    const jsonlPath = path.join(tmp.root, 'out.jsonl');
    // Fill to maxLines + 1 → rotation fires on the final append
    for (let i = 0; i < 11; i++) {
      appendJsonl(jsonlPath, { n: i }, { maxLines: 10, tailKeep: 5 });
    }
    const lines = fs.readFileSync(jsonlPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(5);
    // After rotation, only the last 5 survive: n=6..10
    expect(JSON.parse(lines[0])).toEqual({ n: 6 });
    expect(JSON.parse(lines[4])).toEqual({ n: 10 });
  });

  it('appendJsonl_underMaxLines_noRotation', () => {
    const jsonlPath = path.join(tmp.root, 'out.jsonl');
    for (let i = 0; i < 5; i++) {
      appendJsonl(jsonlPath, { n: i }, { maxLines: 10, tailKeep: 5 });
    }
    const lines = fs.readFileSync(jsonlPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(5);
  });

  it('appendJsonl_writeFailure_silentNoThrow', () => {
    // Trigger a reliable write failure by pointing at a path that's already a directory.
    // fs.appendFileSync(<dir>) throws EISDIR on every platform.
    const dirAsPath = tmp.mkdir('as-directory');
    expect(() => appendJsonl(dirAsPath, { x: 1 })).not.toThrow();
  });

  it('appendJsonl_onErrorCallback_invokedOnFailure', () => {
    const dirAsPath = tmp.mkdir('as-directory-2');
    let caught = null;
    appendJsonl(dirAsPath, { x: 1 }, { onError: (msg) => { caught = msg; } });
    expect(typeof caught).toBe('string');
    expect(caught.length).toBeGreaterThan(0);
  });

  it('appendJsonl_onErrorThrows_swallowsToPreventCascadingFailure', () => {
    const dirAsPath = tmp.mkdir('as-directory-3');
    const brokenLogger = () => { throw new Error('logger broke'); };
    // Even if onError itself throws, appendJsonl must not propagate
    expect(() =>
      appendJsonl(dirAsPath, { x: 1 }, { onError: brokenLogger })
    ).not.toThrow();
  });

});
