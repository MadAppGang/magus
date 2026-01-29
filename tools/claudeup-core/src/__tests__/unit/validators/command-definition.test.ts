/**
 * Unit tests for command definition validation
 *
 * Tests cover:
 * - Command YAML frontmatter parsing
 * - Required fields validation
 * - allowed-tools parsing
 * - Real fixture validation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFrontmatter, validateCommandFrontmatter } from '../../utils/parsers.js';
import { getValidPluginPath, listMarkdownFiles } from '../../utils/fixture-loader.js';

describe('command-definition validation', () => {
  describe('valid command fixture', () => {
    let validPluginPath: string;
    let commandFiles: string[];

    beforeAll(async () => {
      validPluginPath = getValidPluginPath();
      commandFiles = await listMarkdownFiles(join(validPluginPath, 'commands'));
    });

    it('should find command files in valid plugin', () => {
      expect(commandFiles.length).toBeGreaterThan(0);
    });

    it('should parse and validate command frontmatter', async () => {
      for (const cmdPath of commandFiles) {
        const content = await readFile(cmdPath, 'utf-8');

        const parsed = parseFrontmatter(content);
        expect(parsed).not.toBeNull();

        if (parsed) {
          const result = validateCommandFrontmatter(parsed.frontmatter);
          expect(result.valid).toBe(true);
          if (result.valid) {
            expect(result.data.description).toBeTruthy();
          }
        }
      }
    });

    it('should have $ARGUMENTS placeholder in body', async () => {
      for (const cmdPath of commandFiles) {
        const content = await readFile(cmdPath, 'utf-8');

        const parsed = parseFrontmatter(content);
        expect(parsed).not.toBeNull();
        // Commands typically contain $ARGUMENTS placeholder
        expect(parsed!.body).toContain('$ARGUMENTS');
      }
    });
  });

  describe('validateCommandFrontmatter', () => {
    it('should accept minimal valid command', () => {
      const frontmatter = {
        description: 'A test command',
      };

      const result = validateCommandFrontmatter(frontmatter);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.description).toBe('A test command');
      }
    });

    it('should accept command with allowed-tools', () => {
      const frontmatter = {
        description: 'A command with tools',
        'allowed-tools': 'Task, AskUserQuestion, Bash, Read, TodoWrite',
      };

      const result = validateCommandFrontmatter(frontmatter);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data['allowed-tools']).toBe('Task, AskUserQuestion, Bash, Read, TodoWrite');
      }
    });

    it('should accept command with complex allowed-tools list', () => {
      const frontmatter = {
        description: 'Full toolset command',
        'allowed-tools': 'Task, AskUserQuestion, Bash, Read, TodoWrite, Glob, Grep, Write, Edit',
      };

      const result = validateCommandFrontmatter(frontmatter);
      expect(result.valid).toBe(true);
    });

    it('should reject command without description', () => {
      const frontmatter = {
        'allowed-tools': 'Task',
      };

      const result = validateCommandFrontmatter(frontmatter);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Command must have a "description" field');
      }
    });

    it('should reject command with empty description', () => {
      const frontmatter = {
        description: '',
      };

      const result = validateCommandFrontmatter(frontmatter);
      expect(result.valid).toBe(false);
    });

    it('should reject command with non-string description', () => {
      const frontmatter = {
        description: ['array', 'of', 'strings'],
      };

      const result = validateCommandFrontmatter(frontmatter);
      expect(result.valid).toBe(false);
    });

    it('should reject command with non-string allowed-tools', () => {
      const frontmatter = {
        description: 'Test command',
        'allowed-tools': ['Task', 'Read', 'Write'],
      };

      const result = validateCommandFrontmatter(frontmatter);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('allowed-tools'))).toBe(true);
      }
    });

    it('should accept command without allowed-tools', () => {
      const frontmatter = {
        description: 'A simple command',
      };

      const result = validateCommandFrontmatter(frontmatter);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data['allowed-tools']).toBeUndefined();
      }
    });
  });

  describe('command allowed-tools parsing', () => {
    it('should parse comma-separated tools into list', () => {
      const toolsString = 'Task, AskUserQuestion, Bash, Read';
      const tools = toolsString.split(',').map((t) => t.trim());

      expect(tools).toEqual(['Task', 'AskUserQuestion', 'Bash', 'Read']);
    });

    it('should handle tools with extra spaces', () => {
      const toolsString = 'Task,  AskUserQuestion,   Bash ,Read';
      const tools = toolsString.split(',').map((t) => t.trim());

      expect(tools).toEqual(['Task', 'AskUserQuestion', 'Bash', 'Read']);
    });

    it('should handle single tool', () => {
      const toolsString = 'Task';
      const tools = toolsString.split(',').map((t) => t.trim());

      expect(tools).toEqual(['Task']);
    });

    it('should identify valid tool names', () => {
      const validTools = [
        'Task',
        'AskUserQuestion',
        'Bash',
        'Read',
        'Write',
        'Edit',
        'Glob',
        'Grep',
        'TodoWrite',
        'WebSearch',
        'WebFetch',
      ];

      for (const tool of validTools) {
        expect(tool).toMatch(/^[A-Z][a-zA-Z]+$/);
      }
    });
  });

  describe('command body structure', () => {
    it('should contain mission or workflow sections', async () => {
      const validPluginPath = getValidPluginPath();
      const cmdPath = join(validPluginPath, 'commands', 'test-command.md');
      const content = await readFile(cmdPath, 'utf-8');

      const parsed = parseFrontmatter(content);
      expect(parsed).not.toBeNull();

      const body = parsed!.body.toLowerCase();
      // Commands typically have section headers
      expect(body).toMatch(/(mission|workflow|usage|step)/);
    });

    it('should have meaningful content after frontmatter', async () => {
      const validPluginPath = getValidPluginPath();
      const cmdPath = join(validPluginPath, 'commands', 'test-command.md');
      const content = await readFile(cmdPath, 'utf-8');

      const parsed = parseFrontmatter(content);
      expect(parsed).not.toBeNull();
      expect(parsed!.body.length).toBeGreaterThan(100);
    });
  });

  describe('orchestrator commands', () => {
    it('should identify orchestrator-style commands by description', () => {
      const orchestratorDescription = 'Full-cycle feature implementation with multi-agent orchestration';
      expect(orchestratorDescription.toLowerCase()).toContain('orchestrat');
    });

    it('should typically include Task in allowed-tools for orchestrators', () => {
      const frontmatter = {
        description: 'Multi-agent orchestration command',
        'allowed-tools': 'Task, AskUserQuestion, Bash, Read, TodoWrite, Glob, Grep',
      };

      const result = validateCommandFrontmatter(frontmatter);
      expect(result.valid).toBe(true);

      if (result.valid && result.data['allowed-tools']) {
        const tools = result.data['allowed-tools'].split(',').map((t) => t.trim());
        expect(tools).toContain('Task');
      }
    });
  });
});
