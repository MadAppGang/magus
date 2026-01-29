/**
 * Unit tests for full plugin manifest validation
 *
 * Tests cover:
 * - Complete plugin.json validation
 * - Component path validation
 * - Loading and validating real plugin fixtures
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validatePluginManifest } from '../../utils/parsers.js';
import { getValidPluginPath, getInvalidPluginPath, loadPluginJson } from '../../utils/fixture-loader.js';

describe('plugin-manifest validation', () => {
  describe('valid plugin fixture', () => {
    let validPluginPath: string;

    beforeAll(() => {
      validPluginPath = getValidPluginPath();
    });

    it('should validate the complete valid plugin fixture', async () => {
      const manifest = await loadPluginJson(validPluginPath);

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.name).toBe('test-plugin');
        expect(result.data.version).toBe('1.0.0');
        expect(result.data.agents).toHaveLength(1);
        expect(result.data.commands).toHaveLength(1);
        expect(result.data.skills).toHaveLength(1);
      }
    });

    it('should have valid agent paths', async () => {
      const manifest = await loadPluginJson(validPluginPath);

      if (manifest.agents) {
        for (const agentPath of manifest.agents) {
          expect(agentPath).toMatch(/^\.\/agents\/.*\.md$/);
        }
      }
    });

    it('should have valid command paths', async () => {
      const manifest = await loadPluginJson(validPluginPath);

      if (manifest.commands) {
        for (const commandPath of manifest.commands) {
          expect(commandPath).toMatch(/^\.\/commands\/.*\.md$/);
        }
      }
    });

    it('should have valid skill paths', async () => {
      const manifest = await loadPluginJson(validPluginPath);

      if (manifest.skills) {
        for (const skillPath of manifest.skills) {
          expect(skillPath).toMatch(/^\.\/skills\//);
        }
      }
    });

    it('should have valid hooks path if present', async () => {
      const manifest = await loadPluginJson(validPluginPath);

      if (manifest.hooks) {
        expect(typeof manifest.hooks).toBe('string');
        expect(manifest.hooks).toMatch(/\.json$/);
      }
    });

    it('should have valid mcpServers path if present', async () => {
      const manifest = await loadPluginJson(validPluginPath);

      if (manifest.mcpServers) {
        expect(typeof manifest.mcpServers).toBe('string');
        expect(manifest.mcpServers).toMatch(/\.json$/);
      }
    });
  });

  describe('missing-version plugin fixture', () => {
    it('should fail validation for plugin without version', async () => {
      const pluginPath = getInvalidPluginPath('missing-version');
      const content = await readFile(join(pluginPath, 'plugin.json'), 'utf-8');
      const manifest = JSON.parse(content);

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('version'))).toBe(true);
      }
    });
  });

  describe('invalid-agents plugin fixture', () => {
    it('should validate plugin.json even with invalid agent files', async () => {
      // The plugin.json itself is valid - the agents are invalid
      const pluginPath = getInvalidPluginPath('invalid-agents');
      const manifest = await loadPluginJson(pluginPath);

      const result = validatePluginManifest(manifest);
      // The manifest itself is valid - agent content validation is separate
      expect(result.valid).toBe(true);
    });

    it('should have agents array in manifest', async () => {
      const pluginPath = getInvalidPluginPath('invalid-agents');
      const manifest = await loadPluginJson(pluginPath);

      expect(manifest.agents).toBeDefined();
      expect(Array.isArray(manifest.agents)).toBe(true);
      expect(manifest.agents!.length).toBe(2);
    });
  });

  describe('component path validation patterns', () => {
    it('should accept relative paths starting with ./', () => {
      const validPaths = [
        './agents/test.md',
        './commands/cmd.md',
        './skills/skill-name',
        './hooks/hooks.json',
        './mcp-servers/config.json',
      ];

      for (const path of validPaths) {
        expect(path.startsWith('./')).toBe(true);
      }
    });

    it('should identify agent paths by pattern', () => {
      const agentPattern = /^\.\/agents\/[\w-]+\.md$/;

      expect(agentPattern.test('./agents/test.md')).toBe(true);
      expect(agentPattern.test('./agents/my-agent.md')).toBe(true);
      expect(agentPattern.test('./commands/test.md')).toBe(false);
      expect(agentPattern.test('agents/test.md')).toBe(false);
    });

    it('should identify command paths by pattern', () => {
      const commandPattern = /^\.\/commands\/[\w-]+\.md$/;

      expect(commandPattern.test('./commands/test.md')).toBe(true);
      expect(commandPattern.test('./commands/my-command.md')).toBe(true);
      expect(commandPattern.test('./agents/test.md')).toBe(false);
    });

    it('should identify skill paths by pattern', () => {
      const skillPattern = /^\.\/skills\/[\w-]+$/;

      expect(skillPattern.test('./skills/test-skill')).toBe(true);
      expect(skillPattern.test('./skills/my_skill')).toBe(true);
      expect(skillPattern.test('./skills/test-skill/')).toBe(false);
      expect(skillPattern.test('./skills/test-skill/SKILL.md')).toBe(false);
    });
  });

  describe('author field validation', () => {
    it('should accept author with all fields', () => {
      const manifest = {
        name: 'test',
        version: '1.0.0',
        description: 'test',
        author: {
          name: 'Test Author',
          email: 'test@example.com',
          company: 'Test Company',
        },
      };

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.author?.name).toBe('Test Author');
        expect(result.data.author?.email).toBe('test@example.com');
        expect(result.data.author?.company).toBe('Test Company');
      }
    });

    it('should accept author with only required name', () => {
      const manifest = {
        name: 'test',
        version: '1.0.0',
        description: 'test',
        author: {
          name: 'Solo Author',
        },
      };

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(true);
    });
  });

  describe('keywords field validation', () => {
    it('should accept array of keyword strings', () => {
      const manifest = {
        name: 'test',
        version: '1.0.0',
        description: 'test',
        keywords: ['frontend', 'react', 'typescript'],
      };

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.keywords).toEqual(['frontend', 'react', 'typescript']);
      }
    });

    it('should accept empty keywords array', () => {
      const manifest = {
        name: 'test',
        version: '1.0.0',
        description: 'test',
        keywords: [],
      };

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(true);
    });
  });

  describe('category field validation', () => {
    it('should accept common category values', () => {
      const categories = ['development', 'workflow', 'content', 'media', 'testing'];

      for (const category of categories) {
        const manifest = {
          name: 'test',
          version: '1.0.0',
          description: 'test',
          category,
        };

        const result = validatePluginManifest(manifest);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.data.category).toBe(category);
        }
      }
    });
  });
});
