export type CacheKey = string | number;

export interface CacheEntry<T = any> {
  value: T;
  createdAt: number;
  lastAccessedAt: number;
  ttl?: number; // Time To Live in milliseconds
  accessCount: number;
}

export interface CacheOptions {
  maxCapacity: number;
  defaultTTL?: number;
  enableMetrics?: boolean;
}

export interface CacheStats {
  totalEntries: number;
  totalCapacity: number;
  hitCount: number;
  missCount: number;
  evictionCount: number;
  expirationCount: number;
  averageAccessTime: number;
}

export type CacheEventType =
  | 'set'           // Entry set/updated
  | 'get'           // Entry retrieved (hit or miss)
  | 'hit'           // Cache hit
  | 'miss'          // Cache miss
  | 'delete'        // Entry deleted
  | 'evict'         // LRU eviction
  | 'pre-evict'     // Before LRU eviction
  | 'expire'        // TTL expiration
  | 'clear'         // Cache cleared
  | 'update'        // Entry updated
  | 'promote';      // Entry promoted in LRU

export interface CacheEvent<T = any> {
  type: CacheEventType;
  key: CacheKey;
  entry?: CacheEntry<T>;
  metadata?: {
    timestamp: number;
    wasHit?: boolean;
    previousValue?: T;
    reason?: string;
  };
}

export interface ToolCacheRule {
  name: string;                    // Tool name (e.g., 'Read', 'Grep')
  enabled: boolean;                // Whether auto-caching is enabled
  keyGenerator: (params: any) => string; // Function to generate cache key
  ttl?: number;                    // TTL override (undefined uses default)
  validator?: (result: any) => boolean; // Function to validate cacheable results
  invalidateOn?: string[];         // Trigger invalidate on these events
}

export interface SessionCacheRepository {
  save(sessionId: string, entries: Map<CacheKey, CacheEntry>): Promise<void>;
  load(sessionId: string): Promise<Map<CacheKey, CacheEntry>>;
  cleanup(sessionId: string): Promise<void>;
}