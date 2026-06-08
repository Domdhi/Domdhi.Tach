// Tests for commit-guard.cjs (PreToolUse:Bash) — forces commits through
// .claude/core/commit.js by blocking inline `git commit -m`.
//
// Coverage:
//   - gitCommitTail: detects `git commit` only at command positions (start / after
//     &&, ||, ;, |, newline, `(`), not inside echo/quoted strings
//   - hasInlineMessageFlag: -m, -am, -cm, --message (and = form)
//   - hasFileFlag / hasAmendFlag: escape hatches
//   - usesHelper: commit.js always passes
//   - processEvent: end-to-end block/pass decisions

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
  processEvent,
  gitCommitTail,
  usesHelper,
  hasFileFlag,
  hasAmendFlag,
  hasInlineMessageFlag,
} = require('../commit-guard.cjs');

const evt = (command) => ({ tool_input: { command } });

describe('gitCommitTail', () => {
  it('matches git commit at start of command', () => {
    expect(gitCommitTail('git commit -m "x"')).toBe(' -m "x"');
  });

  it('matches git commit after a shell separator', () => {
    expect(gitCommitTail('git add -A && git commit -m "x"')).toContain('-m');
    expect(gitCommitTail('foo; git commit --amend')).toContain('--amend');
  });

  it('returns null when git commit is not an invocation', () => {
    expect(gitCommitTail('echo "run git commit -m later"')).toBeNull();
    expect(gitCommitTail('git status')).toBeNull();
    expect(gitCommitTail('ls')).toBeNull();
  });
});

describe('flag detectors', () => {
  it('hasInlineMessageFlag detects -m / -am / -cm / --message', () => {
    expect(hasInlineMessageFlag(' -m "x"')).toBe(true);
    expect(hasInlineMessageFlag(' -am "x"')).toBe(true);
    expect(hasInlineMessageFlag(' -cm "x"')).toBe(true);
    expect(hasInlineMessageFlag(' --message "x"')).toBe(true);
    expect(hasInlineMessageFlag(' --message="x"')).toBe(true);
  });

  it('hasInlineMessageFlag is false for no inline message', () => {
    expect(hasInlineMessageFlag(' --amend')).toBe(false);
    expect(hasInlineMessageFlag(' -F .git/MSG')).toBe(false);
    expect(hasInlineMessageFlag('')).toBe(false);
  });

  it('hasFileFlag / hasAmendFlag', () => {
    expect(hasFileFlag(' -F .git/MSG')).toBe(true);
    expect(hasFileFlag(' --file=.git/MSG')).toBe(true);
    expect(hasFileFlag(' -m "x"')).toBe(false);
    expect(hasAmendFlag(' --amend')).toBe(true);
    expect(hasAmendFlag(' -m "x"')).toBe(false);
  });

  it('usesHelper detects the sanctioned commit.js path', () => {
    expect(usesHelper('node .claude/core/commit.js --all')).toBe(true);
    expect(usesHelper('git commit -m "x"')).toBe(false);
  });
});

describe('processEvent', () => {
  it('BLOCKS inline git commit -m', () => {
    const r = processEvent(evt('git commit -m "feat: x"'));
    expect(r).toMatchObject({ block: true });
    expect(r.feedback).toContain('commit.js');
  });

  it('BLOCKS combined -am and after a separator', () => {
    expect(processEvent(evt('git commit -am "x"'))).toMatchObject({ block: true });
    expect(processEvent(evt('git add -A && git commit -m "x"'))).toMatchObject({ block: true });
  });

  it('PASSES the commit.js helper', () => {
    expect(processEvent(evt('node .claude/core/commit.js'))).toBeNull();
    expect(processEvent(evt('node .claude/core/commit.js --all'))).toBeNull();
  });

  it('PASSES file-based and editor escape hatches', () => {
    expect(processEvent(evt('git commit -F docs/.output/.commit-msg'))).toBeNull();
    expect(processEvent(evt('git commit --amend'))).toBeNull();
    expect(processEvent(evt('git commit'))).toBeNull();
  });

  it('PASSES non-commit commands and empty input', () => {
    expect(processEvent(evt('git status'))).toBeNull();
    expect(processEvent(evt('echo "git commit -m fake"'))).toBeNull();
    expect(processEvent(evt(''))).toBeNull();
    expect(processEvent({})).toBeNull();
  });

  it('BLOCKS amend WITH an inline message', () => {
    expect(processEvent(evt('git commit --amend -m "x"'))).toMatchObject({ block: true });
  });
});
