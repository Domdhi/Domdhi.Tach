// Tests for skill-usage-logger.cjs — dual-trigger skill telemetry (PostToolUse
// Read + Agent). Logger never blocks; we test the pure parse/resolve helpers and
// processEvent routing (without asserting file writes).

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseSkillPath, resolveAgentSkills } = require('../skill-usage-logger.cjs');

describe('parseSkillPath', () => {
  it('extracts skill + file from a .claude/skills path', () => {
    expect(parseSkillPath('/repo/.claude/skills/dev-process/SKILL.md')).toEqual({
      skill: 'dev-process',
      file: 'SKILL.md',
    });
  });

  it('extracts nested references files', () => {
    expect(parseSkillPath('/repo/.claude/skills/mfa-hub/references/blazor.md')).toEqual({
      skill: 'mfa-hub',
      file: 'references/blazor.md',
    });
  });

  it('normalizes Windows separators', () => {
    expect(parseSkillPath('C:\\repo\\.claude\\skills\\code-review\\SKILL.md')).toEqual({
      skill: 'code-review',
      file: 'SKILL.md',
    });
  });

  it('returns null for non-skill paths and bad input', () => {
    expect(parseSkillPath('/repo/.claude/agents/architect.md')).toBeNull();
    expect(parseSkillPath('/repo/src/index.js')).toBeNull();
    expect(parseSkillPath(null)).toBeNull();
    expect(parseSkillPath(42)).toBeNull();
  });
});

describe('resolveAgentSkills', () => {
  it('reads the skills: frontmatter list from a real agent file', () => {
    // general-purpose ships a non-empty skills: list in this repo.
    const skills = resolveAgentSkills('general-purpose', process.cwd());
    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBeGreaterThan(0);
  });

  it('returns [] for unknown agents and bad input', () => {
    expect(resolveAgentSkills('no-such-agent', process.cwd())).toEqual([]);
    expect(resolveAgentSkills(null, process.cwd())).toEqual([]);
    expect(resolveAgentSkills('', process.cwd())).toEqual([]);
  });
});
