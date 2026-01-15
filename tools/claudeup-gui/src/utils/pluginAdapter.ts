import { Plugin as BackendPlugin } from '../hooks/usePlugins';
import { Plugin as FrontendPlugin, ScopeStatus } from '../types';

/**
 * Get display name for marketplace ID
 */
export function getMarketplaceName(id: string): string {
  const knownMarketplaces: Record<string, string> = {
    'mag-claude-plugins': 'MAG Claude Plugins',
    'community': 'Community Registry',
    'official': 'Official Plugins',
  };
  return knownMarketplaces[id] || id;
}

/**
 * Transforms backend plugin data to frontend format
 */
export function adaptPluginFromBackend(
  backendPlugin: BackendPlugin
): FrontendPlugin {
  // Derive per-scope status from backend
  const userScope: ScopeStatus | null = backendPlugin.scope === 'global'
    ? { enabled: backendPlugin.enabled, version: backendPlugin.version }
    : null;

  const projectScope: ScopeStatus | null = backendPlugin.scope === 'project'
    ? { enabled: backendPlugin.enabled, version: backendPlugin.version }
    : null;

  return {
    // Core fields (direct mapping)
    id: backendPlugin.id,
    name: backendPlugin.name,
    version: backendPlugin.version,
    description: backendPlugin.description,
    enabled: backendPlugin.enabled,
    marketplace: backendPlugin.marketplace,

    // Computed fields
    marketplaceDisplay: getMarketplaceName(backendPlugin.marketplace),
    installedVersion: backendPlugin.version,
    hasUpdate: false, // TODO: Implement version comparison with catalog

    // Metadata (TODO: Load from marketplace.json)
    category: 'development',
    author: undefined,
    homepage: undefined,
    license: undefined,
    keywords: [],

    // Per-scope status
    userScope,
    projectScope,
    localScope: null, // Backend doesn't track local scope yet

    // Components (TODO: Load from plugin metadata)
    agents: [],
    commands: [],
    skills: [],
    mcpServers: [],
    hooks: undefined,
  };
}

/**
 * Transforms multiple backend plugins to frontend format
 */
export function adaptPluginsFromBackend(
  backendPlugins: BackendPlugin[]
): FrontendPlugin[] {
  return backendPlugins.map(adaptPluginFromBackend);
}
