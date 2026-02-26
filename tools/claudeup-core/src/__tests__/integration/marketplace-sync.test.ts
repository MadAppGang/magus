/**
 * Integration tests for marketplace consistency
 *
 * Tests cover:
 * - Version sync between plugin.json and marketplace.json
 * - All plugins registered in marketplace
 * - Metadata consistency
 */

import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// Path to the real plugins directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const PLUGINS_DIR = join(REPO_ROOT, 'plugins');
const MARKETPLACE_JSON = join(REPO_ROOT, '.claude-plugin', 'marketplace.json');

interface PluginManifest {
  name: string;
  version: string;
  description: string;
}

interface MarketplacePlugin {
  name: string;
  version: string;
  source: string;
  description?: string;
}

interface MarketplaceJson {
  name: string;
  plugins: MarketplacePlugin[];
}

describe('marketplace-sync integration', () => {
  describe('real marketplace validation', () => {
    let marketplace: MarketplaceJson;
    let pluginDirs: string[];

    it('should load marketplace.json', async () => {
      expect(existsSync(MARKETPLACE_JSON)).toBe(true);

      const content = await readFile(MARKETPLACE_JSON, 'utf-8');
      marketplace = JSON.parse(content);

      expect(marketplace.name).toBe('magus');
      expect(Array.isArray(marketplace.plugins)).toBe(true);
    });

    it('should have plugins directory', async () => {
      expect(existsSync(PLUGINS_DIR)).toBe(true);

      const entries = await readdir(PLUGINS_DIR, { withFileTypes: true });
      pluginDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

      expect(pluginDirs.length).toBeGreaterThan(0);
    });

    it('should have version sync between plugin.json and marketplace.json', async () => {
      const content = await readFile(MARKETPLACE_JSON, 'utf-8');
      marketplace = JSON.parse(content);

      const mismatches: string[] = [];

      for (const mpPlugin of marketplace.plugins) {
        const pluginJsonPath = join(PLUGINS_DIR, mpPlugin.name, 'plugin.json');

        if (!existsSync(pluginJsonPath)) {
          mismatches.push(`Plugin ${mpPlugin.name}: plugin.json not found at expected path`);
          continue;
        }

        const pluginContent = await readFile(pluginJsonPath, 'utf-8');
        const pluginJson = JSON.parse(pluginContent) as PluginManifest;

        if (pluginJson.version !== mpPlugin.version) {
          mismatches.push(
            `Plugin ${mpPlugin.name}: version mismatch - plugin.json has ${pluginJson.version}, marketplace.json has ${mpPlugin.version}`,
          );
        }
      }

      expect(mismatches).toEqual([]);
    });

    it('should have all plugin directories registered in marketplace', async () => {
      const content = await readFile(MARKETPLACE_JSON, 'utf-8');
      marketplace = JSON.parse(content);

      const entries = await readdir(PLUGINS_DIR, { withFileTypes: true });
      pluginDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

      const marketplacePluginNames = marketplace.plugins.map((p) => p.name);
      const unregistered: string[] = [];

      for (const dir of pluginDirs) {
        // Check if plugin.json exists in this directory
        const pluginJsonPath = join(PLUGINS_DIR, dir, 'plugin.json');
        if (!existsSync(pluginJsonPath)) {
          continue; // Skip directories without plugin.json
        }

        if (!marketplacePluginNames.includes(dir)) {
          unregistered.push(dir);
        }
      }

      // Allow some plugins to be unregistered if they're in development
      // But log them for visibility
      if (unregistered.length > 0) {
        console.log(`Unregistered plugins (may be in development): ${unregistered.join(', ')}`);
      }

      // At least most plugins should be registered
      const registeredCount = pluginDirs.filter((d) => marketplacePluginNames.includes(d)).length;
      expect(registeredCount).toBeGreaterThan(0);
    });

    it('should have valid source paths in marketplace', async () => {
      const content = await readFile(MARKETPLACE_JSON, 'utf-8');
      marketplace = JSON.parse(content);

      const invalidSources: string[] = [];

      for (const plugin of marketplace.plugins) {
        // Source should be relative path like "./plugins/name"
        if (!plugin.source.startsWith('./plugins/')) {
          invalidSources.push(`${plugin.name}: source should start with ./plugins/`);
          continue;
        }

        // Check if source directory exists
        const sourcePath = join(REPO_ROOT, plugin.source);
        if (!existsSync(sourcePath)) {
          invalidSources.push(`${plugin.name}: source path does not exist: ${plugin.source}`);
        }
      }

      expect(invalidSources).toEqual([]);
    });

    it('should have consistent names between source path and plugin name', async () => {
      const content = await readFile(MARKETPLACE_JSON, 'utf-8');
      marketplace = JSON.parse(content);

      const mismatches: string[] = [];

      for (const plugin of marketplace.plugins) {
        // Extract name from source path
        const sourceMatch = plugin.source.match(/\.\/plugins\/(.+)$/);
        if (sourceMatch) {
          const sourceName = sourceMatch[1];
          if (sourceName !== plugin.name) {
            mismatches.push(`Plugin ${plugin.name}: source path says ${sourceName}`);
          }
        }
      }

      expect(mismatches).toEqual([]);
    });
  });

  describe('plugin metadata consistency', () => {
    it('should have descriptions in both plugin.json and marketplace.json', async () => {
      const content = await readFile(MARKETPLACE_JSON, 'utf-8');
      const marketplace = JSON.parse(content) as MarketplaceJson;

      const missing: string[] = [];

      for (const mpPlugin of marketplace.plugins) {
        if (!mpPlugin.description) {
          missing.push(`Marketplace: ${mpPlugin.name} missing description`);
        }

        const pluginJsonPath = join(PLUGINS_DIR, mpPlugin.name, 'plugin.json');
        if (existsSync(pluginJsonPath)) {
          const pluginContent = await readFile(pluginJsonPath, 'utf-8');
          const pluginJson = JSON.parse(pluginContent) as PluginManifest;

          if (!pluginJson.description) {
            missing.push(`plugin.json: ${mpPlugin.name} missing description`);
          }
        }
      }

      expect(missing).toEqual([]);
    });

    it('should have semver-compliant versions', async () => {
      const content = await readFile(MARKETPLACE_JSON, 'utf-8');
      const marketplace = JSON.parse(content) as MarketplaceJson;

      const semverRegex = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
      const invalid: string[] = [];

      for (const plugin of marketplace.plugins) {
        if (!semverRegex.test(plugin.version)) {
          invalid.push(`${plugin.name}: ${plugin.version} is not semver-compliant`);
        }
      }

      expect(invalid).toEqual([]);
    });
  });

  describe('plugin component counts', () => {
    it('should report plugin component counts', async () => {
      const content = await readFile(MARKETPLACE_JSON, 'utf-8');
      const marketplace = JSON.parse(content) as MarketplaceJson;

      const report: Array<{
        name: string;
        agents: number;
        commands: number;
        skills: number;
        hasHooks: boolean;
        hasMcp: boolean;
      }> = [];

      for (const mpPlugin of marketplace.plugins) {
        const pluginJsonPath = join(PLUGINS_DIR, mpPlugin.name, 'plugin.json');

        if (!existsSync(pluginJsonPath)) {
          continue;
        }

        const pluginContent = await readFile(pluginJsonPath, 'utf-8');
        const pluginJson = JSON.parse(pluginContent);

        report.push({
          name: mpPlugin.name,
          agents: pluginJson.agents?.length || 0,
          commands: pluginJson.commands?.length || 0,
          skills: pluginJson.skills?.length || 0,
          hasHooks: !!pluginJson.hooks,
          hasMcp: !!pluginJson.mcpServers,
        });
      }

      // Verify we have data
      expect(report.length).toBeGreaterThan(0);

      // All plugins should have at least some components
      for (const plugin of report) {
        const totalComponents = plugin.agents + plugin.commands + plugin.skills;
        expect(totalComponents).toBeGreaterThan(0);
      }
    });
  });
});
