// AC→source map (TDD-3.6 / scaffold):
//   - scaffoldDir(srcDir, destDir, excludes, results, force) — pure helper, no side effects
//   - Template marker: <!-- @@template --> preserved verbatim as first line after copy
//   - Skip-existing: existing file untouched when force=false; results.skipped captures it
//   - Force overwrite: existing file replaced when force=true; results.created captures it
//   - Root config copy: root template files land at destDir (project root equiv)
//   - Cross-platform: path.join used everywhere; no hardcoded forward-slash separators in logic

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

const {
    scaffoldDir,
    runScaffold,
    parseSetArgs,
    applySubstitutions,
    KNOWN_SCAFFOLD_VARS,
} = require('../scaffold');
const { createTmpDir } = require('./_helpers/tmp-dir');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal results accumulator that scaffoldDir expects. */
function makeResults() {
    return { created: [], skipped: [], directories: [] };
}

let tmp;

beforeEach(() => {
    tmp = createTmpDir({ prefix: 'scaffold-test-' });
});

afterEach(() => {
    tmp.cleanup();
});

// ---------------------------------------------------------------------------
// Fresh directory — templates copied with marker preserved
// ---------------------------------------------------------------------------

describe('scaffoldDir — fresh destination', () => {
    it('freshDir_copiesFileToDestination', () => {
        // Arrange
        tmp.write('src/hello.md', 'Hello world');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert
        const destFile = path.join(dest, 'hello.md');
        expect(fs.existsSync(destFile)).toBe(true);
        expect(fs.readFileSync(destFile, 'utf8')).toBe('Hello world');
    });

    it('freshDir_createsDestinationDirectory', () => {
        // Arrange — dest does not exist yet
        tmp.write('src/a.md', 'content');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'newdir');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert
        expect(fs.existsSync(dest)).toBe(true);
        expect(results.directories.length).toBeGreaterThan(0);
    });

    it('freshDir_recordsCreatedFile', () => {
        // Arrange
        tmp.write('src/file.md', 'data');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert
        expect(results.created.length).toBe(1);
        expect(results.skipped.length).toBe(0);
    });

    it('freshDir_recursiveSubdir_copiesNestedFiles', () => {
        // Arrange
        tmp.write('src/sub/nested.md', '# Nested');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert
        const destNested = path.join(dest, 'sub', 'nested.md');
        expect(fs.existsSync(destNested)).toBe(true);
        expect(fs.readFileSync(destNested, 'utf8')).toBe('# Nested');
    });

    it('freshDir_multipleFiles_allCopied', () => {
        // Arrange
        tmp.write('src/a.md', 'A');
        tmp.write('src/b.md', 'B');
        tmp.write('src/c.md', 'C');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert
        expect(results.created.length).toBe(3);
        expect(fs.existsSync(path.join(dest, 'a.md'))).toBe(true);
        expect(fs.existsSync(path.join(dest, 'b.md'))).toBe(true);
        expect(fs.existsSync(path.join(dest, 'c.md'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Template marker preservation
// ---------------------------------------------------------------------------

describe('scaffoldDir — template marker preservation', () => {
    it('templateMarker_firstLinePreservedAfterCopy', () => {
        // Arrange: source file starts with the template marker
        const marker = '<!-- @@template -->';
        tmp.write('src/doc.md', `${marker}\n# Doc Title\n\nContent here.\n`);
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert: first line of copied file is the exact marker
        const copied = fs.readFileSync(path.join(dest, 'doc.md'), 'utf8');
        const firstLine = copied.split('\n')[0];
        expect(firstLine).toBe(marker);
    });

    it('templateMarker_fullContentUnchangedAfterCopy', () => {
        // Arrange
        const content = '<!-- @@template -->\n# Title\n\nBody content.\n';
        tmp.write('src/template.md', content);
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert: content is byte-for-byte identical
        const copied = fs.readFileSync(path.join(dest, 'template.md'), 'utf8');
        expect(copied).toBe(content);
    });

    it('templateMarker_fileWithoutMarker_copiedNormally', () => {
        // Arrange: file that does NOT start with the marker
        tmp.write('src/regular.md', '# Regular File\n\nNo marker here.\n');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert: file copied, first line is NOT the template marker
        const copied = fs.readFileSync(path.join(dest, 'regular.md'), 'utf8');
        expect(copied.startsWith('<!-- @@template -->')).toBe(false);
        expect(copied).toContain('# Regular File');
    });
});

// ---------------------------------------------------------------------------
// Skip-existing (force=false)
// ---------------------------------------------------------------------------

describe('scaffoldDir — skip existing files (force=false)', () => {
    it('skipExisting_existingFile_notOverwritten', () => {
        // Arrange: pre-write dest file with different content
        tmp.write('src/foo.md', 'new content from template');
        tmp.write('dest/foo.md', 'original content');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert: dest file unchanged
        const destContent = fs.readFileSync(path.join(dest, 'foo.md'), 'utf8');
        expect(destContent).toBe('original content');
    });

    it('skipExisting_existingFile_recordedInSkipped', () => {
        // Arrange
        tmp.write('src/foo.md', 'template content');
        tmp.write('dest/foo.md', 'existing content');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert
        expect(results.skipped.length).toBe(1);
        expect(results.created.length).toBe(0);
    });

    it('skipExisting_mixedNewAndExisting_correctlyCategorized', () => {
        // Arrange: one new file, one existing
        tmp.write('src/new.md', 'new');
        tmp.write('src/existing.md', 'template version');
        tmp.write('dest/existing.md', 'original');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert
        expect(results.created.length).toBe(1);
        expect(results.skipped.length).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Force overwrite (force=true)
// ---------------------------------------------------------------------------

describe('scaffoldDir — force overwrite (force=true)', () => {
    it('force_existingFile_overwrittenWithTemplateContent', () => {
        // Arrange
        tmp.write('src/foo.md', 'new template content');
        tmp.write('dest/foo.md', 'old content');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, true);

        // Assert: dest now has template content
        const destContent = fs.readFileSync(path.join(dest, 'foo.md'), 'utf8');
        expect(destContent).toBe('new template content');
    });

    it('force_existingFile_recordedInCreatedNotSkipped', () => {
        // Arrange
        tmp.write('src/foo.md', 'template');
        tmp.write('dest/foo.md', 'old');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, true);

        // Assert
        expect(results.created.length).toBe(1);
        expect(results.skipped.length).toBe(0);
    });

    it('force_false_existingNotOverwritten', () => {
        // Arrange
        tmp.write('src/bar.md', 'template');
        tmp.write('dest/bar.md', 'keep me');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act — force=false (the default skip behavior)
        scaffoldDir(src, dest, [], results, false);

        // Assert
        const destContent = fs.readFileSync(path.join(dest, 'bar.md'), 'utf8');
        expect(destContent).toBe('keep me');
    });
});

// ---------------------------------------------------------------------------
// Excludes
// ---------------------------------------------------------------------------

describe('scaffoldDir — excludes', () => {
    it('excludes_entryInExcludeList_notCopied', () => {
        // Arrange
        tmp.write('src/include.md', 'yes');
        tmp.write('src/root/skip.md', 'no');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, ['root'], results, false);

        // Assert: 'root' subdir was skipped
        expect(fs.existsSync(path.join(dest, 'root'))).toBe(false);
        expect(fs.existsSync(path.join(dest, 'include.md'))).toBe(true);
    });

    it('excludes_emptyArray_copiesEverything', () => {
        // Arrange
        tmp.write('src/a.md', 'A');
        tmp.write('src/b/c.md', 'C');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert
        expect(fs.existsSync(path.join(dest, 'a.md'))).toBe(true);
        expect(fs.existsSync(path.join(dest, 'b', 'c.md'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Root config copy — .gitignore lands at destDir
// ---------------------------------------------------------------------------

describe('scaffoldDir — root config copy', () => {
    it('rootConfig_gitignore_copiedToProjectRoot', () => {
        // Arrange: mimic .claude/templates/root/ with a .gitignore
        const gitignoreContent = 'node_modules/\n.DS_Store\n';
        tmp.write('rootTemplates/.gitignore', gitignoreContent);

        const rootTemplatesDir = path.join(tmp.root, 'rootTemplates');
        const projectRoot = path.join(tmp.root, 'project');
        fs.mkdirSync(projectRoot, { recursive: true });

        const results = makeResults();

        // Act: scaffold rootTemplates/ → projectRoot/ (same as root template copy in main())
        scaffoldDir(rootTemplatesDir, projectRoot, [], results, false);

        // Assert
        const destGitignore = path.join(projectRoot, '.gitignore');
        expect(fs.existsSync(destGitignore)).toBe(true);
        expect(fs.readFileSync(destGitignore, 'utf8')).toBe(gitignoreContent);
    });

    it('rootConfig_multipleRootFiles_allCopied', () => {
        // Arrange: mimic root templates with multiple files
        tmp.write('rootTemplates/.gitignore', 'node_modules/\n');
        tmp.write('rootTemplates/README.md', '# README');

        const rootTemplatesDir = path.join(tmp.root, 'rootTemplates');
        const projectRoot = path.join(tmp.root, 'project');
        fs.mkdirSync(projectRoot, { recursive: true });

        const results = makeResults();

        // Act
        scaffoldDir(rootTemplatesDir, projectRoot, [], results, false);

        // Assert
        expect(fs.existsSync(path.join(projectRoot, '.gitignore'))).toBe(true);
        expect(fs.existsSync(path.join(projectRoot, 'README.md'))).toBe(true);
        expect(results.created.length).toBe(2);
    });

    it('rootConfig_gitignoreExistingSkippedByDefault', () => {
        // Arrange: project already has a .gitignore
        tmp.write('rootTemplates/.gitignore', 'template version');
        tmp.write('project/.gitignore', 'project version — keep me');

        const rootTemplatesDir = path.join(tmp.root, 'rootTemplates');
        const projectRoot = path.join(tmp.root, 'project');

        const results = makeResults();

        // Act — force=false
        scaffoldDir(rootTemplatesDir, projectRoot, [], results, false);

        // Assert: project .gitignore unchanged
        const content = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');
        expect(content).toBe('project version — keep me');
        expect(results.skipped.length).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Cross-platform: path.join usage — no hardcoded forward-slash separators
// ---------------------------------------------------------------------------

describe('scaffoldDir — cross-platform path correctness', () => {
    it('crossPlatform_resultPathsUseOSSeparator', () => {
        // Arrange
        tmp.write('src/deep/file.md', 'content');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert: paths in results use path.join (OS-correct separator)
        // They should NOT contain forward-slash on Windows as a path separator
        // within the relative portion (path.relative gives OS separators).
        // The simplest cross-platform check: reconstruct with path.join and compare.
        for (const p of [...results.created, ...results.skipped, ...results.directories]) {
            // Verify the path is reconstructable via path.normalize without change
            expect(p).toBe(path.normalize(p));
        }
    });

    it('crossPlatform_destFileAccessibleViaPathJoin', () => {
        // Arrange
        tmp.write('src/nested/doc.md', '# Doc');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert: file is accessible through path.join construction
        const expectedPath = path.join(dest, 'nested', 'doc.md');
        expect(fs.existsSync(expectedPath)).toBe(true);
        expect(fs.readFileSync(expectedPath, 'utf8')).toBe('# Doc');
    });
});

// ---------------------------------------------------------------------------
// Module require-safety: importing scaffold does not execute side effects
// ---------------------------------------------------------------------------

describe('scaffold module — require safety', () => {
    it('requireSafety_importDoesNotThrow', () => {
        // This test verifies that require('../scaffold') does not execute
        // top-level side effects (console.log, process.exit, file writes).
        // If it DID, this test would fail with a console error or exit.
        // The fact that scaffoldDir is already imported at the top of this
        // file without error proves require-safety.
        expect(typeof scaffoldDir).toBe('function');
    });

    it('requireSafety_exportsScaffoldDir', () => {
        // Verify the named export exists and is the function
        const mod = require('../scaffold');
        expect(mod).toHaveProperty('scaffoldDir');
        expect(typeof mod.scaffoldDir).toBe('function');
    });
});

// ─── R10 — --set <key>=<value> non-interactive substitution ──────────────────

describe('parseSetArgs (R10)', () => {

    it('parseSetArgs_singleFlag_returnsOneEntry', () => {
        const result = parseSetArgs(['--set', 'project_name=Foo']);
        expect(result).toEqual({ project_name: 'Foo' });
    });

    it('parseSetArgs_multipleFlags_accumulates', () => {
        const result = parseSetArgs([
            '--set', 'project_name=Foo',
            '--set', 'phase=Discovery',
        ]);
        expect(result).toEqual({ project_name: 'Foo', phase: 'Discovery' });
    });

    it('parseSetArgs_equalsForm_accepted', () => {
        const result = parseSetArgs(['--set=project_name=Foo']);
        expect(result).toEqual({ project_name: 'Foo' });
    });

    it('parseSetArgs_valueWithEquals_handledCorrectly', () => {
        // URL with query string contains additional `=` signs
        const url = 'https://example.com/?key=value&other=thing';
        const result = parseSetArgs(['--set', `repo_url=${url}`]);
        expect(result).toEqual({ repo_url: url });
    });

    it('parseSetArgs_unknownKey_throwsWithAllowlist', () => {
        expect(() => parseSetArgs(['--set', 'arbitrary_key=anything']))
            .toThrow(/arbitrary_key/);
        // Error message should include allowlist
        try {
            parseSetArgs(['--set', 'arbitrary_key=anything']);
        } catch (e) {
            expect(e.message).toMatch(/project_name/);
            expect(e.message).toMatch(/repo_url/);
        }
    });

    it('parseSetArgs_invalidUrl_throwsValidationMessage', () => {
        expect(() => parseSetArgs(['--set', 'repo_url=not-a-url']))
            .toThrow(/repo_url/);
    });

    it('parseSetArgs_invalidDate_throwsValidationMessage', () => {
        expect(() => parseSetArgs(['--set', 'date=tomorrow']))
            .toThrow(/date/);
    });

    it('parseSetArgs_emptyArgv_returnsEmptyObject', () => {
        expect(parseSetArgs([])).toEqual({});
    });

    it('parseSetArgs_noSetFlagMixedWithOthers_returnsEmptyObject', () => {
        // Other flags are ignored — only --set pairs are extracted
        expect(parseSetArgs(['--force', '--verbose'])).toEqual({});
    });

    it('parseSetArgs_setFlagWithoutValue_throws', () => {
        // --set with no following arg, or an arg that doesn't match key=value
        expect(() => parseSetArgs(['--set'])).toThrow();
        expect(() => parseSetArgs(['--set', 'no-equals-here'])).toThrow();
    });

});

describe('applySubstitutions (R10)', () => {

    it('applySubstitutions_singleVar_bothPlaceholdersReplaced', () => {
        const content = 'Project: {Project Name}\nKey: {project_name}';
        const result = applySubstitutions(content, { project_name: 'Foo' });
        expect(result).toBe('Project: Foo\nKey: Foo');
    });

    it('applySubstitutions_repoUrl_bothFormsReplaced', () => {
        const content = 'See {repo URL} or {repo_url} for details.';
        const result = applySubstitutions(content, { repo_url: 'https://example.com' });
        expect(result).toBe('See https://example.com or https://example.com for details.');
    });

    it('applySubstitutions_noSubstitutions_returnsContentUnchanged', () => {
        const content = 'Project: {Project Name}';
        expect(applySubstitutions(content, {})).toBe(content);
    });

    it('applySubstitutions_unknownKey_silentlyIgnored', () => {
        // Defensive: never reachable via parseSetArgs (which validates), but the
        // pure function should no-op rather than throw on stray keys.
        const content = 'unchanged: {Project Name}';
        const result = applySubstitutions(content, { not_in_allowlist: 'x' });
        expect(result).toBe(content);
    });

    it('applySubstitutions_emptyContent_returnsEmpty', () => {
        expect(applySubstitutions('', { project_name: 'Foo' })).toBe('');
    });

});

describe('KNOWN_SCAFFOLD_VARS (R10)', () => {

    it('KNOWN_SCAFFOLD_VARS_exported_andValidShape', () => {
        expect(Array.isArray(KNOWN_SCAFFOLD_VARS)).toBe(true);
        expect(KNOWN_SCAFFOLD_VARS.length).toBeGreaterThan(0);

        for (const entry of KNOWN_SCAFFOLD_VARS) {
            expect(entry).toHaveProperty('key');
            expect(typeof entry.key).toBe('string');
            expect(entry).toHaveProperty('placeholders');
            expect(Array.isArray(entry.placeholders)).toBe(true);
            expect(entry.placeholders.length).toBeGreaterThan(0);
            expect(entry).toHaveProperty('validate');
            expect(typeof entry.validate).toBe('function');
        }
    });

    it('KNOWN_SCAFFOLD_VARS_includesCoreKeys', () => {
        const keys = KNOWN_SCAFFOLD_VARS.map(v => v.key);
        expect(keys).toContain('project_name');
        expect(keys).toContain('repo_url');
        expect(keys).toContain('phase');
        expect(keys).toContain('date');
    });

});

describe('runScaffold with substitutions (R10 end-to-end)', () => {

    function makeMinimalTemplateTree(tmpRoot) {
        // Create a minimal templates/ tree mirroring the real scaffold structure
        // enough that runScaffold can exercise substitution end-to-end.
        const templatesDir = path.join(tmpRoot, '.claude', 'templates');
        fs.mkdirSync(templatesDir, { recursive: true });
        fs.writeFileSync(
            path.join(templatesDir, '_project-context.md'),
            '<!-- @@template -->\n# Project: {Project Name}\nPhase: {current phase}\nDate: {YYYY-MM-DD}\n'
        );
    }

    it('runScaffold_withSubstitutions_filesContainSubstitutedValues', () => {
        // Arrange
        makeMinimalTemplateTree(tmp.root);

        // Act
        runScaffold(tmp.root, {
            substitutions: { project_name: 'Foo', phase: 'Discovery', date: '2026-05-10' },
            silent: true,
        });

        // Assert — scaffolded file has substitutions applied
        const written = fs.readFileSync(
            path.join(tmp.root, 'docs', '_project-context.md'),
            'utf8'
        );
        expect(written).toContain('# Project: Foo');
        expect(written).toContain('Phase: Discovery');
        expect(written).toContain('Date: 2026-05-10');
        expect(written).not.toContain('{Project Name}');
        expect(written).not.toContain('{current phase}');
    });

    it('runScaffold_substitutionsButTargetExists_doesNotModify', () => {
        // Arrange — pre-existing target with custom user content
        makeMinimalTemplateTree(tmp.root);
        fs.mkdirSync(path.join(tmp.root, 'docs'), { recursive: true });
        const userCustomized = '# My Custom Project\nDo not overwrite this.\n';
        fs.writeFileSync(
            path.join(tmp.root, 'docs', '_project-context.md'),
            userCustomized
        );

        // Act
        runScaffold(tmp.root, {
            substitutions: { project_name: 'Foo' },
            silent: true,
        });

        // Assert — pre-existing file untouched (existing skip semantics preserved)
        const written = fs.readFileSync(
            path.join(tmp.root, 'docs', '_project-context.md'),
            'utf8'
        );
        expect(written).toBe(userCustomized);
        expect(written).not.toContain('Foo');
    });

    it('runScaffold_noSubstitutions_currentBehaviorPreserved', () => {
        // Regression guard — without --set, placeholders remain as-is
        makeMinimalTemplateTree(tmp.root);

        runScaffold(tmp.root, { silent: true });

        const written = fs.readFileSync(
            path.join(tmp.root, 'docs', '_project-context.md'),
            'utf8'
        );
        expect(written).toContain('{Project Name}');
        expect(written).toContain('{current phase}');
        expect(written).toContain('{YYYY-MM-DD}');
    });

});
