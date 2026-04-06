/**
 * Integration tests for the Plugin Conventions System
 *
 * Tests the complete convention lifecycle through the PUBLIC API only.
 * All operations use temporary directories -- no real project modification.
 *
 * Covers:
 * 1. End-to-end convention lifecycle (install, verify, uninstall)
 * 2. Idempotency (apply twice = same result)
 * 3. Version upgrade (v1 -> v2 content update)
 * 4. Multiple plugins coexisting
 * 5. Doctor detection and fix
 * 6. Malformed CLAUDE.md handling
 * 7. Path classification (.gitignore entries)
 *
 * IMPLEMENTATION ISSUES FOUND:
 * - applyConventions() silently skips all convention application despite valid
 *   plugin.json with conventions field. resolvePluginConventions() and
 *   readConventionTemplate() work correctly individually, but applyConventions()
 *   does not invoke them. Tests 1-A, 2-A, 3-A, 4-A, 20-A document this.
 * - checkGitignoreEntries() returns { present: string[], missing: string[] }
 *   instead of Promise<string[]> per architecture spec. Tests adapted to use
 *   the actual .missing property. This is a minor API deviation (richer return).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  // Gitignore operations
  ensureGitignoreEntries,
  removeGitignoreEntries,
  checkGitignoreEntries,
  // CLAUDE.md operations
  parseClaudeMdSections,
  injectClaudeMdSection,
  removeClaudeMdSection,
  listClaudeMdSections,
  // Convention resolution
  resolvePluginConventions,
  readConventionTemplate,
  // End-to-end convention application
  applyConventions,
  removeConventions,
  // Types
  type ParseResult,
} from '../../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an isolated temp directory for test operations */
async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'conventions-integ-'));
}

/** Create a mock plugin directory with plugin.json and optional template */
async function createMockPlugin(
  baseDir: string,
  pluginName: string,
  opts: {
    gitignoreProject?: string[];
    gitignoreGlobal?: string[];
    claudemdSection?: string;
    claudemdVersion?: string;
    templateContent?: string;
  },
): Promise<string> {
  const pluginDir = join(baseDir, pluginName);
  await mkdir(pluginDir, { recursive: true });

  const manifest: Record<string, unknown> = {
    name: pluginName,
    version: '1.0.0',
    description: `Test plugin ${pluginName}`,
  };

  const conventions: Record<string, unknown> = {};

  if (opts.gitignoreProject || opts.gitignoreGlobal) {
    const gitignore: Record<string, string[]> = {};
    if (opts.gitignoreProject) gitignore.project = opts.gitignoreProject;
    if (opts.gitignoreGlobal) gitignore.global = opts.gitignoreGlobal;
    conventions.gitignore = gitignore;
  }

  if (opts.claudemdSection && opts.claudemdVersion && opts.templateContent) {
    conventions.claudemd = {
      section: opts.claudemdSection,
      template: './templates/claude-md-conventions.md',
      version: opts.claudemdVersion,
    };

    // Create the template file
    const templateDir = join(pluginDir, 'templates');
    await mkdir(templateDir, { recursive: true });
    await writeFile(
      join(templateDir, 'claude-md-conventions.md'),
      opts.templateContent,
      'utf-8',
    );
  }

  if (Object.keys(conventions).length > 0) {
    manifest.conventions = conventions;
  }

  await writeFile(
    join(pluginDir, 'plugin.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );

  return pluginDir;
}

/**
 * Simulate what applyConventions SHOULD do, using the working lower-level APIs.
 * This lets us test the convention system end-to-end even though applyConventions
 * has a bug (see IMPLEMENTATION ISSUES above).
 */
async function applyConventionsManually(
  pluginDir: string,
  projectDir: string,
): Promise<{
  gitignore: { added: string[]; modified: boolean };
  claudemd: { action: string; section?: string };
}> {
  const conventions = await resolvePluginConventions(pluginDir);
  if (!conventions) {
    return { gitignore: { added: [], modified: false }, claudemd: { action: 'skipped' } };
  }

  let gitignoreResult = { added: [] as string[], modified: false };
  if (conventions.gitignore?.project && conventions.gitignore.project.length > 0) {
    const gitignorePath = join(projectDir, '.gitignore');
    gitignoreResult = await ensureGitignoreEntries(gitignorePath, conventions.gitignore.project);
  }

  let claudemdResult: { action: string; section?: string } = { action: 'skipped' };
  if (conventions.claudemd) {
    const claudeMdPath = join(projectDir, 'CLAUDE.md');
    const template = await readConventionTemplate(pluginDir, conventions.claudemd.template);
    const injectResult = await injectClaudeMdSection(
      claudeMdPath,
      conventions.claudemd.section,
      conventions.claudemd.version,
      template,
    );
    claudemdResult = { action: injectResult.action, section: conventions.claudemd.section };
  }

  return { gitignore: gitignoreResult, claudemd: claudemdResult };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Convention System Integration', () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = join(tempDir, 'project');
    await mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // Category 1: End-to-End Convention Lifecycle
  // =========================================================================

  describe('End-to-End Convention Lifecycle', () => {
    it('TEST-1: install plugin with conventions updates .gitignore', async () => {
      const pluginDir = await createMockPlugin(tempDir, 'test-plugin', {
        gitignoreProject: ['.mnemex/', '.claude/sessions/'],
        claudemdSection: 'test-plugin',
        claudemdVersion: '1.0.0',
        templateContent: '## Test Plugin\n\nSome conventions here.\n',
      });

      const result = await applyConventionsManually(pluginDir, projectDir);

      // Gitignore should have been modified
      expect(result.gitignore.modified).toBe(true);
      expect(result.gitignore.added).toContain('.mnemex/');
      expect(result.gitignore.added).toContain('.claude/sessions/');

      // Verify file on disk
      const gitignorePath = join(projectDir, '.gitignore');
      expect(existsSync(gitignorePath)).toBe(true);
      const gitignoreContent = await readFile(gitignorePath, 'utf-8');
      expect(gitignoreContent).toContain('.mnemex/');
      expect(gitignoreContent).toContain('.claude/sessions/');
    });

    it('TEST-2: install plugin with conventions injects CLAUDE.md section', async () => {
      const pluginDir = await createMockPlugin(tempDir, 'test-plugin', {
        gitignoreProject: ['.mnemex/'],
        claudemdSection: 'test-plugin',
        claudemdVersion: '1.0.0',
        templateContent: '## Test Plugin Conventions\n\nDo not commit `.mnemex/`.\n',
      });

      const result = await applyConventionsManually(pluginDir, projectDir);

      // CLAUDE.md should have been injected
      expect(result.claudemd.action).toBe('inserted');

      // Verify file on disk
      const claudeMdPath = join(projectDir, 'CLAUDE.md');
      expect(existsSync(claudeMdPath)).toBe(true);
      const claudeMdContent = await readFile(claudeMdPath, 'utf-8');
      expect(claudeMdContent).toContain('<!-- BEGIN magus:test-plugin v1.0.0 -->');
      expect(claudeMdContent).toContain('<!-- END magus:test-plugin -->');
      expect(claudeMdContent).toContain('Test Plugin Conventions');
      expect(claudeMdContent).toContain('Do not commit `.mnemex/`.');
    });

    it('TEST-3: uninstall removes CLAUDE.md section but keeps gitignore entries', async () => {
      const pluginDir = await createMockPlugin(tempDir, 'test-plugin', {
        gitignoreProject: ['.mnemex/', '.claude/sessions/'],
        claudemdSection: 'test-plugin',
        claudemdVersion: '1.0.0',
        templateContent: '## Test Plugin Conventions\n\nContent here.\n',
      });

      // Apply conventions manually (since applyConventions has a bug)
      await applyConventionsManually(pluginDir, projectDir);

      // Verify both files exist
      const gitignorePath = join(projectDir, '.gitignore');
      const claudeMdPath = join(projectDir, 'CLAUDE.md');
      expect(existsSync(gitignorePath)).toBe(true);
      expect(existsSync(claudeMdPath)).toBe(true);

      // Remove CLAUDE.md section directly (removeConventions has same bug as applyConventions)
      const removeResult = await removeClaudeMdSection(claudeMdPath, 'test-plugin');
      expect(removeResult.removed).toBe(true);

      // CLAUDE.md section should be gone
      const claudeMdContent = await readFile(claudeMdPath, 'utf-8');
      expect(claudeMdContent).not.toContain('<!-- BEGIN magus:test-plugin');
      expect(claudeMdContent).not.toContain('<!-- END magus:test-plugin -->');
      expect(claudeMdContent).not.toContain('Test Plugin Conventions');

      // .gitignore entries MUST still be present (by design)
      const gitignoreContent = await readFile(gitignorePath, 'utf-8');
      expect(gitignoreContent).toContain('.mnemex/');
      expect(gitignoreContent).toContain('.claude/sessions/');
    });
  });

  // =========================================================================
  // Category 2: Idempotency
  // =========================================================================

  describe('Idempotency', () => {
    it('TEST-4: applying conventions twice produces identical result', async () => {
      const pluginDir = await createMockPlugin(tempDir, 'test-plugin', {
        gitignoreProject: ['.mnemex/'],
        claudemdSection: 'test-plugin',
        claudemdVersion: '1.0.0',
        templateContent: '## Test Conventions\n\nContent.\n',
      });

      // First apply (using manual helper)
      const result1 = await applyConventionsManually(pluginDir, projectDir);
      expect(result1.gitignore.modified).toBe(true);
      expect(result1.claudemd.action).toBe('inserted');

      // Snapshot file contents after first apply
      const gitignorePath = join(projectDir, '.gitignore');
      const claudeMdPath = join(projectDir, 'CLAUDE.md');
      const gitignoreAfterFirst = await readFile(gitignorePath, 'utf-8');
      const claudeMdAfterFirst = await readFile(claudeMdPath, 'utf-8');

      // Second apply
      const result2 = await applyConventionsManually(pluginDir, projectDir);
      expect(result2.gitignore.modified).toBe(false);
      expect(result2.claudemd.action).toBe('unchanged');

      // File contents must be identical
      const gitignoreAfterSecond = await readFile(gitignorePath, 'utf-8');
      const claudeMdAfterSecond = await readFile(claudeMdPath, 'utf-8');
      expect(gitignoreAfterSecond).toBe(gitignoreAfterFirst);
      expect(claudeMdAfterSecond).toBe(claudeMdAfterFirst);
    });

    it('TEST-5: ensureGitignoreEntries is idempotent', async () => {
      const gitignorePath = join(projectDir, '.gitignore');

      // First call
      const result1 = await ensureGitignoreEntries(gitignorePath, ['.mnemex/', '.claudemem/']);
      expect(result1.modified).toBe(true);
      expect(result1.added.length).toBe(2);

      const contentAfterFirst = await readFile(gitignorePath, 'utf-8');

      // Second call with same entries
      const result2 = await ensureGitignoreEntries(gitignorePath, ['.mnemex/', '.claudemem/']);
      expect(result2.modified).toBe(false);
      expect(result2.added.length).toBe(0);

      const contentAfterSecond = await readFile(gitignorePath, 'utf-8');
      expect(contentAfterSecond).toBe(contentAfterFirst);
    });

    it('TEST-6: injectClaudeMdSection with same version is idempotent', async () => {
      const claudeMdPath = join(projectDir, 'CLAUDE.md');
      const content = '## Test Section\n\nSome content.\n';

      // First inject
      const result1 = await injectClaudeMdSection(claudeMdPath, 'test-plugin', '1.0.0', content);
      expect(result1.action).toBe('inserted');

      // Second inject with same version and content
      const result2 = await injectClaudeMdSection(claudeMdPath, 'test-plugin', '1.0.0', content);
      expect(result2.action).toBe('unchanged');
    });
  });

  // =========================================================================
  // Category 3: Version Upgrade
  // =========================================================================

  describe('Version Upgrade', () => {
    it('TEST-7: applying v2.0.0 over v1.0.0 updates CLAUDE.md content', async () => {
      const claudeMdPath = join(projectDir, 'CLAUDE.md');
      const v1Content = '## V1 Content\n\nOriginal version.\n';
      const v2Content = '## V2 Content\n\nUpdated version with new features.\n';

      // Inject v1
      const result1 = await injectClaudeMdSection(claudeMdPath, 'test-plugin', '1.0.0', v1Content);
      expect(result1.action).toBe('inserted');

      // Inject v2
      const result2 = await injectClaudeMdSection(claudeMdPath, 'test-plugin', '2.0.0', v2Content);
      expect(result2.action).toBe('updated');
      expect(result2.previousVersion).toBe('1.0.0');
    });

    it('TEST-8: version marker is updated in BEGIN tag after upgrade', async () => {
      const claudeMdPath = join(projectDir, 'CLAUDE.md');
      const v1Content = '## V1 Content\n\nOriginal.\n';
      const v2Content = '## V2 Content\n\nNew stuff.\n';

      await injectClaudeMdSection(claudeMdPath, 'test-plugin', '1.0.0', v1Content);
      await injectClaudeMdSection(claudeMdPath, 'test-plugin', '2.0.0', v2Content);

      const fileContent = await readFile(claudeMdPath, 'utf-8');

      // Should have v2 marker, not v1
      expect(fileContent).toContain('<!-- BEGIN magus:test-plugin v2.0.0 -->');
      expect(fileContent).not.toContain('<!-- BEGIN magus:test-plugin v1.0.0 -->');

      // Should have v2 content, not v1
      expect(fileContent).toContain('V2 Content');
      expect(fileContent).toContain('New stuff.');
      expect(fileContent).not.toContain('V1 Content');
      expect(fileContent).not.toContain('Original.');
    });
  });

  // =========================================================================
  // Category 4: Multiple Plugins
  // =========================================================================

  describe('Multiple Plugins', () => {
    it('TEST-9: two plugins can coexist in CLAUDE.md', async () => {
      const claudeMdPath = join(projectDir, 'CLAUDE.md');

      const contentA = '## Plugin A Conventions\n\nPlugin A content.\n';
      const contentB = '## Plugin B Conventions\n\nPlugin B content.\n';

      await injectClaudeMdSection(claudeMdPath, 'plugin-a', '1.0.0', contentA);
      await injectClaudeMdSection(claudeMdPath, 'plugin-b', '1.0.0', contentB);

      const fileContent = await readFile(claudeMdPath, 'utf-8');

      // Both sections present
      expect(fileContent).toContain('<!-- BEGIN magus:plugin-a v1.0.0 -->');
      expect(fileContent).toContain('<!-- END magus:plugin-a -->');
      expect(fileContent).toContain('Plugin A content.');

      expect(fileContent).toContain('<!-- BEGIN magus:plugin-b v1.0.0 -->');
      expect(fileContent).toContain('<!-- END magus:plugin-b -->');
      expect(fileContent).toContain('Plugin B content.');

      // List should show both
      const sections = await listClaudeMdSections(claudeMdPath);
      expect(sections.length).toBe(2);
      const sectionNames = sections.map((s) => s.section);
      expect(sectionNames).toContain('plugin-a');
      expect(sectionNames).toContain('plugin-b');
    });

    it('TEST-10: removing one plugin leaves the other intact', async () => {
      const claudeMdPath = join(projectDir, 'CLAUDE.md');

      const contentA = '## Plugin A Conventions\n\nPlugin A content.\n';
      const contentB = '## Plugin B Conventions\n\nPlugin B content.\n';

      await injectClaudeMdSection(claudeMdPath, 'plugin-a', '1.0.0', contentA);
      await injectClaudeMdSection(claudeMdPath, 'plugin-b', '1.0.0', contentB);

      // Remove plugin-a
      const removeResult = await removeClaudeMdSection(claudeMdPath, 'plugin-a');
      expect(removeResult.removed).toBe(true);

      const fileContent = await readFile(claudeMdPath, 'utf-8');

      // Plugin A should be gone
      expect(fileContent).not.toContain('<!-- BEGIN magus:plugin-a');
      expect(fileContent).not.toContain('Plugin A content.');

      // Plugin B should still be there
      expect(fileContent).toContain('<!-- BEGIN magus:plugin-b v1.0.0 -->');
      expect(fileContent).toContain('<!-- END magus:plugin-b -->');
      expect(fileContent).toContain('Plugin B content.');
    });

    it('TEST-11: two plugins with different gitignore entries both present', async () => {
      const gitignorePath = join(projectDir, '.gitignore');

      await ensureGitignoreEntries(gitignorePath, ['.mnemex/'], '# Plugin A');
      await ensureGitignoreEntries(gitignorePath, ['.claudemem/'], '# Plugin B');

      const content = await readFile(gitignorePath, 'utf-8');
      expect(content).toContain('.mnemex/');
      expect(content).toContain('.claudemem/');

      // No duplicates -- adding same entries again should not duplicate
      await ensureGitignoreEntries(gitignorePath, ['.mnemex/']);
      const contentAfter = await readFile(gitignorePath, 'utf-8');
      const mnemexOccurrences = contentAfter.split('.mnemex/').length - 1;
      expect(mnemexOccurrences).toBe(1);
    });
  });

  // =========================================================================
  // Category 5: Doctor Detection
  // =========================================================================

  describe('Doctor Detection', () => {
    // Note: checkGitignoreEntries returns { present: string[], missing: string[] }
    // instead of string[] as documented in the architecture. This is an
    // IMPLEMENTATION_ISSUE (API deviation), but the richer return type is a
    // superset. Tests use .missing property to access the missing entries.

    it('TEST-12: checkGitignoreEntries detects missing entries', async () => {
      const gitignorePath = join(projectDir, '.gitignore');
      // Create gitignore with only one entry
      await writeFile(gitignorePath, '.mnemex/\n', 'utf-8');

      const result = await checkGitignoreEntries(gitignorePath, [
        '.mnemex/',
        '.claudemem/',
        '.claude/sessions/',
      ]);

      // API returns { present, missing } object instead of string[] per contract
      const resultObj = result as unknown as { present: string[]; missing: string[] };

      expect(resultObj.missing).toContain('.claudemem/');
      expect(resultObj.missing).toContain('.claude/sessions/');
      expect(resultObj.missing).not.toContain('.mnemex/');
      expect(resultObj.missing.length).toBe(2);

      // Also verify present entries
      expect(resultObj.present).toContain('.mnemex/');
      expect(resultObj.present.length).toBe(1);
    });

    it('TEST-13: missing CLAUDE.md section is detectable via listClaudeMdSections', async () => {
      const claudeMdPath = join(projectDir, 'CLAUDE.md');
      // Create CLAUDE.md with existing content but no managed sections
      await writeFile(claudeMdPath, '# Project CLAUDE.md\n\nSome existing content.\n', 'utf-8');

      const sections = await listClaudeMdSections(claudeMdPath);
      expect(sections.length).toBe(0);
    });

    it('TEST-14: ensureGitignoreEntries fixes missing entries detected by check', async () => {
      const gitignorePath = join(projectDir, '.gitignore');
      await writeFile(gitignorePath, '.mnemex/\n', 'utf-8');

      // Detect missing using the actual return type
      const checkResult = await checkGitignoreEntries(gitignorePath, [
        '.mnemex/',
        '.claudemem/',
        '.claude/sessions/',
      ]);
      const missing = (checkResult as unknown as { missing: string[] }).missing;
      expect(missing.length).toBe(2);

      // Fix by adding missing entries
      const fixResult = await ensureGitignoreEntries(gitignorePath, missing);
      expect(fixResult.modified).toBe(true);
      expect(fixResult.added.length).toBe(2);

      // Re-check: should now all be present
      const recheck = await checkGitignoreEntries(gitignorePath, [
        '.mnemex/',
        '.claudemem/',
        '.claude/sessions/',
      ]);
      const stillMissing = (recheck as unknown as { missing: string[] }).missing;
      expect(stillMissing.length).toBe(0);
    });
  });

  // =========================================================================
  // Category 6: Malformed CLAUDE.md Handling
  // =========================================================================

  describe('Malformed CLAUDE.md Handling', () => {
    it('TEST-15: inject refuses when CLAUDE.md has missing END marker', async () => {
      const claudeMdPath = join(projectDir, 'CLAUDE.md');
      // Write a malformed file: BEGIN without END
      const malformedContent = [
        '# Project Notes',
        '',
        '<!-- BEGIN magus:broken-plugin v1.0.0 -->',
        '## Broken Plugin',
        '',
        'This section has no END marker.',
        '',
        '# More content below',
        '',
      ].join('\n');
      await writeFile(claudeMdPath, malformedContent, 'utf-8');

      // Attempting to inject a NEW section should be refused
      const result = await injectClaudeMdSection(
        claudeMdPath,
        'new-plugin',
        '1.0.0',
        '## New Plugin\n\nContent.\n',
      );
      expect(result.action).toBe('error');
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
    });

    it('TEST-16: parse detects duplicate sections', async () => {
      const claudeMdPath = join(projectDir, 'CLAUDE.md');
      const duplicateContent = [
        '# Project',
        '',
        '<!-- BEGIN magus:test-plugin v1.0.0 -->',
        '## First instance',
        '<!-- END magus:test-plugin -->',
        '',
        '<!-- BEGIN magus:test-plugin v1.0.0 -->',
        '## Second instance (duplicate!)',
        '<!-- END magus:test-plugin -->',
        '',
      ].join('\n');
      await writeFile(claudeMdPath, duplicateContent, 'utf-8');

      const parseResult: ParseResult = await parseClaudeMdSections(claudeMdPath);
      expect(parseResult.errors.length).toBeGreaterThan(0);

      const duplicateError = parseResult.errors.find(
        (e) => e.type === 'duplicate_section',
      );
      expect(duplicateError).toBeDefined();
      if (duplicateError) {
        expect(duplicateError.section).toBe('test-plugin');
      }
    });

    it('TEST-17: parse ignores markers inside code blocks', async () => {
      const claudeMdPath = join(projectDir, 'CLAUDE.md');
      const contentWithCodeBlock = [
        '# Documentation',
        '',
        'Here is an example of markers:',
        '',
        '```markdown',
        '<!-- BEGIN magus:example v1.0.0 -->',
        '## Example section',
        '<!-- END magus:example -->',
        '```',
        '',
        'The above markers are inside a code block and should be ignored.',
        '',
      ].join('\n');
      await writeFile(claudeMdPath, contentWithCodeBlock, 'utf-8');

      const parseResult = await parseClaudeMdSections(claudeMdPath);

      // Markers inside code blocks should NOT be treated as real sections
      const realSections = parseResult.sections.filter(
        (s) => !s.insideCodeBlock,
      );
      expect(realSections.length).toBe(0);

      // If the parser reports code-block markers, check the error type
      if (parseResult.errors.length > 0) {
        const codeBlockErrors = parseResult.errors.filter(
          (e) => e.type === 'marker_in_code_block',
        );
        // It's valid for the parser to either:
        // 1. Report marker_in_code_block errors, OR
        // 2. Simply ignore them (no sections, no errors)
        // Both behaviors comply with the architecture spec.
        if (codeBlockErrors.length > 0) {
          expect(codeBlockErrors[0].section).toBe('example');
        }
      }
    });
  });

  // =========================================================================
  // Category 7: Path Classification (Gitignore Entries)
  // =========================================================================

  describe('Path Classification', () => {
    it('TEST-18: all standard private paths can be added to gitignore', async () => {
      const gitignorePath = join(projectDir, '.gitignore');
      const privatePaths = [
        '.mnemex/',
        '.claudemem/',
        '.claude/sessions/',
        '.claude/worktrees/',
      ];

      const result = await ensureGitignoreEntries(
        gitignorePath,
        privatePaths,
        '# Claude Code ephemeral/machine-specific data',
      );

      expect(result.modified).toBe(true);
      expect(result.added.length).toBe(4);

      const content = await readFile(gitignorePath, 'utf-8');
      for (const path of privatePaths) {
        expect(content).toContain(path);
      }
    });

    it('TEST-19: checkGitignoreEntries reports correct missing set', async () => {
      const gitignorePath = join(projectDir, '.gitignore');
      // Only .mnemex/ exists
      await writeFile(gitignorePath, '.mnemex/\n', 'utf-8');

      const allPaths = [
        '.mnemex/',
        '.claudemem/',
        '.claude/sessions/',
        '.claude/worktrees/',
      ];

      const result = await checkGitignoreEntries(gitignorePath, allPaths);
      // API returns { present, missing } instead of string[] (see IMPLEMENTATION_ISSUE note)
      const resultObj = result as unknown as { present: string[]; missing: string[] };

      expect(resultObj.missing.length).toBe(3);
      expect(resultObj.missing).toContain('.claudemem/');
      expect(resultObj.missing).toContain('.claude/sessions/');
      expect(resultObj.missing).toContain('.claude/worktrees/');
      expect(resultObj.missing).not.toContain('.mnemex/');
    });

    it('TEST-20: gitignore entries survive plugin uninstall', async () => {
      const pluginDir = await createMockPlugin(tempDir, 'test-plugin', {
        gitignoreProject: ['.mnemex/', '.claude/sessions/'],
        claudemdSection: 'test-plugin',
        claudemdVersion: '1.0.0',
        templateContent: '## Test\n\nContent.\n',
      });

      // Apply conventions manually (since applyConventions has a bug)
      await applyConventionsManually(pluginDir, projectDir);

      const gitignorePath = join(projectDir, '.gitignore');
      const gitignoreBefore = await readFile(gitignorePath, 'utf-8');
      expect(gitignoreBefore).toContain('.mnemex/');
      expect(gitignoreBefore).toContain('.claude/sessions/');

      // Remove conventions via public API
      await removeConventions('test-plugin', projectDir);

      // Gitignore entries MUST still be there (by design)
      const gitignoreAfter = await readFile(gitignorePath, 'utf-8');
      expect(gitignoreAfter).toContain('.mnemex/');
      expect(gitignoreAfter).toContain('.claude/sessions/');
    });
  });

  // =========================================================================
  // IMPLEMENTATION_ISSUE: applyConventions() regression tests
  // These tests SHOULD pass when the bug in applyConventions() is fixed.
  // They currently fail because applyConventions() silently skips all work.
  // =========================================================================

  describe('applyConventions orchestration (IMPLEMENTATION_ISSUE)', () => {
    it('TEST-1-A: applyConventions should apply gitignore entries', async () => {
      const pluginDir = await createMockPlugin(tempDir, 'apply-test', {
        gitignoreProject: ['.mnemex/', '.claude/sessions/'],
        claudemdSection: 'apply-test',
        claudemdVersion: '1.0.0',
        templateContent: '## Test Plugin\n\nConventions.\n',
      });

      const result = await applyConventions(pluginDir, projectDir);
      expect(result.gitignore.modified).toBe(true);
      expect(result.gitignore.added).toContain('.mnemex/');
    });

    it('TEST-2-A: applyConventions should inject CLAUDE.md section', async () => {
      const pluginDir = await createMockPlugin(tempDir, 'apply-test', {
        claudemdSection: 'apply-test',
        claudemdVersion: '1.0.0',
        templateContent: '## Test Plugin\n\nConventions.\n',
      });

      const result = await applyConventions(pluginDir, projectDir);
      expect(result.claudemd.action).toBe('inserted');
    });

    it('TEST-3-A: removeConventions should remove CLAUDE.md section', async () => {
      // First create a CLAUDE.md with a section using the working low-level API
      const claudeMdPath = join(projectDir, 'CLAUDE.md');
      await injectClaudeMdSection(claudeMdPath, 'test-plugin', '1.0.0', '## Test\n\nContent.\n');

      // removeConventions should find and remove the section
      const result = await removeConventions('test-plugin', projectDir);
      expect(result.claudemd.removed).toBe(true);
    });
  });
});
