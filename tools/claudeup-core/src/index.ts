/**
 * claudeup-core - Shared service layer for claudeup TUI and GUI
 *
 * This package provides UI-independent services for managing Claude Code
 * plugins, MCP servers, and configuration. It is designed to be consumed
 * by both the TUI (Ink) and GUI (Tauri) implementations.
 */

// Core types
export * from './types/index.js';
export type { McpTestResult, McpTestStep, McpServerStatus } from './types/index.js';

// MCP server data
export { MCP_SERVERS, type McpServer } from './data/mcp-servers.js';

// MCP Registry API (online search)
export {
  searchMcpRegistry,
  getPopularMcpServers,
  formatRelativeDate,
  type McpRegistryServer,
  type McpRegistryResponse,
  type McpEnvironmentVariable,
  type SearchOptions as McpSearchOptions,
} from './services/mcp-registry-api.js';

// Utilities
export * from './utils/validators.js';
export * from './utils/file-locking.js';

// Services - Cache Management
export {
  CacheManager,
  NamespacedCacheManager,
  type CacheOptions,
  type CacheEntry,
  type CacheStats,
  type InvalidationHook,
} from './services/cache-manager.js';

export {
  CacheInvalidationHooks,
  PluginCacheInvalidator,
  createStandardHooks,
  type InvalidationRule,
  type HookTrigger,
} from './services/cache-hooks.js';

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
  // Plugin enable/disable (with cache invalidation)
  enablePlugin,
  enableLocalPlugin,
  enableGlobalPlugin,
  // Marketplace operations
  refreshAllMarketplaces,
  clearMarketplaceCache,
  // Cache utilities
  getCacheStats,
  getCacheHooks,
  getCacheManager,
  // Types
  type PluginInfo,
  type ScopeStatus,
  type MarketplacePlugin,
  type LoggerCallback,
  type RefreshAndRepairResult,
} from './services/plugin-manager.js';

// Re-export types and functions from local-marketplace
export type { ProgressCallback, RefreshResult, RepairMarketplaceResult, ComponentMeta, FetchedPluginDetails } from './services/local-marketplace.js';

// Services - Local Marketplace Management
export {
  // Marketplace operations
  cloneMarketplace,
  deleteMarketplace,
  addToKnownMarketplaces,
  removeFromKnownMarketplaces,
  scanLocalMarketplaces,
  refreshLocalMarketplaces,
  getLocalMarketplace,
  hasLocalMarketplace,
  // Plugin details fetching
  fetchPluginDetails,
  clearPluginCache,
} from './services/local-marketplace.js';

// Services - Settings Management
export {
  // Settings read/write
  readSettings,
  writeSettings,
  readGlobalSettings,
  writeGlobalSettings,
  readLocalSettings,
  writeLocalSettings,
  // Settings cache management
  getSettingsCacheStats,
  clearSettingsCache,
  // Plugin enabled state (read-only - use plugin-manager for enable/disable)
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
  // MCP server-scoped env vars (NEW)
  getMcpServerEnvVars,
  setMcpServerEnvVar,
  removeMcpServerEnvVar,
  // MCP server testing and status (NEW)
  testMcpConnection,
  getMcpServerStatus,
  // MCP validation (NEW)
  validateMcpServerName,
  validateMcpServerConfig,
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
