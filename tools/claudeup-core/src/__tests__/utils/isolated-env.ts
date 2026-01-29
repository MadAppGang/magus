/**
 * Isolated test environment utilities
 *
 * Creates temporary directories and mock environments for tests
 * that need to modify filesystem state without affecting other tests.
 */

import { mkdtemp, rm, mkdir, writeFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { getValidPluginPath, getInvalidPluginPath } from './fixture-loader.js';

/**
 * Isolated test environment that cleans up after itself
 */
export interface IsolatedEnv {
  /** Root directory for this test environment */
  rootDir: string;
  /** Path to a simulated .claude directory */
  claudeDir: string;
  /** Path to simulated marketplaces directory */
  marketplacesDir: string;
  /** Path to simulated plugins directory */
  pluginsDir: string;
  /** Helper to create a file in the environment */
  writeFile: (relativePath: string, content: string) => Promise<void>;
  /** Helper to create a JSON file */
  writeJson: (relativePath: string, data: unknown) => Promise<void>;
  /** Helper to copy a fixture into the environment */
  copyFixture: (fixturePath: string, targetPath?: string) => Promise<string>;
  /** Clean up the environment */
  cleanup: () => Promise<void>;
}

/**
 * Create an isolated test environment
 *
 * @example
 * ```ts
 * const env = await createIsolatedEnv();
 * try {
 *   await env.writeJson('.claude/settings.json', { enabledPlugins: {} });
 *   // Run tests
 * } finally {
 *   await env.cleanup();
 * }
 * ```
 */
export async function createIsolatedEnv(): Promise<IsolatedEnv> {
  const rootDir = await mkdtemp(join(tmpdir(), 'claudeup-test-'));
  const claudeDir = join(rootDir, '.claude');
  const marketplacesDir = join(claudeDir, 'plugins', 'marketplaces');
  const pluginsDir = join(rootDir, 'plugins');

  // Create base directories
  await mkdir(claudeDir, { recursive: true });
  await mkdir(marketplacesDir, { recursive: true });
  await mkdir(pluginsDir, { recursive: true });

  const env: IsolatedEnv = {
    rootDir,
    claudeDir,
    marketplacesDir,
    pluginsDir,

    async writeFile(relativePath: string, content: string): Promise<void> {
      const fullPath = join(rootDir, relativePath);
      const dir = join(fullPath, '..');
      await mkdir(dir, { recursive: true });
      await writeFile(fullPath, content, 'utf-8');
    },

    async writeJson(relativePath: string, data: unknown): Promise<void> {
      await env.writeFile(relativePath, JSON.stringify(data, null, 2));
    },

    async copyFixture(fixturePath: string, targetPath?: string): Promise<string> {
      const target = targetPath ? join(rootDir, targetPath) : join(pluginsDir, 'copied-fixture');
      await mkdir(target, { recursive: true });
      await cp(fixturePath, target, { recursive: true });
      return target;
    },

    async cleanup(): Promise<void> {
      if (existsSync(rootDir)) {
        await rm(rootDir, { recursive: true, force: true });
      }
    },
  };

  return env;
}

/**
 * Create an isolated environment with a valid plugin already set up
 */
export async function createEnvWithValidPlugin(): Promise<IsolatedEnv & { pluginPath: string }> {
  const env = await createIsolatedEnv();
  const validPluginSrc = getValidPluginPath();
  const pluginPath = await env.copyFixture(validPluginSrc, 'plugins/test-plugin');

  return {
    ...env,
    pluginPath,
  };
}

/**
 * Create an isolated environment with an invalid plugin
 */
export async function createEnvWithInvalidPlugin(
  type: 'missing-version' | 'invalid-agents' | 'bad-frontmatter',
): Promise<IsolatedEnv & { pluginPath: string }> {
  const env = await createIsolatedEnv();
  const invalidPluginSrc = getInvalidPluginPath(type);
  const pluginPath = await env.copyFixture(invalidPluginSrc, 'plugins/invalid-plugin');

  return {
    ...env,
    pluginPath,
  };
}

/**
 * Mock Claude settings for testing
 */
export interface MockClaudeSettings {
  enabledPlugins?: Record<string, boolean>;
  mcpServers?: Record<string, unknown>;
  installedPluginVersions?: Record<string, string>;
  extraKnownMarketplaces?: Record<string, { source: string; repo?: string; path?: string }>;
}

/**
 * Set up mock Claude settings in an isolated environment
 */
export async function setupMockSettings(
  env: IsolatedEnv,
  settings: MockClaudeSettings,
): Promise<void> {
  await env.writeJson('.claude/settings.json', settings);
}

/**
 * Set up mock marketplace data in an isolated environment
 */
export async function setupMockMarketplace(
  env: IsolatedEnv,
  marketplaceName: string,
  plugins: Array<{
    name: string;
    version: string;
    description?: string;
  }>,
): Promise<void> {
  const marketplaceDir = join(env.marketplacesDir, marketplaceName);
  await mkdir(marketplaceDir, { recursive: true });

  // Create marketplace.json
  await env.writeJson(join('.claude', 'plugins', 'marketplaces', marketplaceName, '.claude-plugin', 'marketplace.json'), {
    name: marketplaceName,
    plugins: plugins.map((p) => ({
      name: p.name,
      source: `./plugins/${p.name}`,
      version: p.version,
      description: p.description || 'Test plugin',
    })),
  });
}

/**
 * Run a test with an isolated environment, ensuring cleanup
 */
export async function withIsolatedEnv<T>(
  fn: (env: IsolatedEnv) => Promise<T>,
): Promise<T> {
  const env = await createIsolatedEnv();
  try {
    return await fn(env);
  } finally {
    await env.cleanup();
  }
}
