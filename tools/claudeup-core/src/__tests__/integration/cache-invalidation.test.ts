/**
 * Integration tests for cache invalidation hooks
 * Tests the interaction between CacheManager and CacheInvalidationHooks
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CacheManager,
  NamespacedCacheManager,
} from '../../services/cache-manager.js';
import {
  CacheInvalidationHooks,
  PluginCacheInvalidator,
  createStandardHooks,
} from '../../services/cache-hooks.js';

describe('Cache Invalidation Integration', () => {
  describe('CacheInvalidationHooks with CacheManager', () => {
    let cache: CacheManager<string>;
    let hooks: CacheInvalidationHooks;

    beforeEach(() => {
      cache = new CacheManager<string>({ maxSize: 100 });
      hooks = new CacheInvalidationHooks(cache);
    });

    it('should invalidate plugin availability on install', async () => {
      cache.set('plugins:available', 'list1');
      cache.set('plugins:installed:user', 'list2');
      cache.set('other:data', 'data');

      hooks.registerPluginInstallHook();
      await hooks.onPluginInstalled('plugin@marketplace');

      expect(cache.has('plugins:available')).toBe(false);
      expect(cache.has('plugins:installed:user')).toBe(false);
      expect(cache.has('other:data')).toBe(true);
    });

    it('should invalidate on plugin uninstall', async () => {
      cache.set('plugins:available', 'list1');
      cache.set('plugins:enabled:project', 'list2');
      cache.set('settings:project', 'settings');

      hooks.registerPluginUninstallHook();
      await hooks.onPluginUninstalled('plugin@marketplace');

      expect(cache.has('plugins:available')).toBe(false);
      expect(cache.has('settings:project')).toBe(false);
    });

    it('should invalidate all on settings change', async () => {
      cache.set('plugins:available', 'list');
      cache.set('marketplace:data', 'data');
      cache.set('random:key', 'value');

      hooks.registerSettingsChangeHook();
      await hooks.onSettingsChanged();

      expect(cache.size()).toBe(0);
    });

    it('should invalidate marketplace data on refresh', async () => {
      cache.set('marketplace:mag', 'data1');
      cache.set('marketplace:official', 'data2');
      cache.set('plugins:available', 'list');

      hooks.registerMarketplaceRefreshHook();
      await hooks.onMarketplaceRefreshed();

      expect(cache.has('marketplace:mag')).toBe(false);
      expect(cache.has('marketplace:official')).toBe(false);
      expect(cache.has('plugins:available')).toBe(false);
    });

    it('should support custom invalidation rules', async () => {
      cache.set('custom:key1', 'value1');
      cache.set('custom:key2', 'value2');
      cache.set('other:key', 'value3');

      hooks.registerRule('settings:change', {
        name: 'Custom rule',
        patterns: ['custom:*'],
      });

      await hooks.onSettingsChanged();

      expect(cache.has('custom:key1')).toBe(false);
      expect(cache.has('custom:key2')).toBe(false);
      expect(cache.has('other:key')).toBe(true);
    });

    it('should support conditional invalidation', async () => {
      cache.set('conditional:key', 'value');

      let shouldInvalidate = false;
      hooks.registerRule('settings:change', {
        name: 'Conditional rule',
        patterns: ['conditional:*'],
        condition: () => shouldInvalidate,
      });

      // First trigger - condition false
      await hooks.onSettingsChanged();
      expect(cache.has('conditional:key')).toBe(true);

      // Second trigger - condition true
      shouldInvalidate = true;
      await hooks.onSettingsChanged();
      expect(cache.has('conditional:key')).toBe(false);
    });

    it('should register all standard hooks', async () => {
      cache.set('plugins:available', 'list');
      cache.set('marketplace:data', 'data');

      hooks.registerStandardHooks();
      await hooks.onPluginInstalled('plugin@marketplace');

      expect(cache.has('plugins:available')).toBe(false);
    });
  });

  describe('CacheInvalidationHooks with NamespacedCacheManager', () => {
    let cache: NamespacedCacheManager<string>;
    let hooks: CacheInvalidationHooks;

    beforeEach(() => {
      cache = new NamespacedCacheManager<string>({ maxSize: 100 });
      hooks = new CacheInvalidationHooks(cache);
    });

    it('should invalidate namespaced cache on plugin install', async () => {
      cache.set('plugins', 'available', 'list1');
      cache.set('plugins', 'installed:user', 'list2');
      cache.set('marketplace', 'data', 'data');

      hooks.registerPluginInstallHook();
      await hooks.onPluginInstalled('plugin@marketplace');

      expect(cache.has('plugins', 'available')).toBe(false);
      expect(cache.has('plugins', 'installed:user')).toBe(false);
      expect(cache.has('marketplace', 'data')).toBe(true);
    });

    it('should clear entire namespace on invalidation', async () => {
      cache.set('plugins', 'key1', 'value1');
      cache.set('plugins', 'key2', 'value2');
      cache.set('marketplace', 'key3', 'value3');

      hooks.registerRule('settings:change', {
        name: 'Clear plugins namespace',
        patterns: ['plugins'], // No colon = clear entire namespace
      });

      await hooks.onSettingsChanged();

      expect(cache.has('plugins', 'key1')).toBe(false);
      expect(cache.has('plugins', 'key2')).toBe(false);
      expect(cache.has('marketplace', 'key3')).toBe(true);
    });

    it('should get statistics across namespaces', async () => {
      cache.set('plugins', 'key1', 'value1');
      cache.set('marketplace', 'key2', 'value2');
      cache.get('plugins', 'key1');

      const stats = hooks.getStats();
      expect(stats).toBeDefined();
      expect(typeof stats).toBe('object');
    });
  });

  describe('PluginCacheInvalidator', () => {
    let cache: NamespacedCacheManager<string>;
    let hooks: CacheInvalidationHooks;
    let invalidator: PluginCacheInvalidator;

    beforeEach(() => {
      cache = new NamespacedCacheManager<string>({ maxSize: 100 });
      hooks = createStandardHooks(cache);
      invalidator = new PluginCacheInvalidator(hooks);
    });

    it('should invalidate specific plugin', async () => {
      cache.set('plugins', 'available', 'list');
      cache.set('plugins', 'installed:user', 'data');

      await invalidator.invalidatePlugin('frontend@mag');

      expect(cache.has('plugins', 'available')).toBe(false);
    });

    it('should invalidate marketplace', async () => {
      cache.set('marketplace', 'mag:data', 'data1');
      cache.set('plugins', 'available', 'list');

      await invalidator.invalidateMarketplace('mag');

      expect(cache.has('marketplace', 'mag:data')).toBe(false);
      expect(cache.has('plugins', 'available')).toBe(false);
    });

    it('should invalidate all caches', async () => {
      cache.set('plugins', 'key1', 'value1');
      cache.set('marketplace', 'key2', 'value2');
      cache.set('settings', 'key3', 'value3');

      await invalidator.invalidateAll();

      expect(cache.size()).toBe(0);
    });

    it('should create scoped invalidator', async () => {
      cache.set('users', 'user:123', 'value1');
      cache.set('users', 'user:456', 'value2');
      cache.set('posts', 'post:789', 'value3');

      const scoped = invalidator.scoped('users');
      await scoped.invalidate('user:*');

      expect(cache.has('users', 'user:123')).toBe(false);
      expect(cache.has('users', 'user:456')).toBe(false);
      expect(cache.has('posts', 'post:789')).toBe(true);
    });

    it('should invalidate entire namespace with scoped invalidator', async () => {
      cache.set('users', 'key1', 'value1');
      cache.set('users', 'key2', 'value2');
      cache.set('posts', 'key3', 'value3');

      const scoped = invalidator.scoped('users');
      await scoped.invalidateAll();

      expect(cache.has('users', 'key1')).toBe(false);
      expect(cache.has('posts', 'key3')).toBe(true);
    });
  });

  describe('Real-world scenarios', () => {
    let cache: NamespacedCacheManager<unknown>;
    let hooks: CacheInvalidationHooks;

    beforeEach(() => {
      cache = new NamespacedCacheManager({ maxSize: 100 });
      hooks = createStandardHooks(cache);
    });

    it('should handle plugin installation workflow', async () => {
      // Initial state - cache populated
      cache.set('marketplace', 'mag:plugins', ['plugin1', 'plugin2']);
      cache.set('plugins', 'available', ['plugin1', 'plugin2']);
      cache.set('plugins', 'installed:user', []);

      // User installs plugin
      await hooks.onPluginInstalled('plugin1@mag');

      // Relevant caches should be invalidated
      expect(cache.has('plugins', 'available')).toBe(false);
      expect(cache.has('plugins', 'installed:user')).toBe(false);

      // Marketplace data should remain (unless explicitly invalidated)
      // This depends on the rule configuration
    });

    it('should handle marketplace refresh workflow', async () => {
      // Cache marketplace data
      cache.set('marketplace', 'mag:metadata', { name: 'MAG' });
      cache.set('marketplace', 'official:metadata', { name: 'Official' });
      cache.set('plugins', 'available', ['plugin1']);

      // Refresh marketplaces
      await hooks.onMarketplaceRefreshed('mag');

      // All marketplace data should be invalidated
      expect(cache.has('marketplace', 'mag:metadata')).toBe(false);
      expect(cache.has('plugins', 'available')).toBe(false);
    });

    it('should handle settings change workflow', async () => {
      // Populate various caches
      cache.set('plugins', 'available', ['plugin1']);
      cache.set('marketplace', 'data', { name: 'MAG' });
      cache.set('settings', 'user', { theme: 'dark' });

      // Settings changed - everything should be invalidated
      await hooks.onSettingsChanged();

      expect(cache.has('plugins', 'available')).toBe(false);
      expect(cache.has('marketplace', 'data')).toBe(false);
      expect(cache.has('settings', 'user')).toBe(false);
    });

    it('should handle concurrent invalidation requests', async () => {
      cache.set('plugins', 'available', ['plugin1', 'plugin2', 'plugin3']);

      // Simulate concurrent plugin installations
      await Promise.all([
        hooks.onPluginInstalled('plugin1@mag'),
        hooks.onPluginInstalled('plugin2@mag'),
        hooks.onPluginInstalled('plugin3@mag'),
      ]);

      // Cache should be invalidated (only once due to idempotency)
      expect(cache.has('plugins', 'available')).toBe(false);
    });

    it('should track invalidation patterns across events', async () => {
      const invalidatedKeys: string[] = [];

      cache.onInvalidate('plugins', (key) => {
        invalidatedKeys.push(key);
      });

      cache.set('plugins', 'available', 'list');
      cache.set('plugins', 'enabled:user', 'list');

      await hooks.onPluginInstalled('plugin@mag');

      expect(invalidatedKeys.length).toBeGreaterThan(0);
    });
  });

  describe('Performance and edge cases', () => {
    it('should handle large number of invalidation rules', async () => {
      const cache = new NamespacedCacheManager({ maxSize: 1000 });
      const hooks = new CacheInvalidationHooks(cache);

      // Register many rules
      for (let i = 0; i < 100; i++) {
        hooks.registerRule('settings:change', {
          name: `Rule ${i}`,
          patterns: [`namespace${i}:*`],
        });
      }

      // Populate cache
      for (let i = 0; i < 100; i++) {
        cache.set(`namespace${i}`, `key${i}`, `value${i}`);
      }

      // Trigger invalidation
      const startTime = Date.now();
      await hooks.onSettingsChanged();
      const duration = Date.now() - startTime;

      // Should complete reasonably quickly (< 100ms)
      expect(duration).toBeLessThan(100);
      expect(cache.size()).toBe(0);
    });

    it('should handle rules with no matching entries', async () => {
      const cache = new CacheManager({ maxSize: 100 });
      const hooks = new CacheInvalidationHooks(cache);

      hooks.registerRule('settings:change', {
        name: 'Non-existent pattern',
        patterns: ['nonexistent:*'],
      });

      // Should not throw
      await expect(hooks.onSettingsChanged()).resolves.toBeUndefined();
    });

    it('should handle async condition functions', async () => {
      const cache = new CacheManager({ maxSize: 100 });
      const hooks = new CacheInvalidationHooks(cache);

      cache.set('async:key', 'value');

      hooks.registerRule('settings:change', {
        name: 'Async condition',
        patterns: ['async:*'],
        condition: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return true;
        },
      });

      await hooks.onSettingsChanged();
      expect(cache.has('async:key')).toBe(false);
    });
  });
});
