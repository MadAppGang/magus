/**
 * Type declarations for claudeup-core
 * Minimal declarations for sidecar integration
 */

declare module 'claudeup-core' {
  // Plugin Info
  export interface ScopeStatus {
    enabled: boolean;
    version?: string;
  }

  export interface PluginInfo {
    id: string;
    name: string;
    version: string | null;
    description: string;
    marketplace: string;
    marketplaceDisplay: string;
    enabled: boolean;
    installedVersion?: string;
    hasUpdate?: boolean;
    userScope?: ScopeStatus;
    projectScope?: ScopeStatus;
    localScope?: ScopeStatus;
    category?: string;
    author?: { name: string; email?: string };
    homepage?: string;
    tags?: string[];
    agents?: string[];
    commands?: string[];
    skills?: string[];
    mcpServers?: string[];
    lspServers?: Record<string, unknown>;
  }

  // Callbacks
  export type LoggerCallback = (level: 'info' | 'warn' | 'error', message: string, ...args: unknown[]) => void;
  export type ProgressCallback = (percent: number, status: string) => void;

  // Refresh Results
  export interface RefreshResult {
    name: string;
    success: boolean;
    message: string;
    error?: string;
  }

  export interface RepairMarketplaceResult {
    marketplace: string;
    pluginsRepaired: number;
    errors: string[];
  }

  export interface RefreshAndRepairResult {
    refresh: RefreshResult[];
    repair: RepairMarketplaceResult[];
  }

  // Plugin Manager Functions
  export function getAvailablePlugins(projectPath?: string, logger?: LoggerCallback): Promise<PluginInfo[]>;
  export function getGlobalAvailablePlugins(logger?: LoggerCallback): Promise<PluginInfo[]>;
  export function saveInstalledPluginVersion(pluginId: string, version: string, projectPath?: string): Promise<void>;
  export function removeInstalledPluginVersion(pluginId: string, projectPath?: string): Promise<void>;
  export function refreshAllMarketplaces(onProgress?: ProgressCallback): Promise<RefreshAndRepairResult>;

  // Settings Functions
  export function enablePlugin(pluginId: string, enabled: boolean, projectPath: string): Promise<void>;
  export function enableGlobalPlugin(pluginId: string, enabled: boolean): Promise<void>;
  export function enableLocalPlugin(pluginId: string, enabled: boolean, projectPath: string): Promise<void>;
  export function saveGlobalInstalledPluginVersion(pluginId: string, version: string, logger?: LoggerCallback): Promise<void>;
  export function removeGlobalInstalledPluginVersion(pluginId: string, logger?: LoggerCallback): Promise<void>;
  export function saveLocalInstalledPluginVersion(pluginId: string, version: string, projectPath: string, logger?: LoggerCallback): Promise<void>;
  export function removeLocalInstalledPluginVersion(pluginId: string, projectPath: string, logger?: LoggerCallback): Promise<void>;
}
