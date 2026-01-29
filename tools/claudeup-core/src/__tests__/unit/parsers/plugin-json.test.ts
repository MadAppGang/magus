/**
 * Unit tests for plugin.json schema validation
 *
 * Tests cover:
 * - Required fields validation
 * - Version format validation
 * - Optional fields handling
 * - Array fields validation
 */

import { describe, it, expect } from 'vitest';
import { validatePluginManifest } from '../../utils/parsers.js';

describe('validatePluginManifest', () => {
  describe('valid manifests', () => {
    it('should accept minimal valid manifest', () => {
      const manifest = {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'A test plugin',
      };

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.name).toBe('test-plugin');
        expect(result.data.version).toBe('1.0.0');
        expect(result.data.description).toBe('A test plugin');
      }
    });

    it('should accept full manifest with all fields', () => {
      const manifest = {
        name: 'full-plugin',
        version: '2.1.0',
        description: 'A complete plugin',
        author: {
          name: 'Test Author',
          email: 'test@example.com',
          company: 'Test Co',
        },
        license: 'MIT',
        keywords: ['test', 'plugin'],
        category: 'development',
        agents: ['./agents/test.md'],
        commands: ['./commands/test.md'],
        skills: ['./skills/test'],
        hooks: './hooks/hooks.json',
        mcpServers: './mcp-servers/config.json',
      };

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.name).toBe('full-plugin');
        expect(result.data.author?.name).toBe('Test Author');
        expect(result.data.agents).toEqual(['./agents/test.md']);
      }
    });

    it('should accept various valid version formats', () => {
      const versions = ['1.0.0', '0.0.1', '10.20.30', '1.0.0-beta', '2.0.0-rc.1'];

      for (const version of versions) {
        const manifest = {
          name: 'test',
          version,
          description: 'test',
        };
        const result = validatePluginManifest(manifest);
        expect(result.valid).toBe(true);
      }
    });

    it('should accept author with only name', () => {
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

    it('should accept empty arrays for agents/commands/skills', () => {
      const manifest = {
        name: 'test',
        version: '1.0.0',
        description: 'test',
        agents: [],
        commands: [],
        skills: [],
      };

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(true);
    });
  });

  describe('missing required fields', () => {
    it('should reject manifest without name', () => {
      const manifest = {
        version: '1.0.0',
        description: 'test',
      };

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Plugin must have a "name" field');
      }
    });

    it('should reject manifest without version', () => {
      const manifest = {
        name: 'test',
        description: 'test',
      };

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Plugin must have a "version" field');
      }
    });

    it('should reject manifest without description', () => {
      const manifest = {
        name: 'test',
        version: '1.0.0',
      };

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Plugin must have a "description" field');
      }
    });

    it('should reject null input', () => {
      const result = validatePluginManifest(null);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Plugin manifest must be an object');
      }
    });

    it('should reject non-object input', () => {
      const result = validatePluginManifest('not an object');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Plugin manifest must be an object');
      }
    });

    it('should reject empty object', () => {
      const result = validatePluginManifest({});
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe('invalid field types', () => {
    it('should reject invalid version format', () => {
      const invalidVersions = ['v1.0.0', '1.0', '1', 'version', '1.0.0.0'];

      for (const version of invalidVersions) {
        const manifest = {
          name: 'test',
          version,
          description: 'test',
        };
        const result = validatePluginManifest(manifest);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.includes('semver'))).toBe(true);
        }
      }
    });

    it('should reject non-object author', () => {
      const manifest = {
        name: 'test',
        version: '1.0.0',
        description: 'test',
        author: 'Just a string',
      };

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Plugin "author" must be an object if provided');
      }
    });

    it('should reject author without name', () => {
      const manifest = {
        name: 'test',
        version: '1.0.0',
        description: 'test',
        author: {
          email: 'test@example.com',
        },
      };

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Plugin author must have a "name" field');
      }
    });

    it('should reject non-array keywords', () => {
      const manifest = {
        name: 'test',
        version: '1.0.0',
        description: 'test',
        keywords: 'not,an,array',
      };

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Plugin "keywords" must be an array if provided');
      }
    });

    it('should reject non-array agents', () => {
      const manifest = {
        name: 'test',
        version: '1.0.0',
        description: 'test',
        agents: './agents/test.md',
      };

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Plugin "agents" must be an array if provided');
      }
    });

    it('should reject non-array commands', () => {
      const manifest = {
        name: 'test',
        version: '1.0.0',
        description: 'test',
        commands: { file: './commands/test.md' },
      };

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Plugin "commands" must be an array if provided');
      }
    });

    it('should reject non-array skills', () => {
      const manifest = {
        name: 'test',
        version: '1.0.0',
        description: 'test',
        skills: 42,
      };

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Plugin "skills" must be an array if provided');
      }
    });
  });

  describe('edge cases', () => {
    it('should accept empty string name (but that should be caught by other validation)', () => {
      const manifest = {
        name: '',
        version: '1.0.0',
        description: 'test',
      };

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Plugin must have a "name" field');
      }
    });

    it('should accept manifest with extra unknown fields', () => {
      const manifest = {
        name: 'test',
        version: '1.0.0',
        description: 'test',
        unknownField: 'should be ignored',
        anotherField: 123,
      };

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(true);
    });

    it('should collect multiple errors', () => {
      const manifest = {
        name: '',
        version: 'invalid',
        description: '',
        author: 'wrong',
        keywords: 'wrong',
      };

      const result = validatePluginManifest(manifest);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThanOrEqual(4);
      }
    });
  });
});
