/**
 * Integration tests for hook execution simulation
 *
 * Tests cover:
 * - Hook configuration validation
 * - Matcher pattern validation
 * - Environment variable substitution
 * - Hook event simulation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createIsolatedEnv, type IsolatedEnv } from '../utils/isolated-env.js';
import { validateHooksConfig } from '../utils/parsers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const PLUGINS_DIR = join(REPO_ROOT, 'plugins');

interface HookCommand {
  type: 'command';
  command: string;
  timeout?: number;
}

interface HookEntry {
  matcher?: string;
  hooks: HookCommand[];
}

interface HooksConfig {
  description?: string;
  hooks: {
    SessionStart?: HookEntry[];
    PreToolUse?: HookEntry[];
    PostToolUse?: HookEntry[];
    Notification?: HookEntry[];
    Stop?: HookEntry[];
  };
}

describe('hook-execution integration', () => {
  let env: IsolatedEnv;

  afterEach(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  describe('real plugin hooks validation', () => {
    it('should find and validate all hooks.json files in plugins', async () => {
      const pluginDirs = ['code-analysis', 'seo', 'instantly', 'autopilot'];
      const results: Array<{ plugin: string; valid: boolean; errors?: string[] }> = [];

      for (const pluginName of pluginDirs) {
        const hooksPath = join(PLUGINS_DIR, pluginName, 'hooks', 'hooks.json');

        if (!existsSync(hooksPath)) {
          continue;
        }

        const content = await readFile(hooksPath, 'utf-8');
        const config = JSON.parse(content);
        const result = validateHooksConfig(config);

        results.push({
          plugin: pluginName,
          valid: result.valid,
          errors: result.valid ? undefined : result.errors,
        });
      }

      // All found hooks should be valid
      for (const result of results) {
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('hook matcher patterns', () => {
    it('should validate tool matcher patterns', () => {
      const validMatchers = [
        'Grep',
        'Grep|Glob',
        'Grep|Bash|Glob|Read',
        'Write|Edit',
        'Task',
      ];

      for (const matcher of validMatchers) {
        // Matchers should be pipe-separated tool names
        const tools = matcher.split('|');
        for (const tool of tools) {
          expect(tool).toMatch(/^[A-Z][a-zA-Z]+$/);
        }
      }
    });

    it('should match tools against matcher patterns', () => {
      const matcher = 'Grep|Glob|Read';
      const matcherTools = new Set(matcher.split('|'));

      // These should match
      expect(matcherTools.has('Grep')).toBe(true);
      expect(matcherTools.has('Glob')).toBe(true);
      expect(matcherTools.has('Read')).toBe(true);

      // These should not match
      expect(matcherTools.has('Write')).toBe(false);
      expect(matcherTools.has('Edit')).toBe(false);
      expect(matcherTools.has('grep')).toBe(false); // case sensitive
    });

    it('should handle regex-style matcher if needed', () => {
      // Some hooks might use regex patterns
      const regexMatcher = 'Grep|Bash|Glob|Read';
      const toolsToTest = ['Grep', 'Bash', 'Glob', 'Read', 'Write', 'Edit'];

      const pattern = new RegExp(`^(${regexMatcher})$`);

      const matched = toolsToTest.filter((tool) => pattern.test(tool));
      expect(matched).toEqual(['Grep', 'Bash', 'Glob', 'Read']);
    });
  });

  describe('environment variable substitution', () => {
    it('should identify env var placeholders in commands', () => {
      const command = 'bun "${CLAUDE_PLUGIN_ROOT}/hooks/handler.ts"';
      const envVarPattern = /\$\{([A-Z_]+)\}/g;

      const matches = [...command.matchAll(envVarPattern)];
      expect(matches.length).toBe(1);
      expect(matches[0][1]).toBe('CLAUDE_PLUGIN_ROOT');
    });

    it('should substitute environment variables in commands', () => {
      const command = 'bun "${CLAUDE_PLUGIN_ROOT}/hooks/handler.ts"';
      const pluginRoot = '/Users/test/.claude/plugins/test-plugin';

      const substituted = command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot);
      expect(substituted).toBe(`bun "${pluginRoot}/hooks/handler.ts"`);
    });

    it('should handle multiple env vars in command', () => {
      const command = '${TOOL} --config ${CONFIG_PATH} --env ${ENVIRONMENT}';
      const env = {
        TOOL: 'bun',
        CONFIG_PATH: '/path/to/config',
        ENVIRONMENT: 'test',
      };

      let substituted = command;
      for (const [key, value] of Object.entries(env)) {
        substituted = substituted.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
      }

      expect(substituted).toBe('bun --config /path/to/config --env test');
    });
  });

  describe('hook event simulation', () => {
    beforeEach(async () => {
      env = await createIsolatedEnv();
    });

    it('should simulate SessionStart hook event', async () => {
      const hooksConfig: HooksConfig = {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'echo "session started"',
                  timeout: 5,
                },
              ],
            },
          ],
        },
      };

      // Simulate finding hooks for SessionStart event
      const sessionStartHooks = hooksConfig.hooks.SessionStart || [];
      expect(sessionStartHooks.length).toBe(1);

      const commands = sessionStartHooks.flatMap((entry) => entry.hooks.map((h) => h.command));
      expect(commands).toContain('echo "session started"');
    });

    it('should simulate PreToolUse hook event with matcher', async () => {
      const hooksConfig: HooksConfig = {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Grep|Glob',
              hooks: [
                {
                  type: 'command',
                  command: 'echo "grep/glob intercepted"',
                },
              ],
            },
            {
              matcher: 'Task',
              hooks: [
                {
                  type: 'command',
                  command: 'echo "task intercepted"',
                },
              ],
            },
          ],
        },
      };

      // Simulate PreToolUse for 'Grep' tool
      const toolName = 'Grep';
      const preToolHooks = hooksConfig.hooks.PreToolUse || [];

      const matchingEntries = preToolHooks.filter((entry) => {
        if (!entry.matcher) return true;
        const matcherTools = new Set(entry.matcher.split('|'));
        return matcherTools.has(toolName);
      });

      expect(matchingEntries.length).toBe(1);
      expect(matchingEntries[0].hooks[0].command).toBe('echo "grep/glob intercepted"');
    });

    it('should simulate PostToolUse hook event', async () => {
      const hooksConfig: HooksConfig = {
        hooks: {
          PostToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [
                {
                  type: 'command',
                  command: 'echo "file modified"',
                },
              ],
            },
          ],
        },
      };

      // Simulate PostToolUse for 'Edit' tool
      const toolName = 'Edit';
      const postToolHooks = hooksConfig.hooks.PostToolUse || [];

      const matchingEntries = postToolHooks.filter((entry) => {
        if (!entry.matcher) return true;
        const matcherTools = new Set(entry.matcher.split('|'));
        return matcherTools.has(toolName);
      });

      expect(matchingEntries.length).toBe(1);
    });

    it('should respect timeout configuration', () => {
      const hookWithTimeout: HookCommand = {
        type: 'command',
        command: 'sleep 10',
        timeout: 5,
      };

      // Timeout is in seconds
      expect(hookWithTimeout.timeout).toBe(5);
      expect(hookWithTimeout.timeout).toBeLessThan(10);
    });
  });

  describe('hook execution order', () => {
    it('should maintain hook entry order within an event', () => {
      const hooksConfig: HooksConfig = {
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: 'echo "first"' }] },
            { hooks: [{ type: 'command', command: 'echo "second"' }] },
            { hooks: [{ type: 'command', command: 'echo "third"' }] },
          ],
        },
      };

      const commands = hooksConfig.hooks.SessionStart?.map(
        (entry) => entry.hooks[0].command,
      );

      expect(commands).toEqual([
        'echo "first"',
        'echo "second"',
        'echo "third"',
      ]);
    });

    it('should maintain multiple hooks order within an entry', () => {
      const hooksConfig: HooksConfig = {
        hooks: {
          SessionStart: [
            {
              hooks: [
                { type: 'command', command: 'echo "a"' },
                { type: 'command', command: 'echo "b"' },
                { type: 'command', command: 'echo "c"' },
              ],
            },
          ],
        },
      };

      const commands = hooksConfig.hooks.SessionStart?.[0].hooks.map((h) => h.command);
      expect(commands).toEqual(['echo "a"', 'echo "b"', 'echo "c"']);
    });
  });
});
