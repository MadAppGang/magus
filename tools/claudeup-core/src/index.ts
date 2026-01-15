/**
 * claudeup-core - Shared service layer for claudeup TUI and GUI
 *
 * This package provides UI-independent services for managing Claude Code
 * plugins, MCP servers, and configuration. It is designed to be consumed
 * by both the TUI (Ink) and GUI (Tauri) implementations.
 */

// Core types
export * from './types/index.js';

// Utilities
export * from './utils/validators.js';
export * from './utils/file-locking.js';

// Services - Plugin Management
export {
  // Plugin listing
  getAvailablePlugins,
  getGlobalAvailablePlugins,
  fetchMarketplacePlugins,
  getLocalMarketplacesInfo,
  // Plugin version management
  saveInstalledPluginVersion,
  removeInstalledPluginVersion,
  // Marketplace operations
  refreshAllMarketplaces,
  clearMarketplaceCache,
  // Types
  type PluginInfo,
  type ScopeStatus,
  type MarketplacePlugin,
  type LoggerCallback,
  type RefreshAndRepairResult,
} from './services/plugin-manager.js';

// Re-export progress types from local-marketplace
export type { ProgressCallback, RefreshResult, RepairMarketplaceResult } from './services/local-marketplace.js';

// Services - Settings Management
export {
  // Settings read/write
  readSettings,
  writeSettings,
  readGlobalSettings,
  writeGlobalSettings,
  readLocalSettings,
  writeLocalSettings,
  // Plugin enable/disable
  enablePlugin,
  enableGlobalPlugin,
  enableLocalPlugin,
  getEnabledPlugins,
  getGlobalEnabledPlugins,
  getLocalEnabledPlugins,
  // Plugin versions (global/local scope)
  saveGlobalInstalledPluginVersion,
  removeGlobalInstalledPluginVersion,
  saveLocalInstalledPluginVersion,
  removeLocalInstalledPluginVersion,
  getGlobalInstalledPluginVersions,
  getLocalInstalledPluginVersions,
  // Marketplace management
  addMarketplace,
  removeMarketplace,
  addGlobalMarketplace,
  removeGlobalMarketplace,
  getConfiguredMarketplaces,
  getGlobalConfiguredMarketplaces,
  // MCP server management
  addMcpServer,
  removeMcpServer,
  toggleMcpServer,
  getInstalledMcpServers,
  getEnabledMcpServers,
  getMcpEnvVars,
  setMcpEnvVar,
  removeMcpEnvVar,
  // Status line
  setStatusLine,
  getStatusLine,
  setGlobalStatusLine,
  getGlobalStatusLine,
  getEffectiveStatusLine,
  // Directory helpers
  getClaudeDir,
  getGlobalClaudeDir,
  ensureClaudeDir,
  hasClaudeDir,
  // Installed plugins registry
  readInstalledPluginsRegistry,
  writeInstalledPluginsRegistry,
  updateInstalledPluginsRegistry,
  removeFromInstalledPluginsRegistry,
  // Marketplace discovery
  discoverAllMarketplaces,
  discoverAllGlobalMarketplaces,
} from './services/claude-settings.js';
