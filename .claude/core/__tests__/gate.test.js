// AC→source map (TDD-3.5 / gate):
//   - parseBuildOutput: TS/C# style, ESLint/generic, Rust prefix, mixed, empty
//   - parseTestOutput: Vitest v1 (colon), Vitest v2 (no colon, parens), dotnet, Rust, individual failures
//   - loadConfig: auto-detects package.json / Cargo.toml / go.mod / .sln / Makefile; explicit override
//   - acquireLock / releaseLock: double-acquire fails, release re-enables, stale lock (>10 min) breaks
//   - MODULE: gate.js exports { loadConfig, parseBuildOutput, parseTestOutput, acquireLock, releaseLock }
//
// Isolation strategy for env-dependent tests (loadConfig, acquireLock, releaseLock):
//   PROJECT_ROOT is frozen at module load time (Node CJS statics).
//   vi.resetModules() does not help here because we use createRequire (Node's native CJS cache),
//   not Vitest's ESM module registry.
//   Solution: delete the gate.js entry from require.cache before each re-require so that
//   Node re-executes the module with the current CLAUDE_PROJECT_DIR value.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createTmpDir } = require('./_helpers/tmp-dir');

// Absolute path to gate.js — used to bust require.cache
const GATE_PATH = require.resolve('../gate');

// Top-level require for pure functions — no env dependency, no need for cache busting
const { parseBuildOutput, parseTestOutput } = require('../gate');

// ─── parseBuildOutput ─────────────────────────────────────────────────────────

describe('gate', () => {
  describe('parseBuildOutput', () => {
    it('parseBuildOutput_empty_succeedsWithNoErrors', () => {
      // Arrange
      const output = '';
      const exitCode = 0;

      // Act
      const result = parseBuildOutput(output, exitCode);

      // Assert
      expect(result.succeeded).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('parseBuildOutput_exitCodeNonZero_succeededFalse', () => {
      // Arrange
      const output = '';
      const exitCode = 1;

      // Act
      const result = parseBuildOutput(output, exitCode);

      // Assert
      expect(result.succeeded).toBe(false);
    });

    it('parseBuildOutput_typescriptStyle_extractsError', () => {
      // Arrange — TS/C# style: file(line,col): error CODE: message
      const output = 'src/index.ts(10,5): error TS2345: Argument of type string not assignable';
      const exitCode = 1;

      // Act
      const result = parseBuildOutput(output, exitCode);

      // Assert
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('src/index.ts');
      expect(result.errors[0].line).toBe(10);
      expect(result.errors[0].column).toBe(5);
      expect(result.errors[0].code).toBe('TS2345');
    });

    it('parseBuildOutput_csharpStyle_extractsError', () => {
      // Arrange — C# style is same TS pattern: file(line,col): error CSxxxx: message
      const output = 'MyProject/Program.cs(42,12): error CS0246: Type or namespace not found';
      const exitCode = 1;

      // Act
      const result = parseBuildOutput(output, exitCode);

      // Assert
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].line).toBe(42);
      expect(result.errors[0].column).toBe(12);
    });

    it('parseBuildOutput_eslintStyle_extractsError', () => {
      // Arrange — ESLint/generic style: file:line:col: error message
      const output = '/home/user/project/src/app.ts:10:5: error Unexpected token';
      const exitCode = 1;

      // Act
      const result = parseBuildOutput(output, exitCode);

      // Assert
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].line).toBe(10);
      expect(result.errors[0].column).toBe(5);
    });

    it('parseBuildOutput_rustPrefix_extractsError', () => {
      // Arrange — Rust/generic prefix: error[E0308]: message
      const output = 'error[E0308]: mismatched types';
      const exitCode = 1;

      // Act
      const result = parseBuildOutput(output, exitCode);

      // Assert
      expect(result.errors).toHaveLength(1);
    });

    it('parseBuildOutput_rustPrefixNoCode_extractsError', () => {
      // Arrange — bare error prefix without brackets
      const output = 'error: cannot find value `x` in this scope';
      const exitCode = 1;

      // Act
      const result = parseBuildOutput(output, exitCode);

      // Assert
      expect(result.errors).toHaveLength(1);
    });

    it('parseBuildOutput_mixedWarningsAndErrors_extractsBoth', () => {
      // Arrange
      const output = [
        'src/main.ts(5,3): error TS1005: ";" expected',
        'src/util.ts(12,8): warning TS6133: "x" is declared but never used',
      ].join('\n');
      const exitCode = 1;

      // Act
      const result = parseBuildOutput(output, exitCode);

      // Assert
      expect(result.errors).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
    });

    it('parseBuildOutput_typescriptWarning_extractsWarning', () => {
      // Arrange
      const output = 'src/helper.ts(3,1): warning TS6133: "foo" is declared but never read';
      const exitCode = 0;

      // Act
      const result = parseBuildOutput(output, exitCode);

      // Assert
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].file).toBe('src/helper.ts');
      expect(result.succeeded).toBe(true);
    });
  });

  // ─── parseTestOutput ───────────────────────────────────────────────────────

  describe('parseTestOutput', () => {
    it('parseTestOutput_vitestV1_allPassing', () => {
      // Arrange — Vitest/Jest v1 format with colon and "total"
      const output = 'Tests: 5 passed, 8 total';
      const exitCode = 0;

      // Act
      const result = parseTestOutput(output, exitCode);

      // Assert
      expect(result.passed).toBe(5);
      expect(result.failed).toBe(0);
      expect(result.total).toBe(8);
      expect(result.succeeded).toBe(true);
    });

    it('parseTestOutput_vitestV1_withFailures', () => {
      // Arrange
      const output = 'Tests: 5 passed, 1 failed, 2 skipped, 8 total';
      const exitCode = 1;

      // Act
      const result = parseTestOutput(output, exitCode);

      // Assert
      expect(result.passed).toBe(5);
      expect(result.failed).toBe(1);
      expect(result.skipped).toBe(2);
      expect(result.total).toBe(8);
      expect(result.succeeded).toBe(false);
    });

    it('parseTestOutput_vitestV2_allPassing', () => {
      // Arrange — Vitest 2.x format: "Tests  N passed (N)" — no colon, no "total"
      const output = '      Tests  2 passed (2)';
      const exitCode = 0;

      // Act
      const result = parseTestOutput(output, exitCode);

      // Assert
      expect(result.passed).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(true);
    });

    it('parseTestOutput_vitestV2_withFailures_failedFirst', () => {
      // Arrange — When failures exist Vitest 2.x puts failed count FIRST
      const output = '      Tests  1 failed | 251 passed (252)';
      const exitCode = 1;

      // Act
      const result = parseTestOutput(output, exitCode);

      // Assert
      expect(result.passed).toBe(251);
      expect(result.failed).toBe(1);
      expect(result.total).toBe(252);
      expect(result.succeeded).toBe(false);
    });

    it('parseTestOutput_vitestV2_withSkipped', () => {
      // Arrange
      const output = '      Tests  5 passed | 2 skipped (7)';
      const exitCode = 0;

      // Act
      const result = parseTestOutput(output, exitCode);

      // Assert
      expect(result.passed).toBe(5);
      expect(result.skipped).toBe(2);
      expect(result.total).toBe(7);
    });

    it('parseTestOutput_vitestV2_withAnsiCodes_parsed', () => {
      // Arrange — Real Vitest 2.x output includes ANSI colour codes
      const output = '\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m189 passed\x1b[39m\x1b[22m\x1b[90m (189)\x1b[39m';
      const exitCode = 0;

      // Act
      const result = parseTestOutput(output, exitCode);

      // Assert
      expect(result.passed).toBe(189);
      expect(result.total).toBe(189);
      expect(result.succeeded).toBe(true);
    });

    it('parseTestOutput_vitestV2_failedAnsiCodes_parsed', () => {
      // Arrange — Real Vitest 2.x failed summary with ANSI
      const output =
        '\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[31m1 failed\x1b[39m\x1b[22m\x1b[2m | \x1b[22m\x1b[1m\x1b[32m251 passed\x1b[39m\x1b[22m\x1b[90m (252)\x1b[39m';
      const exitCode = 1;

      // Act
      const result = parseTestOutput(output, exitCode);

      // Assert
      expect(result.passed).toBe(251);
      expect(result.failed).toBe(1);
      expect(result.total).toBe(252);
    });

    it('parseTestOutput_dotnet_extractsCounts', () => {
      // Arrange — dotnet test summary line
      const output = 'Passed! - Failed: 0, Passed: 10, Skipped: 0, Total: 10';
      const exitCode = 0;

      // Act
      const result = parseTestOutput(output, exitCode);

      // Assert
      expect(result.passed).toBe(10);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.total).toBe(10);
      expect(result.succeeded).toBe(true);
    });

    it('parseTestOutput_dotnet_withFailures', () => {
      // Arrange
      const output = 'Failed! - Failed: 2, Passed: 8, Skipped: 1, Total: 11';
      const exitCode = 1;

      // Act
      const result = parseTestOutput(output, exitCode);

      // Assert
      expect(result.failed).toBe(2);
      expect(result.passed).toBe(8);
      expect(result.total).toBe(11);
    });

    it('parseTestOutput_rust_extractsCounts', () => {
      // Arrange — Rust test result line
      const output = 'test result: ok. 14 passed; 0 failed; 3 ignored; 0 measured';
      const exitCode = 0;

      // Act
      const result = parseTestOutput(output, exitCode);

      // Assert
      expect(result.passed).toBe(14);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(3);   // "ignored" maps to skipped
      expect(result.total).toBe(17);    // passed + failed + skipped
    });

    it('parseTestOutput_rust_withFailures', () => {
      // Arrange
      const output = 'test result: FAILED. 10 passed; 2 failed; 0 ignored; 0 measured';
      const exitCode = 1;

      // Act
      const result = parseTestOutput(output, exitCode);

      // Assert
      expect(result.passed).toBe(10);
      expect(result.failed).toBe(2);
      expect(result.succeeded).toBe(false);
    });

    it('parseTestOutput_individualFailureLines_captured', () => {
      // Arrange — Individual FAIL lines are collected in failures[]
      const output = [
        '  FAIL src/foo.test.ts [10ms]',
        '  FAIL src/bar.test.ts [5ms]',
        'Tests: 0 passed, 2 failed, 2 total',
      ].join('\n');
      const exitCode = 1;

      // Act
      const result = parseTestOutput(output, exitCode);

      // Assert
      expect(result.failures).toHaveLength(2);
      expect(result.failures[0].name).toContain('src/foo.test.ts');
      expect(result.failures[1].name).toContain('src/bar.test.ts');
    });

    it('parseTestOutput_unknownFormat_zeroCountsExitCodeDrivesSuccess', () => {
      // Arrange — output with no recognizable pattern
      const output = 'done in 2.5s';
      const exitCode = 0;

      // Act
      const result = parseTestOutput(output, exitCode);

      // Assert — unknown format yields zeros but still respects exitCode
      expect(result.passed).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.succeeded).toBe(true);
    });
  });

  // ─── loadConfig ────────────────────────────────────────────────────────────
  //
  // loadConfig reads PROJECT_ROOT which is computed at module load time.
  // We bust require.cache[GATE_PATH] before each re-require so Node re-executes
  // gate.js with the updated CLAUDE_PROJECT_DIR value baked into PROJECT_ROOT.

  describe('loadConfig', () => {
    let tmp;
    let savedEnv;

    beforeEach(() => {
      tmp = createTmpDir();
      savedEnv = process.env.CLAUDE_PROJECT_DIR;
    });

    afterEach(() => {
      if (savedEnv === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = savedEnv;
      // Re-bust cache so the top-level require is not stale for other suites
      delete require.cache[GATE_PATH];
      tmp.cleanup();
    });

    function freshLoadConfig() {
      process.env.CLAUDE_PROJECT_DIR = tmp.root;
      delete require.cache[GATE_PATH];
      return require('../gate').loadConfig;
    }

    it('loadConfig_packageJson_returnsNodeStack', () => {
      // Arrange
      tmp.write('package.json', JSON.stringify({ scripts: { build: 'tsc', test: 'vitest run' } }));
      const loadConfig = freshLoadConfig();

      // Act
      const config = loadConfig();

      // Assert
      expect(config.stack).toBe('node');
      expect(config.build.command).toBe('npm run build');
      expect(config.test.command).toBe('npm test');
    });

    it('loadConfig_packageJson_noScripts_fallsBackToTsc', () => {
      // Arrange — package.json with no scripts block
      tmp.write('package.json', JSON.stringify({ name: 'my-lib' }));
      const loadConfig = freshLoadConfig();

      // Act
      const config = loadConfig();

      // Assert
      expect(config.stack).toBe('node');
      expect(config.build.command).toBe('npx tsc --noEmit');
    });

    it('loadConfig_cargoToml_returnsRustStack', () => {
      // Arrange
      tmp.write('Cargo.toml', '[package]\nname = "myapp"\nversion = "0.1.0"');
      const loadConfig = freshLoadConfig();

      // Act
      const config = loadConfig();

      // Assert
      expect(config.stack).toBe('rust');
      expect(config.build.command).toBe('cargo build');
      expect(config.test.command).toBe('cargo test');
    });

    it('loadConfig_goMod_returnsGoStack', () => {
      // Arrange
      tmp.write('go.mod', 'module example.com/myapp\n\ngo 1.21');
      const loadConfig = freshLoadConfig();

      // Act
      const config = loadConfig();

      // Assert
      expect(config.stack).toBe('go');
      expect(config.build.command).toBe('go build ./...');
      expect(config.test.command).toBe('go test ./...');
    });

    it('loadConfig_sln_returnsDotnetStack', () => {
      // Arrange
      tmp.write('MyApp.sln', 'Microsoft Visual Studio Solution File');
      const loadConfig = freshLoadConfig();

      // Act
      const config = loadConfig();

      // Assert
      expect(config.stack).toBe('dotnet');
      expect(config.build.command).toContain('dotnet build');
      expect(config.test.command).toContain('dotnet test');
    });

    it('loadConfig_slnx_returnsDotnetStack', () => {
      // Arrange
      tmp.write('MyApp.slnx', '<Solution />');
      const loadConfig = freshLoadConfig();

      // Act
      const config = loadConfig();

      // Assert
      expect(config.stack).toBe('dotnet');
    });

    it('loadConfig_makefile_returnsMakeStack', () => {
      // Arrange
      tmp.write('Makefile', 'build:\n\tgo build\ntest:\n\tgo test ./...');
      const loadConfig = freshLoadConfig();

      // Act
      const config = loadConfig();

      // Assert
      expect(config.stack).toBe('make');
      expect(config.build.command).toBe('make build');
    });

    it('loadConfig_noProjectFiles_returnsUnknownStack', () => {
      // Arrange — empty tmp dir (no project files)
      const loadConfig = freshLoadConfig();

      // Act
      const config = loadConfig();

      // Assert
      expect(config.stack).toBe('unknown');
    });

    it('loadConfig_explicitConfigFile_overridesAutoDetection', () => {
      // Arrange — package.json present (would auto-detect node) but config file overrides
      tmp.write('package.json', JSON.stringify({ scripts: { build: 'tsc' } }));
      tmp.write('.claude/gate.config.json', JSON.stringify({
        build: { command: 'make release', timeout: 120000 },
        test: { command: 'make test', timeout: 300000 },
        stack: 'custom'
      }));
      const loadConfig = freshLoadConfig();

      // Act
      const config = loadConfig();

      // Assert — explicit config wins over auto-detection
      expect(config.build.command).toBe('make release');
      expect(config.test.command).toBe('make test');
      expect(config.stack).toBe('custom');
    });

    it('loadConfig_explicitConfigFile_returnsExpectedShape', () => {
      // Arrange
      tmp.write('.claude/gate.config.json', JSON.stringify({
        build: { command: 'npm run build', timeout: 300000 },
        test: { command: 'npm test', timeout: 600000 }
      }));
      const loadConfig = freshLoadConfig();

      // Act
      const config = loadConfig();

      // Assert
      expect(config).toHaveProperty('build');
      expect(config).toHaveProperty('test');
      expect(typeof config.build.command).toBe('string');
      expect(typeof config.build.timeout).toBe('number');
    });
  });

  // ─── acquireLock / releaseLock ─────────────────────────────────────────────
  //
  // GATE_DIR = path.join(PROJECT_ROOT, 'docs', '.output', 'telemetry')
  // LOCK_FILE = path.join(GATE_DIR, '.gate.lock')
  // Both are frozen at module load, so we use the same cache-bust pattern.

  describe('acquireLock / releaseLock', () => {
    let tmp;
    let savedEnv;

    beforeEach(() => {
      tmp = createTmpDir();
      savedEnv = process.env.CLAUDE_PROJECT_DIR;
    });

    afterEach(() => {
      if (savedEnv === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = savedEnv;
      delete require.cache[GATE_PATH];
      tmp.cleanup();
    });

    function freshGate() {
      process.env.CLAUDE_PROJECT_DIR = tmp.root;
      delete require.cache[GATE_PATH];
      return require('../gate');
    }

    it('acquireLock_firstCall_returnsTrue', () => {
      // Arrange
      const { acquireLock } = freshGate();

      // Act
      const result = acquireLock();

      // Assert
      expect(result).toBe(true);
    });

    it('acquireLock_doubleAcquire_secondReturnsFalse', () => {
      // Arrange — same module instance, lock already held after first call
      const { acquireLock } = freshGate();
      acquireLock();

      // Act
      const second = acquireLock();

      // Assert
      expect(second).toBe(false);
    });

    it('releaseLock_afterAcquire_allowsReacquire', () => {
      // Arrange
      const { acquireLock, releaseLock } = freshGate();
      acquireLock();

      // Act
      releaseLock();
      const reacquired = acquireLock();

      // Assert
      expect(reacquired).toBe(true);
    });

    it('releaseLock_calledTwice_doesNotThrow', () => {
      // Arrange
      const { acquireLock, releaseLock } = freshGate();
      acquireLock();

      // Act / Assert — second release is idempotent
      releaseLock();
      expect(() => releaseLock()).not.toThrow();
    });

    it('acquireLock_staleLock_breaksAndReturnsTrue', () => {
      // Arrange — write a lock file with a started time >10 minutes ago
      // GATE_DIR = docs/.output/telemetry inside PROJECT_ROOT
      const gateDir = path.join(tmp.root, 'docs', '.output', 'telemetry');
      fs.mkdirSync(gateDir, { recursive: true });
      const lockFile = path.join(gateDir, '.gate.lock');
      const staleTime = new Date(Date.now() - 700000).toISOString(); // 700s > 600s threshold
      fs.writeFileSync(lockFile, JSON.stringify({ pid: 99999, started: staleTime }));

      const { acquireLock } = freshGate();

      // Act
      const result = acquireLock();

      // Assert — stale lock is broken and acquire succeeds
      expect(result).toBe(true);
    });

    it('acquireLock_freshLock_returnsFalse', () => {
      // Arrange — write a fresh lock (under 10 minutes old)
      const gateDir = path.join(tmp.root, 'docs', '.output', 'telemetry');
      fs.mkdirSync(gateDir, { recursive: true });
      const lockFile = path.join(gateDir, '.gate.lock');
      const freshTime = new Date(Date.now() - 5000).toISOString(); // 5s old
      fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid + 1, started: freshTime }));

      const { acquireLock } = freshGate();

      // Act
      const result = acquireLock();

      // Assert — active fresh lock blocks acquire
      expect(result).toBe(false);
    });
  });
});
