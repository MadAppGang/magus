/**
 * Unit tests for MCP server configuration validation
 *
 * Tests cover:
 * - Command-based MCP servers
 * - URL-based MCP servers
 * - Environment variable configuration
 * - Error cases
 */

import { describe, it, expect } from 'vitest';
import { validateMcpConfig } from '../../utils/parsers.js';

describe('validateMcpConfig', () => {
  describe('valid MCP configurations', () => {
    it('should accept command-based MCP server', () => {
      const config = {
        'test-server': {
          command: 'npx',
          args: ['-y', '@test/mcp-server'],
        },
      };

      const result = validateMcpConfig(config);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data['test-server'].command).toBe('npx');
        expect(result.data['test-server'].args).toEqual(['-y', '@test/mcp-server']);
      }
    });

    it('should accept URL-based MCP server', () => {
      const config = {
        'http-server': {
          url: 'http://localhost:3000/mcp',
        },
      };

      const result = validateMcpConfig(config);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data['http-server'].url).toBe('http://localhost:3000/mcp');
      }
    });

    it('should accept server with environment variables', () => {
      const config = {
        'env-server': {
          command: 'npx',
          args: ['-y', '@test/mcp-server'],
          env: {
            API_KEY: '${API_KEY}',
            PROJECT_ID: '${PROJECT_ID}',
          },
        },
      };

      const result = validateMcpConfig(config);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data['env-server'].env?.API_KEY).toBe('${API_KEY}');
      }
    });

    it('should accept multiple MCP servers', () => {
      const config = {
        apidog: {
          command: 'npx',
          args: ['-y', '@apidog/mcp-server'],
          env: {
            APIDOG_PROJECT_ID: '${APIDOG_PROJECT_ID}',
            APIDOG_API_TOKEN: '${APIDOG_API_TOKEN}',
          },
        },
        figma: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-figma'],
          env: {
            FIGMA_ACCESS_TOKEN: '${FIGMA_ACCESS_TOKEN}',
          },
        },
        'chrome-devtools': {
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest'],
        },
      };

      const result = validateMcpConfig(config);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(Object.keys(result.data).length).toBe(3);
      }
    });

    it('should accept server with only command (no args)', () => {
      const config = {
        'simple-server': {
          command: '/usr/local/bin/mcp-server',
        },
      };

      const result = validateMcpConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should accept empty config', () => {
      const config = {};

      const result = validateMcpConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should accept server with both command and url (unusual but valid)', () => {
      const config = {
        'dual-server': {
          command: 'npx',
          args: ['-y', '@test/mcp-server'],
          url: 'http://fallback:3000',
        },
      };

      const result = validateMcpConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should accept server with empty env object', () => {
      const config = {
        'no-env-server': {
          command: 'npx',
          args: ['-y', '@test/mcp-server'],
          env: {},
        },
      };

      const result = validateMcpConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should accept server with empty args array', () => {
      const config = {
        'no-args-server': {
          command: 'mcp-server',
          args: [],
        },
      };

      const result = validateMcpConfig(config);
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid MCP configurations', () => {
    it('should reject null input', () => {
      const result = validateMcpConfig(null);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('MCP config must be an object');
      }
    });

    it('should reject non-object input', () => {
      const result = validateMcpConfig('not an object');
      expect(result.valid).toBe(false);
    });

    it('should reject array input', () => {
      const result = validateMcpConfig([{ command: 'test' }]);
      expect(result.valid).toBe(false);
    });

    it('should reject server without command or url', () => {
      const config = {
        'incomplete-server': {
          args: ['-y', '@test/mcp-server'],
        },
      };

      const result = validateMcpConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('command" or "url"'))).toBe(true);
      }
    });

    it('should reject non-string command', () => {
      const config = {
        'bad-command': {
          command: 123,
        },
      };

      const result = validateMcpConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('command must be a string'))).toBe(true);
      }
    });

    it('should reject non-string url', () => {
      const config = {
        'bad-url': {
          url: { host: 'localhost', port: 3000 },
        },
      };

      const result = validateMcpConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('url must be a string'))).toBe(true);
      }
    });

    it('should reject non-array args', () => {
      const config = {
        'bad-args': {
          command: 'npx',
          args: '-y @test/mcp-server',
        },
      };

      const result = validateMcpConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('args must be an array'))).toBe(true);
      }
    });

    it('should reject non-object env', () => {
      const config = {
        'bad-env': {
          command: 'npx',
          args: ['-y', '@test/mcp-server'],
          env: ['API_KEY=value'],
        },
      };

      const result = validateMcpConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('env must be an object'))).toBe(true);
      }
    });

    it('should reject non-string env value', () => {
      const config = {
        'bad-env-value': {
          command: 'npx',
          args: ['-y', '@test/mcp-server'],
          env: {
            API_KEY: 12345,
          },
        },
      };

      const result = validateMcpConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('env value for "API_KEY" must be a string'))).toBe(
          true,
        );
      }
    });

    it('should reject non-object server config', () => {
      const config = {
        'string-server': 'npx -y @test/mcp-server',
      };

      const result = validateMcpConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('must be an object'))).toBe(true);
      }
    });

    it('should reject null server config', () => {
      const config = {
        'null-server': null,
      };

      const result = validateMcpConfig(config);
      expect(result.valid).toBe(false);
    });

    it('should collect multiple errors', () => {
      const config = {
        'server-1': {
          // missing command and url
          args: ['test'],
        },
        'server-2': {
          command: 123, // wrong type
        },
        'server-3': {
          command: 'test',
          env: {
            KEY: 456, // wrong type
          },
        },
      };

      const result = validateMcpConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe('real-world configurations', () => {
    it('should validate frontend plugin mcp-config', () => {
      const config = {
        apidog: {
          command: 'npx',
          args: ['-y', '@apidog/mcp-server'],
          env: {
            APIDOG_PROJECT_ID: '${APIDOG_PROJECT_ID}',
            APIDOG_API_TOKEN: '${APIDOG_API_TOKEN}',
          },
        },
        figma: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-figma'],
          env: {
            FIGMA_ACCESS_TOKEN: '${FIGMA_ACCESS_TOKEN}',
          },
        },
        'chrome-devtools': {
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest'],
        },
      };

      const result = validateMcpConfig(config);
      expect(result.valid).toBe(true);
    });
  });
});
