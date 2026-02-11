/**
 * Cache Manager with LRU (Least Recently Used) eviction strategy
 *
 * Provides a thread-safe, configurable caching layer with:
 * - LRU eviction when cache reaches max capacity
 * - TTL (Time To Live) support for automatic expiration
 * - Namespace support for logical grouping
 * - Cache statistics tracking
 * - Hook system for invalidation events
 *
 * @example
 * ```typescript
 * const cache = new CacheManager({ maxSize: 100, ttl: 60000 });
 * cache.set('user:123', userData);
 * const data = cache.get('user:123');
 * cache.invalidate('user:*'); // Invalidate by pattern
 * ```
 */

export interface CacheOptions {
  /** Maximum number of entries before LRU eviction (default: 1000) */
  maxSize?: number;
  /** Time to live in milliseconds (default: undefined = no expiration) */
  ttl?: number;
  /** Enable statistics tracking (default: true) */
  enableStats?: boolean;
}

export interface CacheEntry<T> {
  /** Cached value */
  value: T;
  /** Timestamp when entry was created */
  createdAt: number;
  /** Timestamp when entry was last accessed */
  accessedAt: number;
  /** Timestamp when entry expires (undefined = no expiration) */
  expiresAt?: number;
}

export interface CacheStats {
  /** Total number of get() calls */
  hits: number;
  /** Number of get() calls that returned a value */
  misses: number;
  /** Current number of entries in cache */
  size: number;
  /** Maximum allowed entries */
  maxSize: number;
  /** Number of entries evicted due to LRU */
  evictions: number;
  /** Number of entries expired due to TTL */
  expirations: number;
  /** Hit rate as percentage */
  hitRate: number;
}

export type InvalidationHook = (key: string) => void | Promise<void>;

/**
 * LRU Cache Manager with TTL support and invalidation hooks
 */
export class CacheManager<T = unknown> {
  private cache = new Map<string, CacheEntry<T>>();
  private accessOrder: string[] = [];
  private maxSize: number;
  private ttl?: number;
  private enableStats: boolean;

  // Statistics
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0,
  };

  // Invalidation hooks
  private invalidationHooks: InvalidationHook[] = [];

  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.ttl = options.ttl;
    this.enableStats = options.enableStats ?? true;
  }

  /**
   * Get value from cache
   * @param key - Cache key
   * @returns Cached value or undefined if not found/expired
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      if (this.enableStats) this.stats.misses++;
      return undefined;
    }

    // Check if expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.delete(key);
      if (this.enableStats) {
        this.stats.misses++;
        this.stats.expirations++;
      }
      return undefined;
    }

    // Update access order (move to end = most recently used)
    this.updateAccessOrder(key);
    entry.accessedAt = Date.now();

    if (this.enableStats) this.stats.hits++;
    return entry.value;
  }

  /**
   * Set value in cache
   * @param key - Cache key
   * @param value - Value to cache
   * @param options - Optional TTL override
   */
  set(key: string, value: T, options?: { ttl?: number }): void {
    const now = Date.now();
    const ttl = options?.ttl ?? this.ttl;

    const entry: CacheEntry<T> = {
      value,
      createdAt: now,
      accessedAt: now,
      expiresAt: ttl ? now + ttl : undefined,
    };

    // If key already exists, update access order
    if (this.cache.has(key)) {
      this.cache.set(key, entry);
      this.updateAccessOrder(key);
      return;
    }

    // Check if we need to evict (LRU)
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    // Add new entry
    this.cache.set(key, entry);
    this.accessOrder.push(key);
  }

  /**
   * Check if key exists in cache (without updating access order)
   * @param key - Cache key
   * @returns true if key exists and not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.delete(key);
      if (this.enableStats) this.stats.expirations++;
      return false;
    }

    return true;
  }

  /**
   * Delete entry from cache
   * @param key - Cache key
   * @returns true if entry was deleted
   */
  delete(key: string): boolean {
    const existed = this.cache.delete(key);
    if (existed) {
      this.accessOrder = this.accessOrder.filter(k => k !== key);
    }
    return existed;
  }

  /**
   * Invalidate cache entries by pattern
   * Supports wildcards: 'user:*', '*:123', 'user:*:posts'
   * @param pattern - Pattern to match (supports * wildcard)
   * @returns Number of entries invalidated
   */
  invalidate(pattern: string): number {
    const regex = this.patternToRegex(pattern);
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    }

    // Trigger invalidation hooks
    for (const key of keysToDelete) {
      this.triggerInvalidationHooks(key);
      this.delete(key);
    }

    return keysToDelete.length;
  }

  /**
   * Clear all entries from cache
   */
  clear(): void {
    // Trigger hooks for all keys
    for (const key of this.cache.keys()) {
      this.triggerInvalidationHooks(key);
    }

    this.cache.clear();
    this.accessOrder = [];
  }

  /**
   * Get cache statistics
   * @returns Cache statistics object
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      size: this.cache.size,
      maxSize: this.maxSize,
      evictions: this.stats.evictions,
      expirations: this.stats.expirations,
      hitRate: Math.round(hitRate * 100) / 100,
    };
  }

  /**
   * Reset statistics counters
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
    };
  }

  /**
   * Register a hook to be called when entries are invalidated
   * @param hook - Function to call on invalidation
   * @returns Unregister function
   */
  onInvalidate(hook: InvalidationHook): () => void {
    this.invalidationHooks.push(hook);
    return () => {
      this.invalidationHooks = this.invalidationHooks.filter(h => h !== hook);
    };
  }

  /**
   * Get all cache keys
   * @returns Array of all cache keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get all cache entries
   * @returns Array of [key, value] tuples
   */
  entries(): Array<[string, T]> {
    const entries: Array<[string, T]> = [];
    for (const [key, entry] of this.cache) {
      // Skip expired entries
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        continue;
      }
      entries.push([key, entry.value]);
    }
    return entries;
  }

  /**
   * Get cache size
   * @returns Number of entries in cache
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Cleanup expired entries
   * @returns Number of entries removed
   */
  cleanup(): number {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache) {
      if (entry.expiresAt && now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.delete(key);
    }

    if (this.enableStats) {
      this.stats.expirations += keysToDelete.length;
    }

    return keysToDelete.length;
  }

  // Private methods

  private updateAccessOrder(key: string): void {
    // Remove key from current position
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    // Add to end (most recently used)
    this.accessOrder.push(key);
  }

  private evictLRU(): void {
    // Remove least recently used (first in access order)
    const lruKey = this.accessOrder.shift();
    if (lruKey) {
      this.cache.delete(lruKey);
      if (this.enableStats) this.stats.evictions++;
    }
  }

  private patternToRegex(pattern: string): RegExp {
    // Escape special regex characters except *
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    // Convert * to .*
    const regexPattern = escaped.replace(/\*/g, '.*');
    return new RegExp(`^${regexPattern}$`);
  }

  private triggerInvalidationHooks(key: string): void {
    for (const hook of this.invalidationHooks) {
      try {
        // Call hook (async hooks are fire-and-forget)
        void hook(key);
      } catch (error) {
        // Silently ignore hook errors to prevent cache operations from failing
        console.error(`Cache invalidation hook error for key ${key}:`, error);
      }
    }
  }
}

/**
 * Namespaced cache manager for organizing related cache entries
 *
 * @example
 * ```typescript
 * const cache = new NamespacedCacheManager({ maxSize: 500 });
 * cache.set('users', 'user:123', userData);
 * cache.get('users', 'user:123');
 * cache.invalidateNamespace('users'); // Clear all user cache
 * ```
 */
export class NamespacedCacheManager<T = unknown> {
  private caches = new Map<string, CacheManager<T>>();
  private globalOptions: CacheOptions;

  constructor(options: CacheOptions = {}) {
    this.globalOptions = options;
  }

  /**
   * Get or create a cache for a namespace
   * @param namespace - Namespace identifier
   * @returns Cache manager for namespace
   */
  private getCache(namespace: string): CacheManager<T> {
    let cache = this.caches.get(namespace);
    if (!cache) {
      cache = new CacheManager<T>(this.globalOptions);
      this.caches.set(namespace, cache);
    }
    return cache;
  }

  /**
   * Get value from namespaced cache
   */
  get(namespace: string, key: string): T | undefined {
    return this.getCache(namespace).get(key);
  }

  /**
   * Set value in namespaced cache
   */
  set(namespace: string, key: string, value: T, options?: { ttl?: number }): void {
    this.getCache(namespace).set(key, value, options);
  }

  /**
   * Check if key exists in namespace
   */
  has(namespace: string, key: string): boolean {
    return this.getCache(namespace).has(key);
  }

  /**
   * Delete key from namespace
   */
  delete(namespace: string, key: string): boolean {
    return this.getCache(namespace).delete(key);
  }

  /**
   * Invalidate by pattern within namespace
   */
  invalidate(namespace: string, pattern: string): number {
    return this.getCache(namespace).invalidate(pattern);
  }

  /**
   * Clear entire namespace
   */
  invalidateNamespace(namespace: string): void {
    const cache = this.caches.get(namespace);
    if (cache) {
      cache.clear();
      this.caches.delete(namespace);
    }
  }

  /**
   * Clear all namespaces
   */
  clear(): void {
    // First clear each cache's contents
    for (const cache of this.caches.values()) {
      cache.clear();
    }
    // Then remove all namespace entries
    this.caches.clear();
  }

  /**
   * Get statistics for a namespace
   */
  getStats(namespace: string): CacheStats | undefined {
    const cache = this.caches.get(namespace);
    return cache?.getStats();
  }

  /**
   * Get statistics for all namespaces
   */
  getAllStats(): Record<string, CacheStats> {
    const stats: Record<string, CacheStats> = {};
    for (const [namespace, cache] of this.caches) {
      stats[namespace] = cache.getStats();
    }
    return stats;
  }

  /**
   * Register invalidation hook for a namespace
   */
  onInvalidate(namespace: string, hook: InvalidationHook): () => void {
    return this.getCache(namespace).onInvalidate(hook);
  }

  /**
   * Get all namespaces
   */
  namespaces(): string[] {
    return Array.from(this.caches.keys());
  }

  /**
   * Get total size across all namespaces
   */
  size(): number {
    let total = 0;
    for (const cache of this.caches.values()) {
      total += cache.size();
    }
    return total;
  }
}
