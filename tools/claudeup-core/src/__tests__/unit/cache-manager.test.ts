/**
 * Comprehensive unit tests for CacheManager
 * Tests LRU eviction, TTL expiration, statistics, and hooks
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CacheManager,
  NamespacedCacheManager,
} from '../../services/cache-manager.js';

describe('CacheManager', () => {
  let cache: CacheManager<string>;

  beforeEach(() => {
    cache = new CacheManager<string>({ maxSize: 3, enableStats: true });
  });

  describe('Basic operations', () => {
    it('should set and get values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should check key existence', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(false);
    });

    it('should delete keys', () => {
      cache.set('key1', 'value1');
      expect(cache.delete('key1')).toBe(true);
      expect(cache.has('key1')).toBe(false);
      expect(cache.delete('key1')).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.size()).toBe(0);
      expect(cache.has('key1')).toBe(false);
    });

    it('should return cache size', () => {
      expect(cache.size()).toBe(0);
      cache.set('key1', 'value1');
      expect(cache.size()).toBe(1);
      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2);
    });

    it('should list all keys', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      const keys = cache.keys();
      expect(keys).toHaveLength(2);
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
    });

    it('should list all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      const entries = cache.entries();
      expect(entries).toHaveLength(2);
      expect(entries).toContainEqual(['key1', 'value1']);
      expect(entries).toContainEqual(['key2', 'value2']);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used when max size exceeded', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Cache is full (maxSize: 3)
      expect(cache.size()).toBe(3);

      // Adding 4th item should evict key1 (LRU)
      cache.set('key4', 'value4');
      expect(cache.size()).toBe(3);
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key4')).toBe(true);
    });

    it('should update access order on get', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Access key1 to make it most recently used
      cache.get('key1');

      // Add 4th item - should evict key2 (now LRU)
      cache.set('key4', 'value4');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(false);
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });

    it('should update access order on set of existing key', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Update key1 to make it most recently used
      cache.set('key1', 'updated');

      // Add 4th item - should evict key2 (now LRU)
      cache.set('key4', 'value4');
      expect(cache.get('key1')).toBe('updated');
      expect(cache.has('key2')).toBe(false);
    });

    it('should track eviction count in stats', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      cache.set('key4', 'value4'); // Triggers eviction

      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      const cacheWithTTL = new CacheManager<string>({
        maxSize: 10,
        ttl: 50, // 50ms
      });

      cacheWithTTL.set('key1', 'value1');
      expect(cacheWithTTL.get('key1')).toBe('value1');

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 60));

      // Should be expired
      expect(cacheWithTTL.get('key1')).toBeUndefined();
      expect(cacheWithTTL.has('key1')).toBe(false);
    });

    it('should support per-entry TTL override', async () => {
      const cacheWithTTL = new CacheManager<string>({
        maxSize: 10,
        ttl: 50, // Default 50ms
      });

      cacheWithTTL.set('key1', 'value1'); // Uses default TTL
      cacheWithTTL.set('key2', 'value2', { ttl: 100 }); // 100ms TTL

      await new Promise(resolve => setTimeout(resolve, 60));

      // key1 expired, key2 still valid
      expect(cacheWithTTL.get('key1')).toBeUndefined();
      expect(cacheWithTTL.get('key2')).toBe('value2');

      await new Promise(resolve => setTimeout(resolve, 50));

      // Now key2 also expired
      expect(cacheWithTTL.get('key2')).toBeUndefined();
    });

    it('should cleanup expired entries', async () => {
      const cacheWithTTL = new CacheManager<string>({
        maxSize: 10,
        ttl: 50,
      });

      cacheWithTTL.set('key1', 'value1');
      cacheWithTTL.set('key2', 'value2');
      expect(cacheWithTTL.size()).toBe(2);

      await new Promise(resolve => setTimeout(resolve, 60));

      // Cleanup should remove expired entries
      const removed = cacheWithTTL.cleanup();
      expect(removed).toBe(2);
      expect(cacheWithTTL.size()).toBe(0);
    });

    it('should track expiration count in stats', async () => {
      const cacheWithTTL = new CacheManager<string>({
        maxSize: 10,
        ttl: 50,
        enableStats: true,
      });

      cacheWithTTL.set('key1', 'value1');
      await new Promise(resolve => setTimeout(resolve, 60));

      // Access to trigger expiration detection
      cacheWithTTL.get('key1');

      const stats = cacheWithTTL.getStats();
      expect(stats.expirations).toBe(1);
    });
  });

  describe('Pattern invalidation', () => {
    it('should invalidate by exact match', () => {
      cache.set('user:123', 'value1');
      cache.set('user:456', 'value2');

      const count = cache.invalidate('user:123');
      expect(count).toBe(1);
      expect(cache.has('user:123')).toBe(false);
      expect(cache.has('user:456')).toBe(true);
    });

    it('should invalidate by wildcard pattern', () => {
      cache.set('user:123', 'value1');
      cache.set('user:456', 'value2');
      cache.set('post:789', 'value3');

      const count = cache.invalidate('user:*');
      expect(count).toBe(2);
      expect(cache.has('user:123')).toBe(false);
      expect(cache.has('user:456')).toBe(false);
      expect(cache.has('post:789')).toBe(true);
    });

    it('should invalidate all with * pattern', () => {
      cache.set('user:123', 'value1');
      cache.set('post:456', 'value2');

      const count = cache.invalidate('*');
      expect(count).toBe(2);
      expect(cache.size()).toBe(0);
    });

    it('should support complex wildcard patterns', () => {
      cache.set('user:123:posts', 'value1');
      cache.set('user:456:posts', 'value2');
      cache.set('user:123:comments', 'value3');

      const count = cache.invalidate('user:*:posts');
      expect(count).toBe(2);
      expect(cache.has('user:123:posts')).toBe(false);
      expect(cache.has('user:456:posts')).toBe(false);
      expect(cache.has('user:123:comments')).toBe(true);
    });
  });

  describe('Statistics tracking', () => {
    it('should track hits and misses', () => {
      cache.set('key1', 'value1');

      cache.get('key1'); // Hit
      cache.get('key2'); // Miss
      cache.get('key1'); // Hit

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(66.67, 1);
    });

    it('should track cache size and max size', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(3);
    });

    it('should calculate hit rate correctly', () => {
      const stats1 = cache.getStats();
      expect(stats1.hitRate).toBe(0); // No requests yet

      cache.set('key1', 'value1');
      cache.get('key1'); // 100% hit rate

      const stats2 = cache.getStats();
      expect(stats2.hitRate).toBe(100);
    });

    it('should reset statistics', () => {
      cache.set('key1', 'value1');
      cache.get('key1');
      cache.get('key2');

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.evictions).toBe(0);
      expect(stats.expirations).toBe(0);
    });

    it('should not track stats when disabled', () => {
      const cacheNoStats = new CacheManager<string>({
        maxSize: 3,
        enableStats: false,
      });

      cacheNoStats.set('key1', 'value1');
      cacheNoStats.get('key1');
      cacheNoStats.get('key2');

      const stats = cacheNoStats.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('Invalidation hooks', () => {
    it('should trigger hooks on invalidate', () => {
      const hookFn = vi.fn();
      cache.onInvalidate(hookFn);

      cache.set('user:123', 'value1');
      cache.invalidate('user:123');

      expect(hookFn).toHaveBeenCalledWith('user:123');
    });

    it('should trigger hooks on clear', () => {
      const hookFn = vi.fn();
      cache.onInvalidate(hookFn);

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();

      expect(hookFn).toHaveBeenCalledTimes(2);
      expect(hookFn).toHaveBeenCalledWith('key1');
      expect(hookFn).toHaveBeenCalledWith('key2');
    });

    it('should trigger hooks for pattern invalidation', () => {
      const hookFn = vi.fn();
      cache.onInvalidate(hookFn);

      cache.set('user:123', 'value1');
      cache.set('user:456', 'value2');
      cache.invalidate('user:*');

      expect(hookFn).toHaveBeenCalledTimes(2);
    });

    it('should unregister hooks', () => {
      const hookFn = vi.fn();
      const unregister = cache.onInvalidate(hookFn);

      cache.set('key1', 'value1');
      cache.invalidate('key1');
      expect(hookFn).toHaveBeenCalledTimes(1);

      unregister();
      cache.set('key2', 'value2');
      cache.invalidate('key2');
      expect(hookFn).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should handle async hooks without blocking', async () => {
      const asyncHook = vi.fn().mockResolvedValue(undefined);
      cache.onInvalidate(asyncHook);

      cache.set('key1', 'value1');
      cache.invalidate('key1'); // Should not await

      // Hook is called but cache operation completes immediately
      expect(cache.has('key1')).toBe(false);

      // Give async hook time to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(asyncHook).toHaveBeenCalled();
    });

    it('should handle hook errors gracefully', () => {
      const errorHook = vi.fn(() => {
        throw new Error('Hook error');
      });
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      cache.onInvalidate(errorHook);
      cache.set('key1', 'value1');

      // Should not throw
      expect(() => cache.invalidate('key1')).not.toThrow();
      expect(cache.has('key1')).toBe(false);
      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
    });
  });
});

describe('NamespacedCacheManager', () => {
  let cache: NamespacedCacheManager<string>;

  beforeEach(() => {
    cache = new NamespacedCacheManager<string>({
      maxSize: 5,
      enableStats: true,
    });
  });

  describe('Basic operations', () => {
    it('should set and get values in namespaces', () => {
      cache.set('users', 'user:123', 'value1');
      cache.set('posts', 'post:456', 'value2');

      expect(cache.get('users', 'user:123')).toBe('value1');
      expect(cache.get('posts', 'post:456')).toBe('value2');
      expect(cache.get('users', 'post:456')).toBeUndefined();
    });

    it('should check key existence in namespace', () => {
      cache.set('users', 'user:123', 'value1');

      expect(cache.has('users', 'user:123')).toBe(true);
      expect(cache.has('users', 'user:456')).toBe(false);
      expect(cache.has('posts', 'user:123')).toBe(false);
    });

    it('should delete keys from namespace', () => {
      cache.set('users', 'user:123', 'value1');
      expect(cache.delete('users', 'user:123')).toBe(true);
      expect(cache.has('users', 'user:123')).toBe(false);
    });

    it('should list all namespaces', () => {
      cache.set('users', 'key1', 'value1');
      cache.set('posts', 'key2', 'value2');

      const namespaces = cache.namespaces();
      expect(namespaces).toHaveLength(2);
      expect(namespaces).toContain('users');
      expect(namespaces).toContain('posts');
    });
  });

  describe('Namespace invalidation', () => {
    it('should invalidate by pattern within namespace', () => {
      cache.set('users', 'user:123', 'value1');
      cache.set('users', 'user:456', 'value2');
      cache.set('posts', 'post:789', 'value3');

      const count = cache.invalidate('users', 'user:*');
      expect(count).toBe(2);
      expect(cache.has('users', 'user:123')).toBe(false);
      expect(cache.has('posts', 'post:789')).toBe(true);
    });

    it('should clear entire namespace', () => {
      cache.set('users', 'user:123', 'value1');
      cache.set('users', 'user:456', 'value2');
      cache.set('posts', 'post:789', 'value3');

      cache.invalidateNamespace('users');

      expect(cache.has('users', 'user:123')).toBe(false);
      expect(cache.has('users', 'user:456')).toBe(false);
      expect(cache.has('posts', 'post:789')).toBe(true);
    });

    it('should clear all namespaces', () => {
      cache.set('users', 'user:123', 'value1');
      cache.set('posts', 'post:456', 'value2');

      cache.clear();

      // Check namespaces first (before has() calls create them)
      expect(cache.namespaces()).toHaveLength(0);
      expect(cache.has('users', 'user:123')).toBe(false);
      expect(cache.has('posts', 'post:456')).toBe(false);
    });
  });

  describe('Statistics', () => {
    it('should track stats per namespace', () => {
      cache.set('users', 'key1', 'value1');
      cache.get('users', 'key1'); // Hit
      cache.get('users', 'key2'); // Miss

      const stats = cache.getStats('users');
      expect(stats).toBeDefined();
      expect(stats!.hits).toBe(1);
      expect(stats!.misses).toBe(1);
    });

    it('should get all stats', () => {
      cache.set('users', 'key1', 'value1');
      cache.set('posts', 'key2', 'value2');
      cache.get('users', 'key1');
      cache.get('posts', 'key2');

      const allStats = cache.getAllStats();
      expect(Object.keys(allStats)).toHaveLength(2);
      expect(allStats.users).toBeDefined();
      expect(allStats.posts).toBeDefined();
      expect(allStats.users.hits).toBe(1);
      expect(allStats.posts.hits).toBe(1);
    });
  });

  describe('Hooks', () => {
    it('should register hooks per namespace', () => {
      const hookFn = vi.fn();
      cache.onInvalidate('users', hookFn);

      cache.set('users', 'key1', 'value1');
      cache.invalidate('users', 'key1');

      expect(hookFn).toHaveBeenCalledWith('key1');
    });

    it('should not trigger hooks for other namespaces', () => {
      const userHook = vi.fn();
      const postHook = vi.fn();

      cache.onInvalidate('users', userHook);
      cache.onInvalidate('posts', postHook);

      cache.set('users', 'key1', 'value1');
      cache.invalidate('users', 'key1');

      expect(userHook).toHaveBeenCalled();
      expect(postHook).not.toHaveBeenCalled();
    });
  });
});
