/**
 * Claude settings service - UI-independent
 *
 * Manages Claude Code settings files:
 * - .claude/settings.json (project/global)
 * - .claude/settings.local.json (local overrides)
 * - .mcp.json (MCP server configs)
 *
 * Features:
 * - Explicit projectPath parameter (no process.cwd())
 * - Optional logger callback (no console.log/chalk)
 * - File locking for safe concurrent writes
 * - Path validation
 */

import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { withFileLock } from "../utils/file-locking.js";
import { validateProjectPath } from "../utils/validators.js";
import type {
  ClaudeSettings,
  ClaudeLocalSettings,
  McpServerConfig,
  Marketplace,
  MarketplaceSource,
  DiscoveredMarketplace,
  InstalledPluginsRegistry,
  InstalledPluginEntry,
} from "../types/index.js";
import { parsePluginId } from "../utils/string-utils.js";

// Constants
const CLAUDE_DIR = ".claude";
const SETTINGS_FILE = "settings.json";
const LOCAL_SETTINGS_FILE = "settings.local.json";
const MCP_CONFIG_FILE = ".mcp.json";

// Options interface
export interface SettingsOptions {
  projectPath?: string;
  logger?: (message: string) => void;
}

// MCP config file types
interface McpConfigFile {
  mcpServers?: Record<string, McpServerConfig>;
}

// Known marketplaces registry types
interface KnownMarketplaceEntry {
  source: { source: string; path?: string; repo?: string };
  installLocation: string;
  lastUpdated: string;
}

type KnownMarketplaces = Record<string, KnownMarketplaceEntry>;

// File paths
const INSTALLED_PLUGINS_FILE = path.join(
  os.homedir(),
  ".claude",
  "plugins",
  "installed_plugins.json",
);

const KNOWN_MARKETPLACES_FILE = path.join(
  os.homedir(),
  ".claude",
  "plugins",
  "known_marketplaces.json",
);

// Path helpers
export function getClaudeDir(projectPath: string): string {
  return path.join(projectPath, CLAUDE_DIR);
}

export function getGlobalClaudeDir(): string {
  return path.join(os.homedir(), CLAUDE_DIR);
}

export async function ensureClaudeDir(projectPath: string): Promise<string> {
  const claudeDir = getClaudeDir(projectPath);
  await fs.ensureDir(claudeDir);
  return claudeDir;
}

// Settings file operations
export async function readSettings(
  projectPath: string,
): Promise<ClaudeSettings> {
  validateProjectPath(projectPath);
  const settingsPath = path.join(getClaudeDir(projectPath), SETTINGS_FILE);
  try {
    if (await fs.pathExists(settingsPath)) {
      return await fs.readJson(settingsPath);
    }
  } catch {
    // Return empty settings on error
  }
  return {};
}

export async function writeSettings(
  settings: ClaudeSettings,
  projectPath: string,
): Promise<void> {
  validateProjectPath(projectPath);
  const claudeDir = await ensureClaudeDir(projectPath);
  const settingsPath = path.join(claudeDir, SETTINGS_FILE);

  await withFileLock(settingsPath, async () => {
    await fs.writeJson(settingsPath, settings, { spaces: 2 });
  });
}

export async function readLocalSettings(
  projectPath: string,
): Promise<ClaudeLocalSettings> {
  validateProjectPath(projectPath);
  const localPath = path.join(getClaudeDir(projectPath), LOCAL_SETTINGS_FILE);
  try {
    if (await fs.pathExists(localPath)) {
      return await fs.readJson(localPath);
    }
  } catch {
    // Return empty settings on error
  }
  return {};
}

export async function writeLocalSettings(
  settings: ClaudeLocalSettings,
  projectPath: string,
): Promise<void> {
  validateProjectPath(projectPath);
  const claudeDir = await ensureClaudeDir(projectPath);
  const localPath = path.join(claudeDir, LOCAL_SETTINGS_FILE);

  await withFileLock(localPath, async () => {
    await fs.writeJson(localPath, settings, { spaces: 2 });
  });
}

// MCP config file management (.mcp.json at project root)
export function getMcpConfigPath(projectPath: string): string {
  validateProjectPath(projectPath);
  return path.join(projectPath, MCP_CONFIG_FILE);
}

export async function readMcpConfig(
  projectPath: string,
): Promise<McpConfigFile> {
  validateProjectPath(projectPath);
  const mcpPath = getMcpConfigPath(projectPath);
  try {
    if (await fs.pathExists(mcpPath)) {
      return await fs.readJson(mcpPath);
    }
  } catch {
    // Return empty config on error
  }
  return {};
}

export async function writeMcpConfig(
  config: McpConfigFile,
  projectPath: string,
): Promise<void> {
  validateProjectPath(projectPath);
  const mcpPath = getMcpConfigPath(projectPath);

  await withFileLock(mcpPath, async () => {
    await fs.writeJson(mcpPath, config, { spaces: 2 });
  });
}

// Global settings operations
export async function readGlobalSettings(): Promise<ClaudeSettings> {
  const settingsPath = path.join(getGlobalClaudeDir(), SETTINGS_FILE);
  try {
    if (await fs.pathExists(settingsPath)) {
      return await fs.readJson(settingsPath);
    }
  } catch {
    // Return empty settings on error
  }
  return {};
}

export async function writeGlobalSettings(
  settings: ClaudeSettings,
): Promise<void> {
  await fs.ensureDir(getGlobalClaudeDir());
  const settingsPath = path.join(getGlobalClaudeDir(), SETTINGS_FILE);

  await withFileLock(settingsPath, async () => {
    await fs.writeJson(settingsPath, settings, { spaces: 2 });
  });
}

// MCP Server management
export async function addMcpServer(
  name: string,
  config: McpServerConfig,
  projectPath: string,
  logger?: (message: string) => void,
): Promise<void> {
  validateProjectPath(projectPath);

  // Extract env vars from config
  const envVars = config.env || {};
  const configWithoutEnv: McpServerConfig = { ...config };
  delete configWithoutEnv.env;

  // Add to .mcp.json (without env vars)
  const mcpConfig = await readMcpConfig(projectPath);
  mcpConfig.mcpServers = mcpConfig.mcpServers || {};
  mcpConfig.mcpServers[name] = configWithoutEnv;
  await writeMcpConfig(mcpConfig, projectPath);

  // Enable in settings.local.json and add env vars
  const localSettings = await readLocalSettings(projectPath);
  const enabledServers = localSettings.enabledMcpjsonServers || [];
  if (!enabledServers.includes(name)) {
    enabledServers.push(name);
  }
  localSettings.enabledMcpjsonServers = enabledServers;
  localSettings.enableAllProjectMcpServers = true;

  // Add env vars to settings.local.json
  if (Object.keys(envVars).length > 0) {
    localSettings.env = localSettings.env || {};
    for (const [key, value] of Object.entries(envVars)) {
      // Only add non-reference values
      if (!value.startsWith("${") || !value.endsWith("}")) {
        localSettings.env[key] = value;
      }
    }
  }

  await writeLocalSettings(localSettings, projectPath);

  if (logger) {
    logger(`MCP server '${name}' added successfully`);
  }
}

export async function removeMcpServer(
  name: string,
  projectPath: string,
  logger?: (message: string) => void,
): Promise<void> {
  validateProjectPath(projectPath);

  // Remove from .mcp.json
  const mcpConfig = await readMcpConfig(projectPath);
  if (mcpConfig.mcpServers) {
    delete mcpConfig.mcpServers[name];
  }
  await writeMcpConfig(mcpConfig, projectPath);

  // Remove from settings.local.json
  const localSettings = await readLocalSettings(projectPath);
  if (localSettings.enabledMcpjsonServers) {
    localSettings.enabledMcpjsonServers =
      localSettings.enabledMcpjsonServers.filter((s) => s !== name);
    await writeLocalSettings(localSettings, projectPath);
  }

  if (logger) {
    logger(`MCP server '${name}' removed successfully`);
  }
}

export async function toggleMcpServer(
  name: string,
  enabled: boolean,
  projectPath: string,
  logger?: (message: string) => void,
): Promise<void> {
  validateProjectPath(projectPath);

  // Toggle is now a remove operation since .mcp.json doesn't have enabled/disabled state
  if (!enabled) {
    await removeMcpServer(name, projectPath, logger);
  }
}

export async function setAllowMcp(
  _allow: boolean,
  _projectPath: string,
): Promise<void> {
  // .mcp.json doesn't have an allowMcp setting - kept for API compatibility
}

// Marketplace management
export async function addMarketplace(
  marketplace: Marketplace,
  projectPath: string,
  logger?: (message: string) => void,
): Promise<void> {
  validateProjectPath(projectPath);

  const settings = await readSettings(projectPath);
  settings.extraKnownMarketplaces = settings.extraKnownMarketplaces || {};
  settings.extraKnownMarketplaces[marketplace.name] = {
    source: marketplace.source,
  };
  await writeSettings(settings, projectPath);

  if (logger) {
    logger(`Marketplace '${marketplace.name}' added successfully`);
  }
}

export async function removeMarketplace(
  name: string,
  projectPath: string,
  logger?: (message: string) => void,
): Promise<void> {
  validateProjectPath(projectPath);

  const settings = await readSettings(projectPath);
  if (settings.extraKnownMarketplaces) {
    delete settings.extraKnownMarketplaces[name];
  }
  await writeSettings(settings, projectPath);

  if (logger) {
    logger(`Marketplace '${name}' removed successfully`);
  }
}

// Plugin management
export async function enablePlugin(
  pluginId: string,
  enabled: boolean,
  projectPath: string,
): Promise<void> {
  validateProjectPath(projectPath);

  const settings = await readSettings(projectPath);
  settings.enabledPlugins = settings.enabledPlugins || {};
  settings.enabledPlugins[pluginId] = enabled;
  await writeSettings(settings, projectPath);
}

export async function getEnabledPlugins(
  projectPath: string,
): Promise<Record<string, boolean>> {
  validateProjectPath(projectPath);
  const settings = await readSettings(projectPath);
  return settings.enabledPlugins || {};
}

export async function getLocalEnabledPlugins(
  projectPath: string,
): Promise<Record<string, boolean>> {
  validateProjectPath(projectPath);
  const settings = await readLocalSettings(projectPath);
  return settings.enabledPlugins || {};
}

export async function getLocalInstalledPluginVersions(
  projectPath: string,
): Promise<Record<string, string>> {
  validateProjectPath(projectPath);
  const settings = await readLocalSettings(projectPath);
  return settings.installedPluginVersions || {};
}

// Local plugin management
export async function enableLocalPlugin(
  pluginId: string,
  enabled: boolean,
  projectPath: string,
): Promise<void> {
  validateProjectPath(projectPath);

  const settings = await readLocalSettings(projectPath);
  settings.enabledPlugins = settings.enabledPlugins || {};
  settings.enabledPlugins[pluginId] = enabled;
  await writeLocalSettings(settings, projectPath);
}

export async function saveLocalInstalledPluginVersion(
  pluginId: string,
  version: string,
  projectPath: string,
  logger?: (message: string) => void,
): Promise<void> {
  validateProjectPath(projectPath);

  const settings = await readLocalSettings(projectPath);
  settings.installedPluginVersions = settings.installedPluginVersions || {};
  settings.installedPluginVersions[pluginId] = version;
  await writeLocalSettings(settings, projectPath);

  // Update registry for local scope
  await updateInstalledPluginsRegistry(
    pluginId,
    version,
    "local",
    path.resolve(projectPath),
    logger,
  );
}

export async function removeLocalInstalledPluginVersion(
  pluginId: string,
  projectPath: string,
  logger?: (message: string) => void,
): Promise<void> {
  validateProjectPath(projectPath);

  const settings = await readLocalSettings(projectPath);
  if (settings.installedPluginVersions) {
    delete settings.installedPluginVersions[pluginId];
  }
  if (settings.enabledPlugins) {
    delete settings.enabledPlugins[pluginId];
  }
  await writeLocalSettings(settings, projectPath);

  // Remove from registry for local scope
  await removeFromInstalledPluginsRegistry(
    pluginId,
    "local",
    path.resolve(projectPath),
    logger,
  );
}

// Status line management
export async function setStatusLine(
  template: string,
  projectPath: string,
): Promise<void> {
  validateProjectPath(projectPath);

  const settings = await readSettings(projectPath);
  settings.statusLine = template;
  await writeSettings(settings, projectPath);
}

export async function getStatusLine(
  projectPath: string,
): Promise<string | undefined> {
  validateProjectPath(projectPath);
  const settings = await readSettings(projectPath);
  return settings.statusLine;
}

export async function setGlobalStatusLine(template: string): Promise<void> {
  const settings = await readGlobalSettings();
  settings.statusLine = template;
  await writeGlobalSettings(settings);
}

export async function getGlobalStatusLine(): Promise<string | undefined> {
  const settings = await readGlobalSettings();
  return settings.statusLine;
}

export async function getEffectiveStatusLine(projectPath: string): Promise<{
  template: string | undefined;
  source: "project" | "global" | "default";
}> {
  validateProjectPath(projectPath);

  const projectStatusLine = await getStatusLine(projectPath);
  if (projectStatusLine) {
    return { template: projectStatusLine, source: "project" };
  }

  const globalStatusLine = await getGlobalStatusLine();
  if (globalStatusLine) {
    return { template: globalStatusLine, source: "global" };
  }

  return { template: undefined, source: "default" };
}

// Check if .claude directory exists
export async function hasClaudeDir(projectPath: string): Promise<boolean> {
  validateProjectPath(projectPath);
  return fs.pathExists(getClaudeDir(projectPath));
}

// Get installed MCP servers
export async function getInstalledMcpServers(
  projectPath: string,
): Promise<Record<string, McpServerConfig>> {
  validateProjectPath(projectPath);
  const mcpConfig = await readMcpConfig(projectPath);
  return mcpConfig.mcpServers || {};
}

// Get env vars for MCP servers
export async function getMcpEnvVars(
  projectPath: string,
): Promise<Record<string, string>> {
  validateProjectPath(projectPath);
  const localSettings = await readLocalSettings(projectPath);
  return localSettings.env || {};
}

// Set an env var for MCP servers
export async function setMcpEnvVar(
  name: string,
  value: string,
  projectPath: string,
): Promise<void> {
  validateProjectPath(projectPath);

  const localSettings = await readLocalSettings(projectPath);
  localSettings.env = localSettings.env || {};
  localSettings.env[name] = value;
  await writeLocalSettings(localSettings, projectPath);
}

// Remove an env var
export async function removeMcpEnvVar(
  name: string,
  projectPath: string,
): Promise<void> {
  validateProjectPath(projectPath);

  const localSettings = await readLocalSettings(projectPath);
  if (localSettings.env) {
    delete localSettings.env[name];
    await writeLocalSettings(localSettings, projectPath);
  }
}

// Get enabled MCP servers
export async function getEnabledMcpServers(
  projectPath: string,
): Promise<Record<string, boolean>> {
  validateProjectPath(projectPath);

  const mcpConfig = await readMcpConfig(projectPath);
  const servers = mcpConfig.mcpServers || {};
  const enabled: Record<string, boolean> = {};
  for (const name of Object.keys(servers)) {
    enabled[name] = true;
  }
  return enabled;
}

// Get all configured marketplaces
export async function getConfiguredMarketplaces(
  projectPath: string,
): Promise<Record<string, MarketplaceSource>> {
  validateProjectPath(projectPath);
  const settings = await readSettings(projectPath);
  return settings.extraKnownMarketplaces || {};
}

// Global marketplace management
export async function addGlobalMarketplace(
  marketplace: Marketplace,
  logger?: (message: string) => void,
): Promise<void> {
  const settings = await readGlobalSettings();
  settings.extraKnownMarketplaces = settings.extraKnownMarketplaces || {};
  settings.extraKnownMarketplaces[marketplace.name] = {
    source: marketplace.source,
  };
  await writeGlobalSettings(settings);

  if (logger) {
    logger(`Global marketplace '${marketplace.name}' added successfully`);
  }
}

export async function removeGlobalMarketplace(
  name: string,
  logger?: (message: string) => void,
): Promise<void> {
  const settings = await readGlobalSettings();
  if (settings.extraKnownMarketplaces) {
    delete settings.extraKnownMarketplaces[name];
  }
  await writeGlobalSettings(settings);

  if (logger) {
    logger(`Global marketplace '${name}' removed successfully`);
  }
}

export async function getGlobalConfiguredMarketplaces(): Promise<
  Record<string, MarketplaceSource>
> {
  const settings = await readGlobalSettings();
  return settings.extraKnownMarketplaces || {};
}

// Global plugin management
export async function enableGlobalPlugin(
  pluginId: string,
  enabled: boolean,
): Promise<void> {
  const settings = await readGlobalSettings();
  settings.enabledPlugins = settings.enabledPlugins || {};
  settings.enabledPlugins[pluginId] = enabled;
  await writeGlobalSettings(settings);
}

export async function getGlobalEnabledPlugins(): Promise<
  Record<string, boolean>
> {
  const settings = await readGlobalSettings();
  return settings.enabledPlugins || {};
}

export async function getGlobalInstalledPluginVersions(): Promise<
  Record<string, string>
> {
  const settings = await readGlobalSettings();
  return settings.installedPluginVersions || {};
}

export async function saveGlobalInstalledPluginVersion(
  pluginId: string,
  version: string,
  logger?: (message: string) => void,
): Promise<void> {
  const settings = await readGlobalSettings();
  settings.installedPluginVersions = settings.installedPluginVersions || {};
  settings.installedPluginVersions[pluginId] = version;
  await writeGlobalSettings(settings);

  // Update registry for user scope
  await updateInstalledPluginsRegistry(pluginId, version, "user", undefined, logger);
}

export async function removeGlobalInstalledPluginVersion(
  pluginId: string,
  logger?: (message: string) => void,
): Promise<void> {
  const settings = await readGlobalSettings();
  if (settings.installedPluginVersions) {
    delete settings.installedPluginVersions[pluginId];
  }
  if (settings.enabledPlugins) {
    delete settings.enabledPlugins[pluginId];
  }
  await writeGlobalSettings(settings);

  // Remove from registry for user scope
  await removeFromInstalledPluginsRegistry(pluginId, "user", undefined, logger);
}

// Marketplace discovery
function discoverMarketplacesFromSettings(
  settings: ClaudeSettings,
): DiscoveredMarketplace[] {
  const discovered = new Map<string, DiscoveredMarketplace>();

  // From extraKnownMarketplaces
  for (const [name, config] of Object.entries(
    settings.extraKnownMarketplaces || {},
  )) {
    discovered.set(name, { name, source: "configured", config });
  }

  // From enabledPlugins
  for (const pluginId of Object.keys(settings.enabledPlugins || {})) {
    const parsed = parsePluginId(pluginId);
    if (parsed && !discovered.has(parsed.marketplace)) {
      discovered.set(parsed.marketplace, {
        name: parsed.marketplace,
        source: "inferred",
      });
    }
  }

  // From installedPluginVersions
  for (const pluginId of Object.keys(settings.installedPluginVersions || {})) {
    const parsed = parsePluginId(pluginId);
    if (parsed && !discovered.has(parsed.marketplace)) {
      discovered.set(parsed.marketplace, {
        name: parsed.marketplace,
        source: "inferred",
      });
    }
  }

  return Array.from(discovered.values());
}

export async function discoverAllMarketplaces(
  projectPath: string,
  logger?: (message: string) => void,
): Promise<DiscoveredMarketplace[]> {
  try {
    validateProjectPath(projectPath);
    const settings = await readSettings(projectPath);
    return discoverMarketplacesFromSettings(settings);
  } catch (error) {
    if (logger) {
      logger(
        `Failed to discover project marketplaces: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
    return [];
  }
}

export async function discoverAllGlobalMarketplaces(
  logger?: (message: string) => void,
): Promise<DiscoveredMarketplace[]> {
  try {
    const settings = await readGlobalSettings();
    return discoverMarketplacesFromSettings(settings);
  } catch (error) {
    if (logger) {
      logger(
        `Failed to discover global marketplaces: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
    return [];
  }
}

// Installed plugins registry
async function readKnownMarketplaces(): Promise<KnownMarketplaces> {
  try {
    if (await fs.pathExists(KNOWN_MARKETPLACES_FILE)) {
      return await fs.readJson(KNOWN_MARKETPLACES_FILE);
    }
  } catch {
    // Return empty if can't read
  }
  return {};
}

async function getPluginSourcePath(
  pluginName: string,
  marketplace: string,
): Promise<string | null> {
  const known = await readKnownMarketplaces();
  const mpEntry = known[marketplace];

  if (!mpEntry) {
    return null;
  }

  let basePath: string;

  if (mpEntry.source.source === "directory" && mpEntry.source.path) {
    basePath = mpEntry.source.path;
  } else {
    basePath = mpEntry.installLocation;
  }

  const possiblePaths = [
    path.join(basePath, "plugins", pluginName),
    path.join(basePath, pluginName),
  ];

  for (const pluginPath of possiblePaths) {
    if (await fs.pathExists(pluginPath)) {
      return pluginPath;
    }
  }

  return null;
}

async function copyPluginToCache(
  pluginId: string,
  version: string,
  marketplace: string,
  logger?: (message: string) => void,
): Promise<boolean> {
  const { pluginName } = parsePluginId(pluginId) || {
    pluginName: pluginId.split("@")[0],
  };

  const sourcePath = await getPluginSourcePath(pluginName, marketplace);
  if (!sourcePath) {
    return false;
  }

  const cachePath = getPluginCachePath(pluginId, version, marketplace);

  try {
    if (await fs.pathExists(cachePath)) {
      await fs.remove(cachePath);
    }

    await fs.copy(sourcePath, cachePath, {
      overwrite: true,
      errorOnExist: false,
    });

    return true;
  } catch (error) {
    if (logger) {
      logger(
        `Failed to copy plugin ${pluginId} to cache: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
    return false;
  }
}

export async function readInstalledPluginsRegistry(): Promise<InstalledPluginsRegistry> {
  try {
    if (await fs.pathExists(INSTALLED_PLUGINS_FILE)) {
      const content = await fs.readJson(INSTALLED_PLUGINS_FILE);
      if (!content.version || !content.plugins) {
        throw new Error("Invalid registry structure");
      }
      return content;
    }
  } catch (error) {
    if (await fs.pathExists(INSTALLED_PLUGINS_FILE)) {
      try {
        const backup = `${INSTALLED_PLUGINS_FILE}.backup.${Date.now()}`;
        await fs.copy(INSTALLED_PLUGINS_FILE, backup);
      } catch {
        // Ignore backup errors
      }
    }
  }
  return { version: 2, plugins: {} };
}

export async function writeInstalledPluginsRegistry(
  registry: InstalledPluginsRegistry,
): Promise<void> {
  await fs.ensureDir(path.dirname(INSTALLED_PLUGINS_FILE));

  await withFileLock(INSTALLED_PLUGINS_FILE, async () => {
    await fs.writeJson(INSTALLED_PLUGINS_FILE, registry, { spaces: 2 });
  });
}

function getPluginCachePath(
  pluginId: string,
  version: string,
  marketplace: string,
): string {
  const { pluginName } = parsePluginId(pluginId) || {
    pluginName: pluginId.split("@")[0],
  };
  return path.join(
    os.homedir(),
    ".claude",
    "plugins",
    "cache",
    marketplace,
    pluginName,
    version,
  );
}

export async function updateInstalledPluginsRegistry(
  pluginId: string,
  version: string,
  scope: "user" | "project" | "local",
  projectPath?: string,
  logger?: (message: string) => void,
): Promise<void> {
  try {
    const registry = await readInstalledPluginsRegistry();

    const parsed = parsePluginId(pluginId);
    if (!parsed) {
      if (logger) {
        logger(`Invalid plugin ID: ${pluginId}, skipping registry update`);
      }
      return;
    }

    const { marketplace } = parsed;

    await copyPluginToCache(pluginId, version, marketplace, logger);

    const installPath = getPluginCachePath(pluginId, version, marketplace);
    const now = new Date().toISOString();

    if (!registry.plugins[pluginId]) {
      registry.plugins[pluginId] = [];
    }

    const existingIndex = registry.plugins[pluginId].findIndex((entry) => {
      if (entry.scope !== scope) return false;
      if (scope === "user") return true;
      return entry.projectPath === projectPath;
    });

    const entry: InstalledPluginEntry = {
      scope,
      projectPath,
      installPath,
      version,
      installedAt:
        existingIndex >= 0
          ? registry.plugins[pluginId][existingIndex].installedAt
          : now,
      lastUpdated: now,
      gitCommitSha:
        existingIndex >= 0
          ? registry.plugins[pluginId][existingIndex].gitCommitSha
          : undefined,
    };

    if (existingIndex >= 0) {
      registry.plugins[pluginId][existingIndex] = entry;
    } else {
      registry.plugins[pluginId].push(entry);
    }

    await writeInstalledPluginsRegistry(registry);
  } catch (error) {
    if (logger) {
      logger(
        `Failed to update registry for ${pluginId}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
}

export async function removeFromInstalledPluginsRegistry(
  pluginId: string,
  scope: "user" | "project" | "local",
  projectPath?: string,
  logger?: (message: string) => void,
): Promise<void> {
  try {
    const registry = await readInstalledPluginsRegistry();

    if (!registry.plugins[pluginId]) return;

    registry.plugins[pluginId] = registry.plugins[pluginId].filter((entry) => {
      if (entry.scope !== scope) return true;
      if (scope === "user") return false;
      return entry.projectPath !== projectPath;
    });

    if (registry.plugins[pluginId].length === 0) {
      delete registry.plugins[pluginId];
    }

    await writeInstalledPluginsRegistry(registry);
  } catch (error) {
    if (logger) {
      logger(
        `Failed to remove from registry for ${pluginId}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
}
