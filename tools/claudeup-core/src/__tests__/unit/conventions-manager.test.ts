/**
 * Unit tests for conventions-manager service
 *
 * Tests cover:
 * - ensureGitignoreEntries: adds missing, skips existing, creates file if absent
 * - removeGitignoreEntries: removes present, no-ops for absent
 * - checkGitignoreEntries: correctly identifies missing and present
 * - parseClaudeMdContent: well-formed, missing END, duplicates, code blocks
 * - injectClaudeMdSection: insert new, update stale, skip current, refuse on parse errors
 * - removeClaudeMdSection: removes existing, no-op for absent
 * - listClaudeMdSections: lists all managed sections
 * - resolvePluginConventions: reads conventions from plugin.json, returns null if absent
 * - applyConventions: end-to-end for both gitignore and CLAUDE.md
 * - removeConventions: end-to-end CLAUDE.md removal
 * - Idempotency: calling applyConventions twice yields identical result
 * - Malformed markers: duplicate sections, missing END, markers in code blocks
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensureGitignoreEntries,
  removeGitignoreEntries,
  checkGitignoreEntries,
  parseClaudeMdContent,
  parseClaudeMdSections,
  injectClaudeMdSection,
  removeClaudeMdSection,
  listClaudeMdSections,
  resolvePluginConventions,
  resolveGlobalGitignorePath,
  readConventionTemplate,
  applyConventions,
  removeConventions,
} from '../../services/conventions-manager.js';

describe('conventions-manager', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'conventions-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // ============================================================
  // ensureGitignoreEntries
  // ============================================================

  describe('ensureGitignoreEntries', () => {
    it('should add missing entries to existing .gitignore', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      await writeFile(gitignorePath, 'node_modules/\n.env\n');

      const result = await ensureGitignoreEntries(gitignorePath, ['.mnemex/', '.claudemem/']);

      expect(result.modified).toBe(true);
      expect(result.added).toEqual(['.mnemex/', '.claudemem/']);

      const content = await readFile(gitignorePath, 'utf-8');
      expect(content).toContain('.mnemex/');
      expect(content).toContain('.claudemem/');
      expect(content).toContain('node_modules/');
    });

    it('should skip entries that already exist', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      await writeFile(gitignorePath, 'node_modules/\n.mnemex/\n');

      const result = await ensureGitignoreEntries(gitignorePath, ['.mnemex/', '.claudemem/']);

      expect(result.modified).toBe(true);
      expect(result.added).toEqual(['.claudemem/']);
    });

    it('should return modified=false when all entries already exist', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      await writeFile(gitignorePath, 'node_modules/\n.mnemex/\n.claudemem/\n');

      const result = await ensureGitignoreEntries(gitignorePath, ['.mnemex/', '.claudemem/']);

      expect(result.modified).toBe(false);
      expect(result.added).toEqual([]);
    });

    it('should create file if absent', async () => {
      const gitignorePath = join(testDir, '.gitignore');

      const result = await ensureGitignoreEntries(gitignorePath, ['.mnemex/']);

      expect(result.modified).toBe(true);
      expect(result.added).toEqual(['.mnemex/']);

      const content = await readFile(gitignorePath, 'utf-8');
      expect(content).toContain('.mnemex/');
    });

    it('should add comment header when provided', async () => {
      const gitignorePath = join(testDir, '.gitignore');

      const result = await ensureGitignoreEntries(
        gitignorePath,
        ['.mnemex/'],
        '# Code Analysis plugin',
      );

      expect(result.modified).toBe(true);
      const content = await readFile(gitignorePath, 'utf-8');
      expect(content).toContain('# Code Analysis plugin');
      expect(content).toContain('.mnemex/');
    });

    it('should not duplicate comment if already present', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      await writeFile(gitignorePath, '# Code Analysis plugin\n.mnemex/\n');

      await ensureGitignoreEntries(
        gitignorePath,
        ['.claudemem/'],
        '# Code Analysis plugin',
      );

      const content = await readFile(gitignorePath, 'utf-8');
      const commentCount = (content.match(/# Code Analysis plugin/g) || []).length;
      expect(commentCount).toBe(1);
    });

    it('should handle empty entries array', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      await writeFile(gitignorePath, 'node_modules/\n');

      const result = await ensureGitignoreEntries(gitignorePath, []);

      expect(result.modified).toBe(false);
      expect(result.added).toEqual([]);
    });
  });

  // ============================================================
  // removeGitignoreEntries
  // ============================================================

  describe('removeGitignoreEntries', () => {
    it('should remove present entries', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      await writeFile(gitignorePath, 'node_modules/\n.mnemex/\n.claudemem/\n');

      const result = await removeGitignoreEntries(gitignorePath, ['.mnemex/']);

      expect(result.modified).toBe(true);
      expect(result.removed).toEqual(['.mnemex/']);

      const content = await readFile(gitignorePath, 'utf-8');
      expect(content).not.toContain('.mnemex/');
      expect(content).toContain('.claudemem/');
    });

    it('should no-op for entries not present', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      await writeFile(gitignorePath, 'node_modules/\n');

      const result = await removeGitignoreEntries(gitignorePath, ['.mnemex/']);

      expect(result.modified).toBe(false);
      expect(result.removed).toEqual([]);
    });

    it('should handle non-existent file', async () => {
      const gitignorePath = join(testDir, '.gitignore');

      const result = await removeGitignoreEntries(gitignorePath, ['.mnemex/']);

      expect(result.modified).toBe(false);
      expect(result.removed).toEqual([]);
    });
  });

  // ============================================================
  // checkGitignoreEntries
  // ============================================================

  describe('checkGitignoreEntries', () => {
    it('should identify present and missing entries', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      await writeFile(gitignorePath, 'node_modules/\n.mnemex/\n');

      const result = await checkGitignoreEntries(gitignorePath, ['.mnemex/', '.claudemem/']);

      expect(result.present).toEqual(['.mnemex/']);
      expect(result.missing).toEqual(['.claudemem/']);
    });

    it('should handle non-existent file (all missing)', async () => {
      const gitignorePath = join(testDir, '.gitignore');

      const result = await checkGitignoreEntries(gitignorePath, ['.mnemex/']);

      expect(result.present).toEqual([]);
      expect(result.missing).toEqual(['.mnemex/']);
    });

    it('should ignore comments and blank lines in gitignore', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      await writeFile(gitignorePath, '# comment\n\n.mnemex/\n');

      const result = await checkGitignoreEntries(gitignorePath, ['.mnemex/', '# comment']);

      expect(result.present).toEqual(['.mnemex/']);
      // Comments are not patterns
      expect(result.missing).toEqual(['# comment']);
    });
  });

  // ============================================================
  // parseClaudeMdContent (state machine parser)
  // ============================================================

  describe('parseClaudeMdContent', () => {
    it('should parse well-formed single section', () => {
      const content = [
        '# Project CLAUDE.md',
        '',
        '<!-- BEGIN magus:code-analysis v1.0.0 -->',
        '## Code Analysis Conventions',
        '',
        '> Managed by plugin',
        '<!-- END magus:code-analysis -->',
        '',
        'Other content',
      ].join('\n');

      const result = parseClaudeMdContent(content);

      expect(result.errors).toEqual([]);
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].section).toBe('code-analysis');
      expect(result.sections[0].version).toBe('1.0.0');
      expect(result.sections[0].content).toContain('Code Analysis Conventions');
      expect(result.sections[0].startLine).toBe(3);
      expect(result.sections[0].endLine).toBe(7);
    });

    it('should parse multiple sections', () => {
      const content = [
        '<!-- BEGIN magus:code-analysis v1.0.0 -->',
        'Section 1 content',
        '<!-- END magus:code-analysis -->',
        '',
        '<!-- BEGIN magus:terminal v2.0.0 -->',
        'Section 2 content',
        '<!-- END magus:terminal -->',
      ].join('\n');

      const result = parseClaudeMdContent(content);

      expect(result.errors).toEqual([]);
      expect(result.sections).toHaveLength(2);
      expect(result.sections[0].section).toBe('code-analysis');
      expect(result.sections[1].section).toBe('terminal');
    });

    it('should detect missing END marker', () => {
      const content = [
        '<!-- BEGIN magus:code-analysis v1.0.0 -->',
        'Some content without an end marker',
      ].join('\n');

      const result = parseClaudeMdContent(content);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('missing_end');
      expect(result.errors[0]).toHaveProperty('section', 'code-analysis');
    });

    it('should detect duplicate sections', () => {
      const content = [
        '<!-- BEGIN magus:code-analysis v1.0.0 -->',
        'First',
        '<!-- END magus:code-analysis -->',
        '',
        '<!-- BEGIN magus:code-analysis v1.0.0 -->',
        'Second',
        '<!-- END magus:code-analysis -->',
      ].join('\n');

      const result = parseClaudeMdContent(content);

      const dupError = result.errors.find((e) => e.type === 'duplicate_section');
      expect(dupError).toBeDefined();
      expect(dupError).toHaveProperty('section', 'code-analysis');
    });

    it('should ignore markers inside code blocks', () => {
      const content = [
        '# Example',
        '```markdown',
        '<!-- BEGIN magus:example v1.0.0 -->',
        'This is just an example',
        '<!-- END magus:example -->',
        '```',
        '',
        'Regular content',
      ].join('\n');

      const result = parseClaudeMdContent(content);

      // The markers inside code blocks should not be parsed as real sections
      const realSections = result.sections.filter((s) => !s.insideCodeBlock);
      expect(realSections).toHaveLength(0);

      // Should report marker_in_code_block error
      const codeBlockError = result.errors.find((e) => e.type === 'marker_in_code_block');
      expect(codeBlockError).toBeDefined();
    });

    it('should handle empty content', () => {
      const result = parseClaudeMdContent('');

      expect(result.sections).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('should handle content with no markers', () => {
      const content = '# Just a CLAUDE.md\n\nWith regular content\n';

      const result = parseClaudeMdContent(content);

      expect(result.sections).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('should detect missing END when a new BEGIN appears', () => {
      const content = [
        '<!-- BEGIN magus:first v1.0.0 -->',
        'First content',
        '<!-- BEGIN magus:second v1.0.0 -->',
        'Second content',
        '<!-- END magus:second -->',
      ].join('\n');

      const result = parseClaudeMdContent(content);

      const missingEnd = result.errors.find(
        (e) => e.type === 'missing_end' && e.section === 'first',
      );
      expect(missingEnd).toBeDefined();
    });

    it('should detect mismatched END markers', () => {
      const content = [
        '<!-- BEGIN magus:alpha v1.0.0 -->',
        'Alpha content',
        '<!-- END magus:beta -->',
        'More content',
      ].join('\n');

      const result = parseClaudeMdContent(content);

      const mismatchError = result.errors.find((e) => e.type === 'mismatched_end');
      expect(mismatchError).toBeDefined();
      expect(mismatchError).toHaveProperty('section', 'beta');
      expect(mismatchError).toHaveProperty('expected', 'alpha');

      // The section should remain unclosed (also produces missing_end)
      const missingEnd = result.errors.find((e) => e.type === 'missing_end');
      expect(missingEnd).toBeDefined();
      expect(missingEnd).toHaveProperty('section', 'alpha');
    });

    it('should handle mixed backtick/tilde fences correctly', () => {
      // A ~~~ block inside a ``` block should not close the ``` block
      const content = [
        '```',
        '<!-- BEGIN magus:inside-backtick v1.0.0 -->',
        '~~~',
        'still inside backtick code block',
        '~~~',
        '<!-- END magus:inside-backtick -->',
        '```',
        '',
        '<!-- BEGIN magus:real v1.0.0 -->',
        'Real content',
        '<!-- END magus:real -->',
      ].join('\n');

      const result = parseClaudeMdContent(content);

      // The markers inside the ``` block should be flagged as in code block
      const codeBlockErrors = result.errors.filter((e) => e.type === 'marker_in_code_block');
      expect(codeBlockErrors.length).toBeGreaterThanOrEqual(1);

      // The real section outside the code block should parse correctly
      const realSection = result.sections.find((s) => s.section === 'real');
      expect(realSection).toBeDefined();
      expect(realSection!.content).toBe('Real content');
    });

    it('should not close backtick fence with tilde fence', () => {
      // ``` opened, ~~~ should not close it
      const content = [
        '```',
        '~~~',
        '<!-- BEGIN magus:test v1.0.0 -->',
        'Content',
        '<!-- END magus:test -->',
        '~~~',
        '```',
      ].join('\n');

      const result = parseClaudeMdContent(content);

      // The markers are inside the ``` code block (~~~ doesn't close it)
      const codeBlockErrors = result.errors.filter((e) => e.type === 'marker_in_code_block');
      expect(codeBlockErrors.length).toBeGreaterThanOrEqual(1);

      // No real sections should be parsed
      const realSections = result.sections.filter((s) => !s.insideCodeBlock);
      expect(realSections).toHaveLength(0);
    });

    it('should parse version with prerelease tag', () => {
      const content = [
        '<!-- BEGIN magus:test-plugin v1.0.0-beta.1 -->',
        'Beta content',
        '<!-- END magus:test-plugin -->',
      ].join('\n');

      const result = parseClaudeMdContent(content);

      expect(result.errors).toEqual([]);
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].version).toBe('1.0.0-beta.1');
    });
  });

  // ============================================================
  // parseClaudeMdSections (file-reading wrapper)
  // ============================================================

  describe('parseClaudeMdSections', () => {
    it('should parse file from disk', async () => {
      const claudeMdPath = join(testDir, 'CLAUDE.md');
      const content = [
        '# Project',
        '',
        '<!-- BEGIN magus:code-analysis v1.0.0 -->',
        'Conventions here',
        '<!-- END magus:code-analysis -->',
      ].join('\n');
      await writeFile(claudeMdPath, content);

      const result = await parseClaudeMdSections(claudeMdPath);

      expect(result.sections).toHaveLength(1);
      expect(result.errors).toEqual([]);
    });

    it('should return empty result for non-existent file', async () => {
      const claudeMdPath = join(testDir, 'CLAUDE.md');

      const result = await parseClaudeMdSections(claudeMdPath);

      expect(result.sections).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  });

  // ============================================================
  // injectClaudeMdSection
  // ============================================================

  describe('injectClaudeMdSection', () => {
    it('should insert new section into empty file', async () => {
      const claudeMdPath = join(testDir, 'CLAUDE.md');

      const result = await injectClaudeMdSection(
        claudeMdPath,
        'code-analysis',
        '1.0.0',
        '## Code Analysis\n\nPrivate paths here',
      );

      expect(result.action).toBe('inserted');

      const content = await readFile(claudeMdPath, 'utf-8');
      expect(content).toContain('<!-- BEGIN magus:code-analysis v1.0.0 -->');
      expect(content).toContain('## Code Analysis');
      expect(content).toContain('<!-- END magus:code-analysis -->');
    });

    it('should insert new section into existing file', async () => {
      const claudeMdPath = join(testDir, 'CLAUDE.md');
      await writeFile(claudeMdPath, '# Project\n\nExisting content\n');

      const result = await injectClaudeMdSection(
        claudeMdPath,
        'code-analysis',
        '1.0.0',
        'New content',
      );

      expect(result.action).toBe('inserted');

      const content = await readFile(claudeMdPath, 'utf-8');
      expect(content).toContain('# Project');
      expect(content).toContain('Existing content');
      expect(content).toContain('<!-- BEGIN magus:code-analysis v1.0.0 -->');
    });

    it('should update section when version changes', async () => {
      const claudeMdPath = join(testDir, 'CLAUDE.md');
      const initial = [
        '# Project',
        '',
        '<!-- BEGIN magus:code-analysis v1.0.0 -->',
        'Old content',
        '<!-- END magus:code-analysis -->',
      ].join('\n');
      await writeFile(claudeMdPath, initial);

      const result = await injectClaudeMdSection(
        claudeMdPath,
        'code-analysis',
        '2.0.0',
        'New content',
      );

      expect(result.action).toBe('updated');
      expect(result.previousVersion).toBe('1.0.0');

      const content = await readFile(claudeMdPath, 'utf-8');
      expect(content).toContain('v2.0.0');
      expect(content).toContain('New content');
      expect(content).not.toContain('Old content');
      expect(content).not.toContain('v1.0.0');
    });

    it('should skip when version is unchanged', async () => {
      const claudeMdPath = join(testDir, 'CLAUDE.md');
      const initial = [
        '<!-- BEGIN magus:code-analysis v1.0.0 -->',
        'Current content',
        '<!-- END magus:code-analysis -->',
      ].join('\n');
      await writeFile(claudeMdPath, initial);

      const result = await injectClaudeMdSection(
        claudeMdPath,
        'code-analysis',
        '1.0.0',
        'Different content but same version',
      );

      expect(result.action).toBe('unchanged');

      // File should not be modified
      const content = await readFile(claudeMdPath, 'utf-8');
      expect(content).toContain('Current content');
    });

    it('should refuse when file has parse errors', async () => {
      const claudeMdPath = join(testDir, 'CLAUDE.md');
      const malformed = [
        '<!-- BEGIN magus:broken v1.0.0 -->',
        'Content without end marker',
      ].join('\n');
      await writeFile(claudeMdPath, malformed);

      const result = await injectClaudeMdSection(
        claudeMdPath,
        'code-analysis',
        '1.0.0',
        'New content',
      );

      expect(result.action).toBe('error');
      expect(result.error).toContain('malformed markers');
    });

    it('should refuse when file has duplicate sections', async () => {
      const claudeMdPath = join(testDir, 'CLAUDE.md');
      const duplicate = [
        '<!-- BEGIN magus:code-analysis v1.0.0 -->',
        'First',
        '<!-- END magus:code-analysis -->',
        '',
        '<!-- BEGIN magus:code-analysis v1.0.0 -->',
        'Second',
        '<!-- END magus:code-analysis -->',
      ].join('\n');
      await writeFile(claudeMdPath, duplicate);

      const result = await injectClaudeMdSection(
        claudeMdPath,
        'terminal',
        '1.0.0',
        'Terminal content',
      );

      expect(result.action).toBe('error');
      expect(result.error).toContain('duplicate');
    });
  });

  // ============================================================
  // removeClaudeMdSection
  // ============================================================

  describe('removeClaudeMdSection', () => {
    it('should remove existing section', async () => {
      const claudeMdPath = join(testDir, 'CLAUDE.md');
      const content = [
        '# Project',
        '',
        '<!-- BEGIN magus:code-analysis v1.0.0 -->',
        'Conventions here',
        '<!-- END magus:code-analysis -->',
        '',
        'Other content',
      ].join('\n');
      await writeFile(claudeMdPath, content);

      const result = await removeClaudeMdSection(claudeMdPath, 'code-analysis');

      expect(result.removed).toBe(true);

      const newContent = await readFile(claudeMdPath, 'utf-8');
      expect(newContent).not.toContain('BEGIN magus:code-analysis');
      expect(newContent).not.toContain('END magus:code-analysis');
      expect(newContent).toContain('# Project');
      expect(newContent).toContain('Other content');
    });

    it('should no-op for absent section', async () => {
      const claudeMdPath = join(testDir, 'CLAUDE.md');
      await writeFile(claudeMdPath, '# Project\n\nSome content\n');

      const result = await removeClaudeMdSection(claudeMdPath, 'code-analysis');

      expect(result.removed).toBe(false);
    });

    it('should no-op for non-existent file', async () => {
      const claudeMdPath = join(testDir, 'CLAUDE.md');

      const result = await removeClaudeMdSection(claudeMdPath, 'code-analysis');

      expect(result.removed).toBe(false);
    });

    it('should refuse mutation on malformed files', async () => {
      const claudeMdPath = join(testDir, 'CLAUDE.md');
      const malformed = [
        '<!-- BEGIN magus:broken v1.0.0 -->',
        'Content without end marker',
        '',
        '<!-- BEGIN magus:target v1.0.0 -->',
        'Target content',
        '<!-- END magus:target -->',
      ].join('\n');
      await writeFile(claudeMdPath, malformed);

      const result = await removeClaudeMdSection(claudeMdPath, 'target');

      expect(result.removed).toBe(false);
      expect(result.error).toContain('malformed markers');
    });

    it('should allow force removal on malformed files', async () => {
      const claudeMdPath = join(testDir, 'CLAUDE.md');
      const content = [
        '<!-- BEGIN magus:good v1.0.0 -->',
        'Good content',
        '<!-- END magus:good -->',
        '',
        '<!-- BEGIN magus:good v2.0.0 -->',
        'Duplicate',
        '<!-- END magus:good -->',
      ].join('\n');
      await writeFile(claudeMdPath, content);

      // Without force, should refuse
      const refuseResult = await removeClaudeMdSection(claudeMdPath, 'good');
      expect(refuseResult.removed).toBe(false);
      expect(refuseResult.error).toBeTruthy();

      // With force, should proceed
      const forceResult = await removeClaudeMdSection(claudeMdPath, 'good', { force: true });
      expect(forceResult.removed).toBe(true);
    });

    it('should preserve other sections when removing one', async () => {
      const claudeMdPath = join(testDir, 'CLAUDE.md');
      const content = [
        '<!-- BEGIN magus:code-analysis v1.0.0 -->',
        'First section',
        '<!-- END magus:code-analysis -->',
        '',
        '<!-- BEGIN magus:terminal v2.0.0 -->',
        'Second section',
        '<!-- END magus:terminal -->',
      ].join('\n');
      await writeFile(claudeMdPath, content);

      await removeClaudeMdSection(claudeMdPath, 'code-analysis');

      const newContent = await readFile(claudeMdPath, 'utf-8');
      expect(newContent).not.toContain('code-analysis');
      expect(newContent).toContain('<!-- BEGIN magus:terminal v2.0.0 -->');
      expect(newContent).toContain('Second section');
    });
  });

  // ============================================================
  // listClaudeMdSections
  // ============================================================

  describe('listClaudeMdSections', () => {
    it('should list all managed sections', async () => {
      const claudeMdPath = join(testDir, 'CLAUDE.md');
      const content = [
        '<!-- BEGIN magus:code-analysis v1.0.0 -->',
        'First',
        '<!-- END magus:code-analysis -->',
        '',
        '<!-- BEGIN magus:terminal v2.1.0 -->',
        'Second',
        '<!-- END magus:terminal -->',
      ].join('\n');
      await writeFile(claudeMdPath, content);

      const sections = await listClaudeMdSections(claudeMdPath);

      expect(sections).toHaveLength(2);
      expect(sections[0].section).toBe('code-analysis');
      expect(sections[0].version).toBe('1.0.0');
      expect(sections[1].section).toBe('terminal');
      expect(sections[1].version).toBe('2.1.0');
    });

    it('should return empty array for file without sections', async () => {
      const claudeMdPath = join(testDir, 'CLAUDE.md');
      await writeFile(claudeMdPath, '# Just a readme\n');

      const sections = await listClaudeMdSections(claudeMdPath);

      expect(sections).toEqual([]);
    });
  });

  // ============================================================
  // resolvePluginConventions
  // ============================================================

  describe('resolvePluginConventions', () => {
    it('should read conventions from plugin.json', async () => {
      const pluginDir = join(testDir, 'my-plugin');
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, 'plugin.json'),
        JSON.stringify({
          name: 'my-plugin',
          version: '1.0.0',
          conventions: {
            gitignore: { project: ['.mnemex/'] },
            claudemd: {
              section: 'my-plugin',
              template: './templates/claude-md-conventions.md',
              version: '1.0.0',
            },
          },
        }),
      );

      const result = await resolvePluginConventions(pluginDir);

      expect(result).not.toBeNull();
      expect(result!.gitignore!.project).toEqual(['.mnemex/']);
      expect(result!.claudemd!.section).toBe('my-plugin');
    });

    it('should return null when plugin has no conventions field', async () => {
      const pluginDir = join(testDir, 'simple-plugin');
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, 'plugin.json'),
        JSON.stringify({ name: 'simple-plugin', version: '1.0.0' }),
      );

      const result = await resolvePluginConventions(pluginDir);

      expect(result).toBeNull();
    });

    it('should return null when plugin.json does not exist', async () => {
      const pluginDir = join(testDir, 'missing-plugin');

      const result = await resolvePluginConventions(pluginDir);

      expect(result).toBeNull();
    });
  });

  // ============================================================
  // readConventionTemplate
  // ============================================================

  describe('readConventionTemplate', () => {
    it('should read a template within the plugin directory', async () => {
      const pluginDir = join(testDir, 'my-plugin');
      await mkdir(join(pluginDir, 'templates'), { recursive: true });
      await writeFile(join(pluginDir, 'templates', 'conventions.md'), 'Template content');

      const content = await readConventionTemplate(pluginDir, './templates/conventions.md');

      expect(content).toBe('Template content');
    });

    it('should reject path traversal attempts', async () => {
      const pluginDir = join(testDir, 'my-plugin');
      await mkdir(pluginDir, { recursive: true });

      await expect(
        readConventionTemplate(pluginDir, './../../etc/passwd'),
      ).rejects.toThrow('Template path escapes plugin directory');
    });

    it('should reject path traversal with ../ in the middle', async () => {
      const pluginDir = join(testDir, 'my-plugin');
      await mkdir(pluginDir, { recursive: true });

      await expect(
        readConventionTemplate(pluginDir, './templates/../../secret.txt'),
      ).rejects.toThrow('Template path escapes plugin directory');
    });
  });

  // ============================================================
  // resolveGlobalGitignorePath
  // ============================================================

  describe('resolveGlobalGitignorePath', () => {
    it('should return a path (from git config or fallback)', async () => {
      const result = await resolveGlobalGitignorePath();

      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });
  });

  // ============================================================
  // applyConventions (end-to-end)
  // ============================================================

  describe('applyConventions', () => {
    let pluginDir: string;
    let projectDir: string;

    beforeEach(async () => {
      pluginDir = join(testDir, 'plugin');
      projectDir = join(testDir, 'project');
      await mkdir(pluginDir, { recursive: true });
      await mkdir(join(pluginDir, 'templates'), { recursive: true });
      await mkdir(projectDir, { recursive: true });
    });

    it('should apply both gitignore and CLAUDE.md conventions', async () => {
      await writeFile(
        join(pluginDir, 'templates', 'conventions.md'),
        '## My Plugin\n\nConventions here',
      );
      await writeFile(
        join(pluginDir, 'plugin.json'),
        JSON.stringify({
          name: 'my-plugin',
          version: '1.0.0',
          conventions: {
            gitignore: { project: ['.mnemex/'] },
            claudemd: {
              section: 'my-plugin',
              template: './templates/conventions.md',
              version: '1.0.0',
            },
          },
        }),
      );

      const result = await applyConventions(pluginDir, projectDir);

      expect(result.gitignore.modified).toBe(true);
      expect(result.gitignore.added).toEqual(['.mnemex/']);
      expect(result.claudemd.action).toBe('inserted');
      expect(result.claudemd.section).toBe('my-plugin');

      // Verify files
      const gitignore = await readFile(join(projectDir, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('.mnemex/');

      const claudemd = await readFile(join(projectDir, 'CLAUDE.md'), 'utf-8');
      expect(claudemd).toContain('<!-- BEGIN magus:my-plugin v1.0.0 -->');
    });

    it('should no-op for null conventions', async () => {
      // Plugin with no conventions field
      await writeFile(
        join(pluginDir, 'plugin.json'),
        JSON.stringify({ name: 'my-plugin', version: '1.0.0' }),
      );

      const result = await applyConventions(pluginDir, projectDir);

      expect(result.gitignore.modified).toBe(false);
      expect(result.claudemd.action).toBe('skipped');
    });

    it('should handle gitignore-only conventions', async () => {
      await writeFile(
        join(pluginDir, 'plugin.json'),
        JSON.stringify({
          name: 'my-plugin',
          version: '1.0.0',
          conventions: {
            gitignore: { project: ['.mnemex/'] },
          },
        }),
      );

      const result = await applyConventions(pluginDir, projectDir);

      expect(result.gitignore.modified).toBe(true);
      expect(result.claudemd.action).toBe('skipped');
    });

    it('should handle claudemd-only conventions', async () => {
      await writeFile(join(pluginDir, 'templates', 'conventions.md'), 'Template content');
      await writeFile(
        join(pluginDir, 'plugin.json'),
        JSON.stringify({
          name: 'my-plugin',
          version: '1.0.0',
          conventions: {
            claudemd: {
              section: 'my-plugin',
              template: './templates/conventions.md',
              version: '1.0.0',
            },
          },
        }),
      );

      const result = await applyConventions(pluginDir, projectDir);

      expect(result.gitignore.modified).toBe(false);
      expect(result.claudemd.action).toBe('inserted');
    });
  });

  // ============================================================
  // removeConventions (end-to-end)
  // ============================================================

  describe('removeConventions', () => {
    it('should remove CLAUDE.md section on uninstall', async () => {
      const projectDir = join(testDir, 'project');
      await mkdir(projectDir, { recursive: true });

      const claudemd = [
        '# Project',
        '',
        '<!-- BEGIN magus:my-plugin v1.0.0 -->',
        'Plugin content',
        '<!-- END magus:my-plugin -->',
      ].join('\n');
      await writeFile(join(projectDir, 'CLAUDE.md'), claudemd);

      const result = await removeConventions('my-plugin', projectDir);

      expect(result.claudemd.removed).toBe(true);

      const content = await readFile(join(projectDir, 'CLAUDE.md'), 'utf-8');
      expect(content).not.toContain('my-plugin');
    });

    it('should no-op when section does not exist', async () => {
      const projectDir = join(testDir, 'project');
      await mkdir(projectDir, { recursive: true });
      await writeFile(join(projectDir, 'CLAUDE.md'), '# Project\n');

      const result = await removeConventions('nonexistent', projectDir);

      expect(result.claudemd.removed).toBe(false);
    });
  });

  // ============================================================
  // Idempotency
  // ============================================================

  describe('idempotency', () => {
    it('applyConventions twice should yield identical result', async () => {
      const pluginDir = join(testDir, 'plugin');
      const projectDir = join(testDir, 'project');
      await mkdir(pluginDir, { recursive: true });
      await mkdir(join(pluginDir, 'templates'), { recursive: true });
      await mkdir(projectDir, { recursive: true });

      await writeFile(join(pluginDir, 'templates', 'conventions.md'), 'Template content');
      await writeFile(
        join(pluginDir, 'plugin.json'),
        JSON.stringify({
          name: 'my-plugin',
          version: '1.0.0',
          conventions: {
            gitignore: { project: ['.mnemex/', '.claudemem/'] },
            claudemd: {
              section: 'my-plugin',
              template: './templates/conventions.md',
              version: '1.0.0',
            },
          },
        }),
      );

      // First apply
      await applyConventions(pluginDir, projectDir);
      const gitignoreAfterFirst = await readFile(join(projectDir, '.gitignore'), 'utf-8');
      const claudemdAfterFirst = await readFile(join(projectDir, 'CLAUDE.md'), 'utf-8');

      // Second apply
      const result2 = await applyConventions(pluginDir, projectDir);

      expect(result2.gitignore.modified).toBe(false);
      expect(result2.gitignore.added).toEqual([]);
      expect(result2.claudemd.action).toBe('unchanged');

      // File contents should be identical
      const gitignoreAfterSecond = await readFile(join(projectDir, '.gitignore'), 'utf-8');
      const claudemdAfterSecond = await readFile(join(projectDir, 'CLAUDE.md'), 'utf-8');

      expect(gitignoreAfterSecond).toBe(gitignoreAfterFirst);
      expect(claudemdAfterSecond).toBe(claudemdAfterFirst);
    });

    it('ensureGitignoreEntries twice should be idempotent', async () => {
      const gitignorePath = join(testDir, '.gitignore');

      await ensureGitignoreEntries(gitignorePath, ['.mnemex/', '.claudemem/']);
      const first = await readFile(gitignorePath, 'utf-8');

      const result2 = await ensureGitignoreEntries(gitignorePath, ['.mnemex/', '.claudemem/']);
      const second = await readFile(gitignorePath, 'utf-8');

      expect(result2.modified).toBe(false);
      expect(second).toBe(first);
    });
  });

  // ============================================================
  // Malformed markers
  // ============================================================

  describe('malformed markers', () => {
    it('should detect missing END marker at EOF', () => {
      const content = [
        '# Project',
        '<!-- BEGIN magus:test v1.0.0 -->',
        'Content goes on forever...',
      ].join('\n');

      const result = parseClaudeMdContent(content);

      expect(result.errors.some((e) => e.type === 'missing_end')).toBe(true);
    });

    it('should detect duplicate section names', () => {
      const content = [
        '<!-- BEGIN magus:test v1.0.0 -->',
        'First',
        '<!-- END magus:test -->',
        '<!-- BEGIN magus:test v2.0.0 -->',
        'Second',
        '<!-- END magus:test -->',
      ].join('\n');

      const result = parseClaudeMdContent(content);

      const dupErrors = result.errors.filter((e) => e.type === 'duplicate_section');
      expect(dupErrors).toHaveLength(1);
      expect(dupErrors[0]).toHaveProperty('section', 'test');
    });

    it('should detect markers inside triple-backtick code blocks', () => {
      const content = [
        '```',
        '<!-- BEGIN magus:example v1.0.0 -->',
        'code example',
        '<!-- END magus:example -->',
        '```',
      ].join('\n');

      const result = parseClaudeMdContent(content);

      const codeBlockErrors = result.errors.filter((e) => e.type === 'marker_in_code_block');
      expect(codeBlockErrors).toHaveLength(1);
    });

    it('should handle nested code fences correctly', () => {
      const content = [
        '````',
        '```',
        '<!-- BEGIN magus:nested v1.0.0 -->',
        'nested code',
        '<!-- END magus:nested -->',
        '```',
        '````',
      ].join('\n');

      // The outer ```` opens a code block with 4 backticks.
      // The inner ``` (3 backticks) is too short to close it per CommonMark.
      // So the markers are inside the code block.
      const result = parseClaudeMdContent(content);

      // Should at minimum not crash
      expect(result).toBeDefined();

      // The markers should be detected as inside a code block
      const codeBlockErrors = result.errors.filter((e) => e.type === 'marker_in_code_block');
      expect(codeBlockErrors.length).toBeGreaterThanOrEqual(1);
    });

    it('injectClaudeMdSection should refuse on malformed file', async () => {
      const claudeMdPath = join(testDir, 'CLAUDE.md');
      // Missing END marker
      await writeFile(claudeMdPath, '<!-- BEGIN magus:broken v1.0.0 -->\nContent');

      const result = await injectClaudeMdSection(
        claudeMdPath,
        'new-section',
        '1.0.0',
        'New content',
      );

      expect(result.action).toBe('error');
      expect(result.error).toBeTruthy();
    });

    it('injectClaudeMdSection should refuse when marker is inside code block', async () => {
      const claudeMdPath = join(testDir, 'CLAUDE.md');
      const content = [
        '```',
        '<!-- BEGIN magus:example v1.0.0 -->',
        'code',
        '<!-- END magus:example -->',
        '```',
      ].join('\n');
      await writeFile(claudeMdPath, content);

      const result = await injectClaudeMdSection(
        claudeMdPath,
        'new-section',
        '1.0.0',
        'New content',
      );

      expect(result.action).toBe('error');
    });
  });
});
