/**
 * Unit tests for agent definition validation
 *
 * Tests cover:
 * - Agent frontmatter parsing
 * - Required fields validation
 * - PROXY_MODE pattern detection
 * - Real fixture validation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFrontmatter, validateAgentFrontmatter } from '../../utils/parsers.js';
import { getValidPluginPath, getInvalidPluginPath, listMarkdownFiles } from '../../utils/fixture-loader.js';

describe('agent-definition validation', () => {
  describe('valid agent fixture', () => {
    let validPluginPath: string;
    let agentFiles: string[];

    beforeAll(async () => {
      validPluginPath = getValidPluginPath();
      agentFiles = await listMarkdownFiles(join(validPluginPath, 'agents'));
    });

    it('should find agent files in valid plugin', () => {
      expect(agentFiles.length).toBeGreaterThan(0);
    });

    it('should parse and validate agent frontmatter', async () => {
      for (const agentPath of agentFiles) {
        const content = await readFile(agentPath, 'utf-8');

        const parsed = parseFrontmatter(content);
        expect(parsed).not.toBeNull();

        if (parsed) {
          const result = validateAgentFrontmatter(parsed.frontmatter);
          expect(result.valid).toBe(true);
          if (result.valid) {
            expect(result.data.name).toBeTruthy();
            expect(result.data.description).toBeTruthy();
          }
        }
      }
    });

    it('should have tools defined', async () => {
      for (const agentPath of agentFiles) {
        const content = await readFile(agentPath, 'utf-8');

        const parsed = parseFrontmatter(content);
        expect(parsed).not.toBeNull();

        if (parsed) {
          const result = validateAgentFrontmatter(parsed.frontmatter);
          expect(result.valid).toBe(true);
          if (result.valid && result.data.tools) {
            const tools = result.data.tools.split(',').map((t) => t.trim());
            expect(tools.length).toBeGreaterThan(0);
          }
        }
      }
    });
  });

  describe('validateAgentFrontmatter', () => {
    it('should accept minimal valid agent', () => {
      const frontmatter = {
        name: 'test-agent',
        description: 'A test agent for unit testing',
      };

      const result = validateAgentFrontmatter(frontmatter);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.name).toBe('test-agent');
        expect(result.data.description).toBe('A test agent for unit testing');
      }
    });

    it('should accept agent with color', () => {
      const frontmatter = {
        name: 'colored-agent',
        description: 'An agent with color',
        color: 'green',
      };

      const result = validateAgentFrontmatter(frontmatter);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.color).toBe('green');
      }
    });

    it('should accept agent with tools', () => {
      const frontmatter = {
        name: 'tooled-agent',
        description: 'An agent with tools',
        tools: 'TodoWrite, Write, Edit, Read, Bash, Glob, Grep',
      };

      const result = validateAgentFrontmatter(frontmatter);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.tools).toContain('TodoWrite');
        expect(result.data.tools).toContain('Write');
      }
    });

    it('should accept agent with model specification', () => {
      const frontmatter = {
        name: 'model-agent',
        description: 'An agent with specific model',
        model: 'sonnet',
      };

      const result = validateAgentFrontmatter(frontmatter);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.model).toBe('sonnet');
      }
    });

    it('should accept agent with all optional fields', () => {
      const frontmatter = {
        name: 'full-agent',
        description: 'A complete agent',
        color: 'blue',
        tools: 'Read, Write, Edit',
        model: 'opus',
      };

      const result = validateAgentFrontmatter(frontmatter);
      expect(result.valid).toBe(true);
    });

    it('should reject agent without name', () => {
      const frontmatter = {
        description: 'An agent without name',
        tools: 'Read',
      };

      const result = validateAgentFrontmatter(frontmatter);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Agent must have a "name" field');
      }
    });

    it('should reject agent without description', () => {
      const frontmatter = {
        name: 'nameless-desc',
        tools: 'Read',
      };

      const result = validateAgentFrontmatter(frontmatter);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Agent must have a "description" field');
      }
    });

    it('should reject agent with empty name', () => {
      const frontmatter = {
        name: '',
        description: 'Has empty name',
      };

      const result = validateAgentFrontmatter(frontmatter);
      expect(result.valid).toBe(false);
    });

    it('should reject agent with non-string color', () => {
      const frontmatter = {
        name: 'bad-color',
        description: 'Has wrong color type',
        color: 123,
      };

      const result = validateAgentFrontmatter(frontmatter);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('color'))).toBe(true);
      }
    });

    it('should reject agent with non-string tools', () => {
      const frontmatter = {
        name: 'bad-tools',
        description: 'Has wrong tools type',
        tools: ['Read', 'Write'],
      };

      const result = validateAgentFrontmatter(frontmatter);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('tools'))).toBe(true);
      }
    });

    it('should collect multiple errors', () => {
      const frontmatter = {
        name: '',
        description: '',
        color: 123,
        tools: ['wrong'],
      };

      const result = validateAgentFrontmatter(frontmatter);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe('invalid-agents fixture', () => {
    it('should fail for agent without frontmatter', async () => {
      const pluginPath = getInvalidPluginPath('invalid-agents');
      const agentPath = join(pluginPath, 'agents', 'broken-agent.md');
      const content = await readFile(agentPath, 'utf-8');

      const parsed = parseFrontmatter(content);
      expect(parsed).toBeNull();
    });

    it('should fail for agent missing name', async () => {
      const pluginPath = getInvalidPluginPath('invalid-agents');
      const agentPath = join(pluginPath, 'agents', 'missing-name-agent.md');
      const content = await readFile(agentPath, 'utf-8');

      const parsed = parseFrontmatter(content);
      expect(parsed).not.toBeNull();

      if (parsed) {
        const result = validateAgentFrontmatter(parsed.frontmatter);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.includes('name'))).toBe(true);
        }
      }
    });
  });

  describe('PROXY_MODE pattern', () => {
    it('should detect PROXY_MODE pattern in agent body', async () => {
      const validPluginPath = getValidPluginPath();
      const agentPath = join(validPluginPath, 'agents', 'test-agent.md');
      const content = await readFile(agentPath, 'utf-8');

      const parsed = parseFrontmatter(content);
      expect(parsed).not.toBeNull();

      // Check if body contains PROXY_MODE pattern
      const hasProxyMode = parsed!.body.includes('PROXY_MODE');
      expect(hasProxyMode).toBe(true);
    });

    it('should identify PROXY_MODE directive format', () => {
      const proxyModePattern = /PROXY_MODE:\s*\{?[\w-]+\}?/;

      expect(proxyModePattern.test('PROXY_MODE: {model_name}')).toBe(true);
      expect(proxyModePattern.test('PROXY_MODE: grok-code')).toBe(true);
      expect(proxyModePattern.test('Regular text')).toBe(false);
    });

    it('should identify PROXY_MODE section in markdown', () => {
      const agentBody = `
## CRITICAL: External Model Proxy Mode (Optional)

**FIRST STEP: Check for Proxy Mode Directive**

Before executing any work, check if the incoming prompt starts with:
\`\`\`
PROXY_MODE: {model_name}
\`\`\`

If you see this directive:
1. Extract the model name
2. Delegate to external AI
`;

      expect(agentBody).toContain('PROXY_MODE');
      expect(agentBody).toMatch(/PROXY_MODE:\s*\{model_name\}/);
    });
  });

  describe('agent tools parsing', () => {
    it('should parse comma-separated tools', () => {
      const toolsString = 'TodoWrite, Write, Edit, Read, Bash, Glob, Grep';
      const tools = toolsString.split(',').map((t) => t.trim());

      expect(tools).toEqual(['TodoWrite', 'Write', 'Edit', 'Read', 'Bash', 'Glob', 'Grep']);
    });

    it('should identify common agent tool sets', () => {
      // Developer agents typically have file manipulation tools
      const developerTools = 'TodoWrite, Write, Edit, Read, Bash, Glob, Grep';
      const tools = developerTools.split(',').map((t) => t.trim());

      expect(tools).toContain('Write');
      expect(tools).toContain('Edit');
      expect(tools).toContain('Read');
    });

    it('should identify orchestrator tool sets', () => {
      // Orchestrator agents typically use Task for delegation
      const orchestratorTools = 'Task, AskUserQuestion, Bash, Read, TodoWrite';
      const tools = orchestratorTools.split(',').map((t) => t.trim());

      expect(tools).toContain('Task');
      expect(tools).toContain('AskUserQuestion');
    });
  });

  describe('agent description patterns', () => {
    it('should contain usage examples in description', async () => {
      const validPluginPath = getValidPluginPath();
      const agentPath = join(validPluginPath, 'agents', 'test-agent.md');
      const content = await readFile(agentPath, 'utf-8');

      const parsed = parseFrontmatter(content);
      expect(parsed).not.toBeNull();

      if (parsed) {
        const description = parsed.frontmatter.description as string;
        // Good descriptions contain example scenarios
        expect(description.length).toBeGreaterThan(50);
      }
    });

    it('should identify developer agent by tools', () => {
      const frontmatter = {
        name: 'developer',
        description: 'TypeScript frontend developer',
        tools: 'TodoWrite, Write, Edit, Read, Bash, Glob, Grep',
      };

      const result = validateAgentFrontmatter(frontmatter);
      expect(result.valid).toBe(true);

      if (result.valid && result.data.tools) {
        const tools = result.data.tools.split(',').map((t) => t.trim());
        // Developer agents have Write and Edit
        expect(tools).toContain('Write');
        expect(tools).toContain('Edit');
        // But typically not Task (they don't delegate)
        expect(tools).not.toContain('Task');
      }
    });
  });
});
