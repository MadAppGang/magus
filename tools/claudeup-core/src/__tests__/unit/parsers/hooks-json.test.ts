/**
 * Unit tests for hooks.json parsing and validation
 *
 * Tests cover:
 * - Valid hook configurations
 * - Hook event types validation
 * - Hook entry structure validation
 * - Error cases
 */

import { describe, it, expect } from 'vitest';
import { validateHooksConfig } from '../../utils/parsers.js';

describe('validateHooksConfig', () => {
  describe('valid hooks configurations', () => {
    it('should accept minimal valid hooks config', () => {
      const config = {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'echo "hello"',
                },
              ],
            },
          ],
        },
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should accept config with description', () => {
      const config = {
        description: 'Test hooks configuration',
        hooks: {
          SessionStart: [
            {
              hooks: [{ type: 'command', command: 'echo "start"' }],
            },
          ],
        },
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.description).toBe('Test hooks configuration');
      }
    });

    it('should accept all valid event types', () => {
      const config = {
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'echo 1' }] }],
          PreToolUse: [{ hooks: [{ type: 'command', command: 'echo 2' }] }],
          PostToolUse: [{ hooks: [{ type: 'command', command: 'echo 3' }] }],
          Notification: [{ hooks: [{ type: 'command', command: 'echo 4' }] }],
          Stop: [{ hooks: [{ type: 'command', command: 'echo 5' }] }],
        },
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should accept hooks with matcher', () => {
      const config = {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Grep|Glob',
              hooks: [{ type: 'command', command: 'echo "matched"' }],
            },
          ],
        },
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should accept hooks with timeout', () => {
      const config = {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'echo "hello"',
                  timeout: 30,
                },
              ],
            },
          ],
        },
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should accept multiple hooks per event', () => {
      const config = {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Grep',
              hooks: [{ type: 'command', command: 'echo "grep"' }],
            },
            {
              matcher: 'Glob',
              hooks: [{ type: 'command', command: 'echo "glob"' }],
            },
          ],
        },
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should accept multiple commands per hook entry', () => {
      const config = {
        hooks: {
          SessionStart: [
            {
              hooks: [
                { type: 'command', command: 'echo "first"' },
                { type: 'command', command: 'echo "second"', timeout: 5 },
              ],
            },
          ],
        },
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should accept empty hooks object', () => {
      const config = {
        hooks: {},
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should accept real-world hooks config', () => {
      const config = {
        description: 'Code analysis hooks',
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'bun "${CLAUDE_PLUGIN_ROOT}/hooks/handler.ts"',
                  timeout: 10,
                },
              ],
            },
          ],
          PreToolUse: [
            {
              matcher: 'Grep|Bash|Glob|Read',
              hooks: [
                {
                  type: 'command',
                  command: 'bun "${CLAUDE_PLUGIN_ROOT}/hooks/handler.ts"',
                  timeout: 15,
                },
              ],
            },
          ],
          PostToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [
                {
                  type: 'command',
                  command: 'bun "${CLAUDE_PLUGIN_ROOT}/hooks/handler.ts"',
                  timeout: 10,
                },
              ],
            },
          ],
        },
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid hooks configurations', () => {
    it('should reject null input', () => {
      const result = validateHooksConfig(null);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Hooks config must be an object');
      }
    });

    it('should reject non-object input', () => {
      const result = validateHooksConfig('not an object');
      expect(result.valid).toBe(false);
    });

    it('should reject config without hooks object', () => {
      const config = {
        description: 'Missing hooks',
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Hooks config must have a "hooks" object');
      }
    });

    it('should reject unknown event types', () => {
      const config = {
        hooks: {
          UnknownEvent: [{ hooks: [{ type: 'command', command: 'echo' }] }],
        },
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('Unknown hook event'))).toBe(true);
      }
    });

    it('should reject non-array event hooks', () => {
      const config = {
        hooks: {
          SessionStart: { hooks: [{ type: 'command', command: 'echo' }] },
        },
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Hook event "SessionStart" must be an array');
      }
    });

    it('should reject non-object hook entry', () => {
      const config = {
        hooks: {
          SessionStart: ['not an object'],
        },
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('must be an object'))).toBe(true);
      }
    });

    it('should reject hook entry without hooks array', () => {
      const config = {
        hooks: {
          SessionStart: [
            {
              matcher: 'Grep',
              // missing hooks array
            },
          ],
        },
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('must have a "hooks" array'))).toBe(true);
      }
    });

    it('should reject hook without type', () => {
      const config = {
        hooks: {
          SessionStart: [
            {
              hooks: [{ command: 'echo' }],
            },
          ],
        },
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('type "command"'))).toBe(true);
      }
    });

    it('should reject hook with wrong type', () => {
      const config = {
        hooks: {
          SessionStart: [
            {
              hooks: [{ type: 'script', command: 'echo' }],
            },
          ],
        },
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(false);
    });

    it('should reject hook without command', () => {
      const config = {
        hooks: {
          SessionStart: [
            {
              hooks: [{ type: 'command' }],
            },
          ],
        },
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('"command" string'))).toBe(true);
      }
    });

    it('should reject non-number timeout', () => {
      const config = {
        hooks: {
          SessionStart: [
            {
              hooks: [{ type: 'command', command: 'echo', timeout: '30' }],
            },
          ],
        },
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('timeout must be a number'))).toBe(true);
      }
    });

    it('should collect multiple errors', () => {
      const config = {
        hooks: {
          BadEvent: [{ hooks: [{ type: 'command', command: 'echo' }] }],
          SessionStart: [
            {
              hooks: [
                { type: 'wrong', command: 'echo' },
                { type: 'command' }, // missing command
              ],
            },
          ],
        },
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThanOrEqual(3);
      }
    });
  });
});
