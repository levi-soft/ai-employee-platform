
import { Logger } from '@ai-platform/shared-utils';
import { EventEmitter } from 'events';
import { createClient, RedisClientType } from 'redis';
import { IPreprocessedRequest } from '../pipeline/request-preprocessor';
import { IProcessedResponse } from '../pipeline/response-processor';

export interface ICacheConfig {
  ttl: number; // Time to live in seconds
  maxSize: number; // Maximum cache size in bytes
  compressionEnabled: boolean;
  encryptionEnabled: boolean;
  keyPrefix: string;
  evictionPolicy: 'lru' | 'lfu' | 'ttl';
}

export interface ICacheEntry {
  id: string;
  key: string;
  value: any;
  metadata: {
    size: number;
    hits: number;
    createdAt: Date;
    lastAccessedAt: Date;
    expiresAt: Date;
    compressed: boolean;
    encrypted: boolean;
    tags: string[];
  };
}

export interface ICacheStats {
  totalEntries: number;
  totalSize: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  evictionCount: number;
  memoryUsage: number;
}

export interface ICacheQuery {
  requestContent: string;
  requestType: string;
  parameters?: Record<string, any>;
  userId?: string;
  context?: Record<string, any>;
}

/**
 * Advanced request caching service with intelligent invalidation and optimization
 */
export class RequestCacheService extends EventEmitter {
  private logger: Logger;
  private redisClient: RedisClientType;
  private config: ICacheConfig;
  private localCache: Map<string, ICacheEntry> = new Map();
  private stats: ICacheStats;
  private readonly COMPRESSION_THRESHOLD = 1024; // Compress values larger than 1KB
  private readonly MAX_LOCAL_CACHE_SIZE = 100; // Maximum entries in local cache

  constructor(config?: Partial<ICacheConfig>) {
    super();
    this.logger = new Logger('RequestCache');
    
    this.config = {
      ttl: 3600, // 1 hour default
      maxSize: 100 * 1024 * 1024, // 100MB default
      compressionEnabled: true,
      encryptionEnabled: false,
      keyPrefix: 'ai_cache:',
      evictionPolicy: 'lru',
      ...config
    };

    this.stats = {
      totalEntries: 0,
      totalSize: 0,
      hitCount: 0,
      missCount: 0,
      hitRate: 0,
      evictionCount: 0,
      memoryUsage: 0
    };

    this.initializeRedisClient();
  }

  /**
   * Initialize Redis client
   */
  private async initializeRedisClient(): Promise<void> {
    try {
      this.redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        database: 2 // Use database 2 for caching
      });

      this.redisClient.on('error', (error) => {
        this.logger.error('Redis client error', { error: error.message });
      });

      this.redisClient.on('connect', () => {
        this.logger.info('Connected to Redis for caching');
      });

      await this.redisClient.connect();

      // Initialize cache statistics
      await this.loadStatistics();

    } catch (error) {
      this.logger.error('Failed to initialize Redis client', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get cached response for request
   */
  async getCachedResponse(request: IPreprocessedRequest): Promise<IProcessedResponse | null> {
    const cacheKey = this.generateCacheKey(request);
    
    try {
      // First, try local cache (L1)
      const localEntry = this.localCache.get(cacheKey);
      if (localEntry && !this.isExpired(localEntry)) {
        this.updateAccessMetadata(localEntry);
        this.stats.hitCount++;
        this.updateHitRate();
        
        this.logger.debug('Cache hit (local)', {
          requestId: request.id,
          cacheKey,
          age: Date.now() - localEntry.metadata.createdAt.getTime()
        });

        this.emit('cacheHit', { source: 'local', key: cacheKey, request });
        return this.deserializeResponse(localEntry.value);
      }

      // Try Redis cache (L2)
      if (this.redisClient?.isOpen) {
        const redisValue = await this.redisClient.get(cacheKey);
        if (redisValue) {
          const entry = JSON.parse(redisValue);
          const deserializedResponse = await this.deserializeCachedValue(entry);

          // Store in local cache for faster subsequent access
          this.setLocalCache(cacheKey, entry);

          this.stats.hitCount++;
          this.updateHitRate();

          this.logger.debug('Cache hit (Redis)', {
            requestId: request.id,
            cacheKey,
            size: entry.size
          });

          this.emit('cacheHit', { source: 'redis', key: cacheKey, request });
          return deserializedResponse;
        }
      }

      // Cache miss
      this.stats.missCount++;
      this.updateHitRate();

      this.logger.debug('Cache miss', {
        requestId: request.id,
        cacheKey
      });

      this.emit('cacheMiss', { key: cacheKey, request });
      return null;

    } catch (error) {
      this.logger.error('Failed to get cached response', {
        requestId: request.id,
        cacheKey,
        error: error instanceof Error ? error.message : String(error)
      });

      this.stats.missCount++;
      this.updateHitRate();
      return null;
    }
  }

  /**
   * Cache response for future requests
   */
  async cacheResponse(
    request: IPreprocessedRequest, 
    response: IProcessedResponse,
    options?: {
      ttl?: number;
      tags?: string[];
      priority?: number;
    }
  ): Promise<void> {
    const cacheKey = this.generateCacheKey(request);
    const ttl = options?.ttl || this.config.ttl;

    try {
      // Don't cache errors or low-quality responses
      if (!response.success || (response.metadata.qualityScore || 0) < 3.0) {
        this.logger.debug('Skipping cache for low-quality response', {
          requestId: request.id,
          success: response.success,
          qualityScore: response.metadata.qualityScore
        });
        return;
      }

      // Serialize and prepare for caching
      const serializedResponse = await this.serializeResponse(response);
      const cacheEntry = await this.createCacheEntry(
        cacheKey, 
        serializedResponse, 
        ttl,
        options?.tags || []
      );

      // Check cache size limits
      if (!await this.checkCacheCapacity(cacheEntry.metadata.size)) {
        await this.evictEntries(cacheEntry.metadata.size);
      }

      // Store in Redis
      if (this.redisClient?.isOpen) {
        await this.redisClient.setEx(
          cacheKey,
          ttl,
          JSON.stringify(cacheEntry)
        );
      }

      // Store in local cache if entry is small enough
      if (cacheEntry.metadata.size < this.COMPRESSION_THRESHOLD) {
        this.setLocalCache(cacheKey, cacheEntry);
      }

      // Update statistics
      this.stats.totalEntries++;
      this.stats.totalSize += cacheEntry.metadata.size;
      await this.saveStatistics();

      this.logger.info('Response cached successfully', {
        requestId: request.id,
        cacheKey,
        size: cacheEntry.metadata.size,
        ttl,
        qualityScore: response.metadata.qualityScore
      });

      this.emit('responseCached', { 
        key: cacheKey, 
        size: cacheEntry.metadata.size, 
        request, 
        response 
      });

    } catch (error) {
      this.logger.error('Failed to cache response', {
        requestId: request.id,
        cacheKey,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Invalidate cache entries
   */
  async invalidateCache(patterns?: {
    keys?: string[];
    tags?: string[];
    userId?: string;
    requestType?: string;
    olderThan?: Date;
  }): Promise<number> {
    let invalidatedCount = 0;

    try {
      if (patterns?.keys) {
        // Invalidate specific keys
        for (const key of patterns.keys) {
          const fullKey = key.startsWith(this.config.keyPrefix) ? key : `${this.config.keyPrefix}${key}`;
          
          if (this.localCache.delete(fullKey)) {
            invalidatedCount++;
          }

          if (this.redisClient?.isOpen) {
            const result = await this.redisClient.del(fullKey);
            invalidatedCount += result;
          }
        }
      }

      if (patterns?.tags || patterns?.userId || patterns?.requestType || patterns?.olderThan) {
        // Pattern-based invalidation (requires scanning)
        invalidatedCount += await this.invalidateByPatterns(patterns);
      }

      if (!patterns) {
        // Clear all cache
        this.localCache.clear();
        
        if (this.redisClient?.isOpen) {
          const keys = await this.redisClient.keys(`${this.config.keyPrefix}*`);
          if (keys.length > 0) {
            invalidatedCount = await this.redisClient.del(keys);
          }
        }
      }

      this.logger.info('Cache invalidated', {
        invalidatedCount,
        patterns: patterns ? Object.keys(patterns) : 'all'
      });

      this.emit('cacheInvalidated', { count: invalidatedCount, patterns });
      return invalidatedCount;

    } catch (error) {
      this.logger.error('Failed to invalidate cache', {
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStatistics(): Promise<ICacheStats> {
    try {
      // Update real-time statistics
      if (this.redisClient?.isOpen) {
        const info = await this.redisClient.info('memory');
        const memoryMatch = info.match(/used_memory:(\d+)/);
        if (memoryMatch) {
          this.stats.memoryUsage = parseInt(memoryMatch[1]);
        }
      }

      this.stats.totalEntries = this.localCache.size;
      
      // Calculate local cache size
      let localSize = 0;
      for (const entry of this.localCache.values()) {
        localSize += entry.metadata.size;
      }

      return {
        ...this.stats,
        totalSize: localSize
      };

    } catch (error) {
      this.logger.error('Failed to get cache statistics', {
        error: error instanceof Error ? error.message : String(error)
      });
      return this.stats;
    }
  }

  /**
   * Optimize cache performance
   */
  async optimizeCache(): Promise<{
    evictedEntries: number;
    compressedEntries: number;
    reorganizedSize: number;
  }> {
    const startTime = Date.now();
    let evictedEntries = 0;
    let compressedEntries = 0;
    let reorganizedSize = 0;

    try {
      this.logger.info('Starting cache optimization');

      // 1. Remove expired entries
      const expiredKeys: string[] = [];
      for (const [key, entry] of this.localCache.entries()) {
        if (this.isExpired(entry)) {
          expiredKeys.push(key);
        }
      }

      for (const key of expiredKeys) {
        this.localCache.delete(key);
        evictedEntries++;
      }

      // 2. Compress large entries
      for (const [key, entry] of this.localCache.entries()) {
        if (entry.metadata.size > this.COMPRESSION_THRESHOLD && !entry.metadata.compressed) {
          try {
            const compressed = await this.compressValue(entry.value);
            if (compressed.length < entry.value.length) {
              entry.value = compressed;
              entry.metadata.compressed = true;
              compressedEntries++;
              reorganizedSize += entry.metadata.size - compressed.length;
            }
          } catch (error) {
            // Skip compression if it fails
          }
        }
      }

      // 3. Apply eviction policy if needed
      if (this.localCache.size > this.MAX_LOCAL_CACHE_SIZE) {
        const toEvict = this.localCache.size - this.MAX_LOCAL_CACHE_SIZE;
        const sortedEntries = this.getSortedEntriesForEviction();
        
        for (let i = 0; i < toEvict && i < sortedEntries.length; i++) {
          this.localCache.delete(sortedEntries[i][0]);
          evictedEntries++;
        }
      }

      const optimizationTime = Date.now() - startTime;

      this.logger.info('Cache optimization completed', {
        evictedEntries,
        compressedEntries,
        reorganizedSize,
        optimizationTime
      });

      this.emit('cacheOptimized', { 
        evictedEntries, 
        compressedEntries, 
        reorganizedSize,
        optimizationTime
      });

      return { evictedEntries, compressedEntries, reorganizedSize };

    } catch (error) {
      this.logger.error('Cache optimization failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return { evictedEntries: 0, compressedEntries: 0, reorganizedSize: 0 };
    }
  }

  /**
   * Generate cache key for request
   */
  private generateCacheKey(request: IPreprocessedRequest): string {
    const normalizedRequest = request.normalizedRequest;
    
    // Create hash from request content and parameters
    const keyData = {
      type: normalizedRequest.type,
      content: normalizedRequest.content,
      parameters: this.normalizeParameters(normalizedRequest.parameters || {})
    };

    // Don't include user-specific data in key unless it affects the response
    const excludeUserSpecific = ['general', 'text_analysis', 'translation'].includes(normalizedRequest.type);
    if (!excludeUserSpecific && request.context.userId) {
      (keyData as any).userId = request.context.userId;
    }

    const keyString = JSON.stringify(keyData);
    const hash = this.generateHash(keyString);
    
    return `${this.config.keyPrefix}${hash}`;
  }

  /**
   * Normalize parameters for consistent caching
   */
  private normalizeParameters(parameters: Record<string, any>): Record<string, any> {
    const normalized: Record<string, any> = {};
    
    // Sort keys for consistent hashing
    const sortedKeys = Object.keys(parameters).sort();
    
    for (const key of sortedKeys) {
      const value = parameters[key];
      
      if (typeof value === 'object' && value !== null) {
        normalized[key] = this.normalizeParameters(value);
      } else {
        normalized[key] = value;
      }
    }
    
    return normalized;
  }

  /**
   * Generate hash for string
   */
  private generateHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Create cache entry
   */
  private async createCacheEntry(
    key: string, 
    value: any, 
    ttl: number, 
    tags: string[]
  ): Promise<ICacheEntry> {
    const serialized = JSON.stringify(value);
    const size = Buffer.byteLength(serialized, 'utf8');
    const now = new Date();
    
    return {
      id: this.generateEntryId(),
      key,
      value: serialized,
      metadata: {
        size,
        hits: 0,
        createdAt: now,
        lastAccessedAt: now,
        expiresAt: new Date(now.getTime() + ttl * 1000),
        compressed: false,
        encrypted: false,
        tags
      }
    };
  }

  /**
   * Serialize response for caching
   */
  private async serializeResponse(response: IProcessedResponse): Promise<any> {
    // Remove non-cacheable data
    const cacheable = {
      requestId: response.requestId,
      success: response.success,
      content: response.content,
      metadata: {
        ...response.metadata,
        cached: true,
        cacheTimestamp: new Date().toISOString()
      },
      usage: response.usage,
      context: {
        requestId: response.context.requestId,
        timestamp: response.context.timestamp
      }
    };

    return cacheable;
  }

  /**
   * Deserialize cached response
   */
  private deserializeResponse(cached: any): IProcessedResponse {
    return {
      ...cached,
      metadata: {
        ...cached.metadata,
        cached: true
      }
    };
  }

  /**
   * Deserialize cached value from Redis
   */
  private async deserializeCachedValue(entry: ICacheEntry): Promise<IProcessedResponse> {
    let value = entry.value;
    
    if (entry.metadata.compressed) {
      value = await this.decompressValue(value);
    }

    if (entry.metadata.encrypted) {
      value = await this.decryptValue(value);
    }

    return this.deserializeResponse(typeof value === 'string' ? JSON.parse(value) : value);
  }

  /**
   * Compress value
   */
  private async compressValue(value: any): Promise<string> {
    // In production, use actual compression library like zlib
    // For now, return as-is
    return JSON.stringify(value);
  }

  /**
   * Decompress value
   */
  private async decompressValue(value: string): Promise<any> {
    // In production, use actual decompression
    // For now, parse directly
    return JSON.parse(value);
  }

  /**
   * Encrypt value
   */
  private async encryptValue(value: any): Promise<string> {
    // In production, implement actual encryption
    return JSON.stringify(value);
  }

  /**
   * Decrypt value
   */
  private async decryptValue(value: string): Promise<any> {
    // In production, implement actual decryption
    return JSON.parse(value);
  }

  // Utility methods
  private isExpired(entry: ICacheEntry): boolean {
    return new Date() > entry.metadata.expiresAt;
  }

  private updateAccessMetadata(entry: ICacheEntry): void {
    entry.metadata.hits++;
    entry.metadata.lastAccessedAt = new Date();
  }

  private updateHitRate(): void {
    const total = this.stats.hitCount + this.stats.missCount;
    this.stats.hitRate = total > 0 ? this.stats.hitCount / total : 0;
  }

  private setLocalCache(key: string, entry: ICacheEntry): void {
    // Implement LRU eviction if cache is full
    if (this.localCache.size >= this.MAX_LOCAL_CACHE_SIZE) {
      const oldestKey = this.localCache.keys().next().value;
      this.localCache.delete(oldestKey);
    }
    
    this.localCache.set(key, entry);
  }

  private generateEntryId(): string {
    return `entry-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private async checkCacheCapacity(newEntrySize: number): Promise<boolean> {
    return (this.stats.totalSize + newEntrySize) <= this.config.maxSize;
  }

  private async evictEntries(requiredSpace: number): Promise<void> {
    const entries = this.getSortedEntriesForEviction();
    let freedSpace = 0;
    
    for (const [key, entry] of entries) {
      if (freedSpace >= requiredSpace) break;
      
      this.localCache.delete(key);
      if (this.redisClient?.isOpen) {
        await this.redisClient.del(key);
      }
      
      freedSpace += entry.metadata.size;
      this.stats.evictionCount++;
    }
  }

  private getSortedEntriesForEviction(): [string, ICacheEntry][] {
    const entries = Array.from(this.localCache.entries());
    
    switch (this.config.evictionPolicy) {
      case 'lru':
        return entries.sort((a, b) => 
          a[1].metadata.lastAccessedAt.getTime() - b[1].metadata.lastAccessedAt.getTime()
        );
      case 'lfu':
        return entries.sort((a, b) => a[1].metadata.hits - b[1].metadata.hits);
      case 'ttl':
        return entries.sort((a, b) => 
          a[1].metadata.expiresAt.getTime() - b[1].metadata.expiresAt.getTime()
        );
      default:
        return entries;
    }
  }

  private async invalidateByPatterns(patterns: any): Promise<number> {
    // This would require more sophisticated pattern matching in production
    // For now, return 0 as placeholder
    return 0;
  }

  private async loadStatistics(): Promise<void> {
    try {
      if (this.redisClient?.isOpen) {
        const statsData = await this.redisClient.get(`${this.config.keyPrefix}stats`);
        if (statsData) {
          this.stats = { ...this.stats, ...JSON.parse(statsData) };
        }
      }
    } catch (error) {
      // Use default stats if loading fails
    }
  }

  private async saveStatistics(): Promise<void> {
    try {
      if (this.redisClient?.isOpen) {
        await this.redisClient.setEx(
          `${this.config.keyPrefix}stats`,
          3600, // Save stats for 1 hour
          JSON.stringify(this.stats)
        );
      }
    } catch (error) {
      // Ignore save errors
    }
  }
}
