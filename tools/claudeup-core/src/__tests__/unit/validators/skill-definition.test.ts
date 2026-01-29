/**
 * Unit tests for SKILL.md validation
 *
 * Tests cover:
 * - Skill frontmatter parsing
 * - Required fields validation
 * - Optional fields handling
 * - Real fixture validation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFrontmatter, validateSkillFrontmatter } from '../../utils/parsers.js';
import { getValidPluginPath, getInvalidPluginPath, listSkillDirs } from '../../utils/fixture-loader.js';

describe('skill-definition validation', () => {
  describe('valid skill fixture', () => {
    let validPluginPath: string;
    let skillDirs: string[];

    beforeAll(async () => {
      validPluginPath = getValidPluginPath();
      skillDirs = await listSkillDirs(validPluginPath);
    });

    it('should find skill directories in valid plugin', () => {
      expect(skillDirs.length).toBeGreaterThan(0);
    });

    it('should parse and validate skill frontmatter', async () => {
      for (const skillDir of skillDirs) {
        const skillPath = join(skillDir, 'SKILL.md');
        const content = await readFile(skillPath, 'utf-8');

        const parsed = parseFrontmatter(content);
        expect(parsed).not.toBeNull();

        if (parsed) {
          const result = validateSkillFrontmatter(parsed.frontmatter);
          expect(result.valid).toBe(true);
          if (result.valid) {
            expect(result.data.name).toBeTruthy();
            expect(result.data.description).toBeTruthy();
          }
        }
      }
    });

    it('should have valid skill structure', async () => {
      for (const skillDir of skillDirs) {
        const skillPath = join(skillDir, 'SKILL.md');
        const content = await readFile(skillPath, 'utf-8');

        const parsed = parseFrontmatter(content);
        expect(parsed).not.toBeNull();
        expect(parsed!.body.length).toBeGreaterThan(0);
      }
    });
  });

  describe('validateSkillFrontmatter', () => {
    it('should accept minimal valid skill', () => {
      const frontmatter = {
        name: 'test-skill',
        description: 'A test skill',
      };

      const result = validateSkillFrontmatter(frontmatter);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.name).toBe('test-skill');
        expect(result.data.description).toBe('A test skill');
      }
    });

    it('should accept skill with allowed-tools', () => {
      const frontmatter = {
        name: 'tool-skill',
        description: 'A skill with tools',
        'allowed-tools': 'Task, Read, Glob',
      };

      const result = validateSkillFrontmatter(frontmatter);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data['allowed-tools']).toBe('Task, Read, Glob');
      }
    });

    it('should accept skill with prerequisites array', () => {
      const frontmatter = {
        name: 'prereq-skill',
        description: 'A skill with prerequisites',
        prerequisites: ['other-skill', 'base-skill'],
      };

      const result = validateSkillFrontmatter(frontmatter);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.prerequisites).toEqual(['other-skill', 'base-skill']);
      }
    });

    it('should accept skill with dependencies array', () => {
      const frontmatter = {
        name: 'dep-skill',
        description: 'A skill with dependencies',
        dependencies: ['external-tool must be installed', 'config must exist'],
      };

      const result = validateSkillFrontmatter(frontmatter);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.dependencies).toHaveLength(2);
      }
    });

    it('should accept skill with all optional fields', () => {
      const frontmatter = {
        name: 'full-skill',
        description: 'A complete skill',
        'allowed-tools': 'Task',
        prerequisites: ['skill-a'],
        dependencies: ['tool-x must be installed'],
      };

      const result = validateSkillFrontmatter(frontmatter);
      expect(result.valid).toBe(true);
    });

    it('should reject skill without name', () => {
      const frontmatter = {
        description: 'A skill without name',
      };

      const result = validateSkillFrontmatter(frontmatter);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Skill must have a "name" field');
      }
    });

    it('should reject skill without description', () => {
      const frontmatter = {
        name: 'nameless-desc',
      };

      const result = validateSkillFrontmatter(frontmatter);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Skill must have a "description" field');
      }
    });

    it('should reject skill with empty name', () => {
      const frontmatter = {
        name: '',
        description: 'Has empty name',
      };

      const result = validateSkillFrontmatter(frontmatter);
      expect(result.valid).toBe(false);
    });

    it('should reject skill with non-string allowed-tools', () => {
      const frontmatter = {
        name: 'bad-tools',
        description: 'Has wrong tools type',
        'allowed-tools': ['Task', 'Read'],
      };

      const result = validateSkillFrontmatter(frontmatter);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('allowed-tools'))).toBe(true);
      }
    });

    it('should reject skill with non-array prerequisites', () => {
      const frontmatter = {
        name: 'bad-prereq',
        description: 'Has wrong prereq type',
        prerequisites: 'other-skill',
      };

      const result = validateSkillFrontmatter(frontmatter);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('prerequisites'))).toBe(true);
      }
    });

    it('should reject skill with non-array dependencies', () => {
      const frontmatter = {
        name: 'bad-deps',
        description: 'Has wrong deps type',
        dependencies: 'tool-x',
      };

      const result = validateSkillFrontmatter(frontmatter);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('dependencies'))).toBe(true);
      }
    });

    it('should collect multiple errors', () => {
      const frontmatter = {
        name: '',
        description: '',
        'allowed-tools': ['wrong'],
        prerequisites: 'wrong',
      };

      const result = validateSkillFrontmatter(frontmatter);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe('bad-frontmatter skill fixture', () => {
    it('should handle malformed frontmatter gracefully', async () => {
      const pluginPath = getInvalidPluginPath('bad-frontmatter');
      const skillPath = join(pluginPath, 'skills', 'bad-skill', 'SKILL.md');

      const content = await readFile(skillPath, 'utf-8');
      const parsed = parseFrontmatter(content);

      // The parsing might succeed but validation should fail
      if (parsed) {
        const result = validateSkillFrontmatter(parsed.frontmatter);
        // The frontmatter has issues - either parsing or validation should catch them
        // In this case, prerequisites is not an array
        expect(result.valid).toBe(false);
      }
    });
  });

  describe('skill content structure', () => {
    it('should have body content with instructions', async () => {
      const validPluginPath = getValidPluginPath();
      const skillPath = join(validPluginPath, 'skills', 'test-skill', 'SKILL.md');
      const content = await readFile(skillPath, 'utf-8');

      const parsed = parseFrontmatter(content);
      expect(parsed).not.toBeNull();
      expect(parsed!.body).toContain('#');
      expect(parsed!.body.length).toBeGreaterThan(100);
    });
  });
});
