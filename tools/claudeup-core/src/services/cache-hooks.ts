/**
 * Cache Invalidation Hooks System
 *
 * Provides a declarative way to define cache invalidation rules based on events.
 * Supports automatic invalidation when settings change, plugins are installed/removed,
 * or marketplaces are refreshed.
 *
 * @example
 * ```typescript
 * const hooks = new CacheInvalidationHooks(cacheManager);
 * hooks.registerPluginInstallHook();
 * hooks.registerSettingsChangeHook();
 *
 * // Trigger invalidation
 * await hooks.onPluginInstalled('frontend@mag');
 * await hooks.onSettingsChanged();
 * ```
 */

import { CacheManager, NamespacedCacheManager } from './cache-manager.js';

export interface InvalidationRule {
  /** Name/description of the rule */
  name: string;
  /** Pattern(s) to invalidate when rule triggers */
  patterns: string[];
  /** Optional condition to check before invalidating */
  condition?: () => boolean | Promise<boolean>;
}

export type HookTrigger =
  | 'plugin:install'
  | 'plugin:uninstall'
  | 'plugin:enable'
  | 'plugin:disable'
  | 'settings:change'
  | 'marketplace:refresh'
  | 'marketplace:add'
  | 'marketplace:remove';

/**
 * Cache Invalidation Hooks Manager
 * Orchestrates cache invalidation based on system events
 */
export class CacheInvalidationHooks {
  private cache: CacheManager | NamespacedCacheManager;
  private rules = new Map<HookTrigger, InvalidationRule[]>();
  private isNamespaced: boolean;

  constructor(cache: CacheManager | NamespacedCacheManager) {
    this.cache = cache;
    this.isNamespaced = cache instanceof NamespacedCacheManager;
  }

  /**
   * Register a custom invalidation rule
   * @param trigger - Event that triggers invalidation
   * @param rule - Invalidation rule definition
   */
  registerRule(trigger: HookTrigger, rule: InvalidationRule): void {
    const rules = this.rules.get(trigger) || [];
    rules.push(rule);
    this.rules.set(trigger, rules);
  }

  /**
   * Register standard plugin installation hooks
   * Invalidates plugin lists and availability caches
   */
  registerPluginInstallHook(): void {
    this.registerRule('plugin:install', {
      name: 'Invalidate plugin availability on install',
      patterns: ['plugins:available', 'plugins:installed:*', 'plugins:enabled:*'],
    });

    this.registerRule('plugin:enable', {
      name: 'Invalidate enabled plugins cache',
      patterns: ['plugins:enabled:*', 'plugins:available'],
    });
  }

  /**
   * Register standard plugin uninstallation hooks
   * Invalidates plugin lists and settings caches
   */
  registerPluginUninstallHook(): void {
    this.registerRule('plugin:uninstall', {
      name: 'Invalidate plugin caches on uninstall',
      patterns: ['plugins:*', 'settings:*'],
    });

    this.registerRule('plugin:disable', {
      name: 'Invalidate enabled plugins cache',
      patterns: ['plugins:enabled:*', 'plugins:available'],
    });
  }

  /**
   * Register settings change hooks
   * Invalidates all plugin and settings related caches
   */
  registerSettingsChangeHook(): void {
    this.registerRule('settings:change', {
      name: 'Invalidate all caches on settings change',
      patterns: ['*'], // Invalidate everything
    });
  }

  /**
   * Register marketplace refresh hooks
   * Invalidates marketplace data and plugin availability
   */
  registerMarketplaceRefreshHook(): void {
    this.registerRule('marketplace:refresh', {
      name: 'Invalidate marketplace data on refresh',
      patterns: ['marketplace:*', 'plugins:available'],
    });

    this.registerRule('marketplace:add', {
      name: 'Invalidate on marketplace addition',
      patterns: ['marketplace:list', 'marketplace:configured', 'plugins:available'],
    });

    this.registerRule('marketplace:remove', {
      name: 'Invalidate on marketplace removal',
      patterns: ['marketplace:*', 'plugins:available'],
    });
  }

  /**
   * Register all standard hooks
   */
  registerStandardHooks(): void {
    this.registerPluginInstallHook();
    this.registerPluginUninstallHook();
    this.registerSettingsChangeHook();
    this.registerMarketplaceRefreshHook();
  }

  /**
   * Trigger invalidation for plugin installation
   * @param pluginId - Plugin ID that was installed
   */
  async onPluginInstalled(pluginId: string): Promise<void> {
    await this.trigger('plugin:install', { pluginId });
  }

  /**
   * Trigger invalidation for plugin uninstallation
   * @param pluginId - Plugin ID that was uninstalled
   */
  async onPluginUninstalled(pluginId: string): Promise<void> {
    await this.trigger('plugin:uninstall', { pluginId });
  }

  /**
   * Trigger invalidation for plugin enable
   * @param pluginId - Plugin ID that was enabled
   */
  async onPluginEnabled(pluginId: string): Promise<void> {
    await this.trigger('plugin:enable', { pluginId });
  }

  /**
   * Trigger invalidation for plugin disable
   * @param pluginId - Plugin ID that was disabled
   */
  async onPluginDisabled(pluginId: string): Promise<void> {
    await this.trigger('plugin:disable', { pluginId });
  }

  /**
   * Trigger invalidation for settings change
   */
  async onSettingsChanged(): Promise<void> {
    await this.trigger('settings:change');
  }

  /**
   * Trigger invalidation for marketplace refresh
   * @param marketplaceName - Optional marketplace name
   */
  async onMarketplaceRefreshed(marketplaceName?: string): Promise<void> {
    await this.trigger('marketplace:refresh', { marketplaceName });
  }

  /**
   * Trigger invalidation for marketplace addition
   * @param marketplaceName - Marketplace name that was added
   */
  async onMarketplaceAdded(marketplaceName: string): Promise<void> {
    await this.trigger('marketplace:add', { marketplaceName });
  }

  /**
   * Trigger invalidation for marketplace removal
   * @param marketplaceName - Marketplace name that was removed
   */
  async onMarketplaceRemoved(marketplaceName: string): Promise<void> {
    await this.trigger('marketplace:remove', { marketplaceName });
  }

  /**
   * Get all registered rules
   */
  getRules(): Map<HookTrigger, InvalidationRule[]> {
    return new Map(this.rules);
  }

  /**
   * Clear all registered rules
   */
  clearRules(): void {
    this.rules.clear();
  }

  /**
   * Get statistics for all namespaces (if using NamespacedCacheManager)
   */
  getStats(): unknown {
    if (this.isNamespaced) {
      return (this.cache as NamespacedCacheManager).getAllStats();
    }
    return (this.cache as CacheManager).getStats();
  }

  // Private methods

  private async trigger(
    trigger: HookTrigger,
    context?: Record<string, unknown>,
  ): Promise<void> {
    const rules = this.rules.get(trigger);
    if (!rules || rules.length === 0) return;

    for (const rule of rules) {
      // Check condition if provided
      if (rule.condition) {
        const shouldInvalidate = await rule.condition();
        if (!shouldInvalidate) continue;
      }

      // Invalidate all patterns
      for (const pattern of rule.patterns) {
        // Replace context variables in pattern
        const resolvedPattern = this.resolvePattern(pattern, context);
        this.invalidatePattern(resolvedPattern);
      }
    }
  }

  private resolvePattern(
    pattern: string,
    context?: Record<string, unknown>,
  ): string {
    if (!context) return pattern;

    let resolved = pattern;
    for (const [key, value] of Object.entries(context)) {
      resolved = resolved.replace(`{${key}}`, String(value));
    }
    return resolved;
  }

  private invalidatePattern(pattern: string): void {
    if (this.isNamespaced) {
      // Handle wildcard pattern that clears everything
      if (pattern === '*') {
        (this.cache as NamespacedCacheManager).clear();
        return;
      }

      // For namespaced cache, parse namespace from pattern
      const [namespace, ...keyParts] = pattern.split(':');
      if (keyParts.length > 0) {
        const keyPattern = keyParts.join(':');
        (this.cache as NamespacedCacheManager).invalidate(namespace, keyPattern);
      } else {
        // Clear entire namespace
        (this.cache as NamespacedCacheManager).invalidateNamespace(namespace);
      }
    } else {
      // For regular cache, invalidate by pattern
      (this.cache as CacheManager).invalidate(pattern);
    }
  }
}

/**
 * Plugin-specific cache invalidation utilities
 */
export class PluginCacheInvalidator {
  private hooks: CacheInvalidationHooks;

  constructor(hooks: CacheInvalidationHooks) {
    this.hooks = hooks;
  }

  /**
   * Invalidate cache for a specific plugin
   * @param pluginId - Plugin ID to invalidate
   */
  async invalidatePlugin(pluginId: string): Promise<void> {
    await this.hooks.onPluginUninstalled(pluginId);
  }

  /**
   * Invalidate cache for all plugins in a marketplace
   * @param marketplaceName - Marketplace name
   */
  async invalidateMarketplace(marketplaceName: string): Promise<void> {
    await this.hooks.onMarketplaceRemoved(marketplaceName);
  }

  /**
   * Invalidate all plugin caches
   */
  async invalidateAll(): Promise<void> {
    await this.hooks.onSettingsChanged();
  }

  /**
   * Create a scoped invalidator for a specific namespace
   * @param namespace - Namespace to scope to
   */
  scoped(namespace: string): ScopedInvalidator {
    return new ScopedInvalidator(this.hooks, namespace);
  }
}

/**
 * Scoped invalidator for a specific cache namespace
 */
class ScopedInvalidator {
  private hooks: CacheInvalidationHooks;
  private namespace: string;

  constructor(hooks: CacheInvalidationHooks, namespace: string) {
    this.hooks = hooks;
    this.namespace = namespace;
  }

  /**
   * Invalidate by pattern within the namespace
   * @param pattern - Pattern to invalidate
   */
  async invalidate(pattern: string): Promise<void> {
    const fullPattern = `${this.namespace}:${pattern}`;
    // Directly call invalidatePattern instead of registering a new rule
    // to avoid triggering other hooks
    (this.hooks as any).invalidatePattern(fullPattern);
  }

  /**
   * Invalidate entire namespace
   */
  async invalidateAll(): Promise<void> {
    // Directly invalidate the namespace
    (this.hooks as any).invalidatePattern(this.namespace);
  }
}

/**
 * Create a standard cache invalidation hooks instance
 * @param cache - Cache manager instance
 * @returns Configured hooks instance with standard rules
 */
export function createStandardHooks(
  cache: CacheManager | NamespacedCacheManager,
): CacheInvalidationHooks {
  const hooks = new CacheInvalidationHooks(cache);
  hooks.registerStandardHooks();
  return hooks;
}
