
import { Logger } from '@ai-platform/shared-utils';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

export interface CacheConfig {
  enableCaching: boolean;
  defaultTtl: number;
  maxCacheSize: number;
  maxItemSize: number;
  compressionEnabled: boolean;
  compressionThreshold: number;
  evictionPolicy: 'lru' | 'lfu' | 'fifo' | 'random';
  persistToDisk: boolean;
  diskCachePath?: string;
  warmupStrategies: string[];
}

export interface CacheItem {
  key: string;
  value: any;
  compressed: boolean;
  size: number;
  createdAt: Date;
  lastAccessed: Date;
  accessCount: number;
  ttl: number;
  expiresAt: Date;
  metadata: Record<string, any>;
}

export interface CacheStrategy {
  id: string;
  name: string;
  description: string;
  shouldCache: (key: string, value: any, metadata?: Record<string, any>) => boolean;
  getTtl: (key: string, value: any, metadata?: Record<string, any>) => number;
  getKey: (request: any) => string;
  priority: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  hitRate: number;
  totalSize: number;
  itemCount: number;
  compressionRatio: number;
  averageAccessTime: number;
  strategies: Map<string, number>;
}

export interface WarmupConfig {
  enabled: boolean;
  maxWarmupSize: number;
  warmupDelay: number;
  popularityThreshold: number;
  patterns: string[];
}

export class ResponseCacheService extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: CacheConfig;
  private cache: Map<string, CacheItem> = new Map();
  private accessOrder: string[] = [];
  private cacheStrategies: Map<string, CacheStrategy> = new Map();
  private keyPatterns: Map<string, RegExp> = new Map();
  
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    evictions: 0,
    hitRate: 0,
    totalSize: 0,
    itemCount: 0,
    compressionRatio: 0,
    averageAccessTime: 0,
    strategies: new Map()
  };

  private warmupConfig: WarmupConfig = {
    enabled: true,
    maxWarmupSize: 1000,
    warmupDelay: 5000,
    popularityThreshold: 5,
    patterns: []
  };

  constructor(config: Partial<CacheConfig> = {}) {
    super();
    this.logger = new Logger('ResponseCacheService');
    
    this.config = {
      enableCaching: true,
      defaultTtl: 3600000, // 1 hour
      maxCacheSize: 1000000000, // 1GB
      maxItemSize: 10000000, // 10MB
      compressionEnabled: true,
      compressionThreshold: 1024, // 1KB
      evictionPolicy: 'lru',
      persistToDisk: false,
      warmupStrategies: ['popular', 'recent', 'similar'],
      ...config
    };

    this.initializeCacheStrategies();
    this.startMaintenanceTasks();
  }

  /**
   * Initialize cache strategies
   */
  private initializeCacheStrategies(): void {
    // High-value response caching
    this.registerStrategy({
      id: 'high-value',
      name: 'High Value Response Caching',
      description: 'Cache expensive or frequently accessed responses',
      priority: 1,
      shouldCache: (key, value, metadata) => {
        return metadata?.processingTime > 1000 || // Expensive requests
               metadata?.frequency > 5; // Frequent requests
      },
      getTtl: (key, value, metadata) => {
        const processingTime = metadata?.processingTime || 0;
        const frequency = metadata?.frequency || 1;
        
        // Longer TTL for expensive operations
        let ttl = this.config.defaultTtl;
        if (processingTime > 5000) ttl *= 2;
        if (frequency > 10) ttl *= 1.5;
        
        return ttl;
      },
      getKey: (request) => this.generateCacheKey('high-value', request)
    });

    // Similar request caching
    this.registerStrategy({
      id: 'similar',
      name: 'Similar Request Caching',
      description: 'Cache responses for similar requests',
      priority: 2,
      shouldCache: (key, value, metadata) => {
        return metadata?.similarity > 0.8;
      },
      getTtl: (key, value, metadata) => {
        const similarity = metadata?.similarity || 0;
        return Math.floor(this.config.defaultTtl * similarity);
      },
      getKey: (request) => this.generateSimilarityKey(request)
    });

    // Provider-based caching
    this.registerStrategy({
      id: 'provider',
      name: 'Provider Response Caching',
      description: 'Cache responses per provider',
      priority: 3,
      shouldCache: (key, value, metadata) => {
        return metadata?.provider && metadata.stable;
      },
      getTtl: (key, value, metadata) => {
        // Different TTL per provider
        const providerTtl: Record<string, number> = {
          'openai': this.config.defaultTtl * 0.8,
          'claude': this.config.defaultTtl * 1.0,
          'gemini': this.config.defaultTtl * 0.6
        };
        
        return providerTtl[metadata?.provider] || this.config.defaultTtl;
      },
      getKey: (request) => this.generateProviderKey(request)
    });

    // User-specific caching
    this.registerStrategy({
      id: 'user',
      name: 'User-Specific Caching',
      description: 'Cache user-specific responses',
      priority: 4,
      shouldCache: (key, value, metadata) => {
        return metadata?.userId && metadata.personalizable;
      },
      getTtl: (key, value, metadata) => {
        // Shorter TTL for user-specific content
        return this.config.defaultTtl * 0.5;
      },
      getKey: (request) => this.generateUserKey(request)
    });

    // Generic caching
    this.registerStrategy({
      id: 'generic',
      name: 'Generic Response Caching',
      description: 'Cache all cacheable responses',
      priority: 10,
      shouldCache: (key, value, metadata) => {
        return !metadata?.nocache && value !== undefined;
      },
      getTtl: () => this.config.defaultTtl,
      getKey: (request) => this.generateGenericKey(request)
    });
  }

  /**
   * Register a custom cache strategy
   */
  registerStrategy(strategy: CacheStrategy): void {
    this.cacheStrategies.set(strategy.id, strategy);
    this.logger.info(`Registered cache strategy: ${strategy.name}`, {
      strategyId: strategy.id,
      priority: strategy.priority
    });
  }

  /**
   * Get cached response
   */
  async get(request: any, options: {
    strategy?: string;
    metadata?: Record<string, any>;
  } = {}): Promise<any> {
    
    if (!this.config.enableCaching) {
      this.stats.misses++;
      return null;
    }

    const startTime = Date.now();
    
    try {
      // Find applicable strategy
      const strategy = this.getApplicableStrategy(request, options.metadata);
      if (!strategy) {
        this.stats.misses++;
        return null;
      }

      const cacheKey = strategy.getKey(request);
      const item = this.cache.get(cacheKey);
      
      if (!item) {
        this.stats.misses++;
        this.updateStrategyMetrics(strategy.id, false);
        return null;
      }

      // Check expiration
      if (Date.now() > item.expiresAt.getTime()) {
        this.cache.delete(cacheKey);
        this.updateAccessOrder(cacheKey, false);
        this.stats.misses++;
        this.stats.evictions++;
        return null;
      }

      // Update access metrics
      item.lastAccessed = new Date();
      item.accessCount++;
      this.updateAccessOrder(cacheKey, true);

      // Decompress if needed
      let value = item.value;
      if (item.compressed) {
        value = await this.decompress(value);
      }

      this.stats.hits++;
      this.updateStrategyMetrics(strategy.id, true);
      
      const accessTime = Date.now() - startTime;
      this.stats.averageAccessTime = (this.stats.averageAccessTime + accessTime) / 2;

      this.emit('cacheHit', {
        key: cacheKey,
        strategy: strategy.id,
        accessTime,
        item: {
          size: item.size,
          age: Date.now() - item.createdAt.getTime(),
          accessCount: item.accessCount
        }
      });

      this.logger.debug('Cache hit', {
        key: cacheKey,
        strategy: strategy.id,
        accessTime,
        size: item.size
      });

      return value;

    } catch (error) {
      this.logger.error('Cache get error', {
        error: error.message,
        request: JSON.stringify(request).substring(0, 100)
      });
      
      this.stats.misses++;
      return null;
    }
  }

  /**
   * Set cached response
   */
  async set(
    request: any,
    value: any,
    options: {
      ttl?: number;
      strategy?: string;
      metadata?: Record<string, any>;
      compress?: boolean;
    } = {}
  ): Promise<boolean> {
    
    if (!this.config.enableCaching || value === undefined || value === null) {
      return false;
    }

    try {
      // Find applicable strategy
      const strategy = this.getApplicableStrategy(request, options.metadata);
      if (!strategy) {
        return false;
      }

      // Check if should cache
      const cacheKey = strategy.getKey(request);
      if (!strategy.shouldCache(cacheKey, value, options.metadata)) {
        return false;
      }

      // Calculate size
      const serializedValue = JSON.stringify(value);
      let itemValue = value;
      let compressed = false;
      let size = Buffer.byteLength(serializedValue, 'utf8');

      // Check size limits
      if (size > this.config.maxItemSize) {
        this.logger.warn('Item too large for cache', {
          key: cacheKey,
          size,
          maxSize: this.config.maxItemSize
        });
        return false;
      }

      // Compress if needed
      if (this.config.compressionEnabled && 
          size > this.config.compressionThreshold &&
          options.compress !== false) {
        
        try {
          itemValue = await this.compress(serializedValue);
          compressed = true;
          size = Buffer.byteLength(itemValue, 'utf8');
        } catch (compressionError) {
          this.logger.warn('Compression failed', {
            key: cacheKey,
            error: compressionError.message
          });
        }
      }

      // Get TTL
      const ttl = options.ttl || strategy.getTtl(cacheKey, value, options.metadata);
      const expiresAt = new Date(Date.now() + ttl);

      // Check if eviction is needed
      if (this.needsEviction(size)) {
        await this.evictItems(size);
      }

      // Create cache item
      const item: CacheItem = {
        key: cacheKey,
        value: itemValue,
        compressed,
        size,
        createdAt: new Date(),
        lastAccessed: new Date(),
        accessCount: 0,
        ttl,
        expiresAt,
        metadata: {
          strategy: strategy.id,
          originalSize: Buffer.byteLength(serializedValue, 'utf8'),
          ...options.metadata
        }
      };

      // Set in cache
      this.cache.set(cacheKey, item);
      this.updateAccessOrder(cacheKey, true);

      // Update stats
      this.stats.sets++;
      this.stats.itemCount = this.cache.size;
      this.stats.totalSize += size;
      this.updateCompressionRatio();

      this.emit('cacheSet', {
        key: cacheKey,
        strategy: strategy.id,
        size,
        compressed,
        ttl
      });

      this.logger.debug('Cache set', {
        key: cacheKey,
        strategy: strategy.id,
        size,
        compressed,
        ttl
      });

      return true;

    } catch (error) {
      this.logger.error('Cache set error', {
        error: error.message,
        request: JSON.stringify(request).substring(0, 100)
      });
      
      return false;
    }
  }

  /**
   * Delete cached response
   */
  async delete(request: any, options: {
    strategy?: string;
    pattern?: boolean;
  } = {}): Promise<boolean> {
    
    try {
      if (options.pattern) {
        return this.deleteByPattern(request);
      }

      const strategy = this.getApplicableStrategy(request);
      if (!strategy) {
        return false;
      }

      const cacheKey = strategy.getKey(request);
      const item = this.cache.get(cacheKey);
      
      if (!item) {
        return false;
      }

      this.cache.delete(cacheKey);
      this.updateAccessOrder(cacheKey, false);

      // Update stats
      this.stats.deletes++;
      this.stats.itemCount = this.cache.size;
      this.stats.totalSize -= item.size;

      this.emit('cacheDelete', {
        key: cacheKey,
        strategy: strategy.id,
        size: item.size
      });

      this.logger.debug('Cache delete', {
        key: cacheKey,
        size: item.size
      });

      return true;

    } catch (error) {
      this.logger.error('Cache delete error', {
        error: error.message
      });
      
      return false;
    }
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    const itemCount = this.cache.size;
    const totalSize = this.stats.totalSize;
    
    this.cache.clear();
    this.accessOrder.length = 0;
    
    this.stats.itemCount = 0;
    this.stats.totalSize = 0;

    this.emit('cacheClear', {
      itemCount,
      totalSize
    });

    this.logger.info('Cache cleared', {
      itemCount,
      totalSize
    });
  }

  /**
   * Warmup cache with popular content
   */
  async warmup(requests: any[], options: Partial<WarmupConfig> = {}): Promise<void> {
    const config = { ...this.warmupConfig, ...options };
    
    if (!config.enabled || requests.length === 0) {
      return;
    }

    this.logger.info('Starting cache warmup', {
      requestCount: requests.length,
      maxWarmupSize: config.maxWarmupSize
    });

    // Wait for warmup delay
    if (config.warmupDelay > 0) {
      await this.sleep(config.warmupDelay);
    }

    let warmedUp = 0;
    const maxWarmup = Math.min(requests.length, config.maxWarmupSize);

    for (let i = 0; i < maxWarmup; i++) {
      const request = requests[i];
      
      try {
        // Simulate processing and cache the result
        const result = await this.simulateProcessing(request);
        
        const success = await this.set(request, result, {
          metadata: {
            warmup: true,
            popularity: this.calculatePopularity(request),
            pattern: this.matchPatterns(request, config.patterns)
          }
        });

        if (success) {
          warmedUp++;
        }

        // Small delay between warmup requests
        if (i < maxWarmup - 1) {
          await this.sleep(10);
        }

      } catch (error) {
        this.logger.warn('Warmup request failed', {
          request: JSON.stringify(request).substring(0, 100),
          error: error.message
        });
      }
    }

    this.emit('warmupCompleted', {
      requestsProcessed: maxWarmup,
      successfulWarmups: warmedUp,
      cacheSize: this.cache.size
    });

    this.logger.info('Cache warmup completed', {
      warmedUp,
      total: maxWarmup,
      cacheSize: this.cache.size
    });
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    // Calculate hit rate
    const totalRequests = this.stats.hits + this.stats.misses;
    this.stats.hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;

    return { ...this.stats };
  }

  /**
   * Get cache entries matching pattern
   */
  getByPattern(pattern: string): CacheItem[] {
    const regex = new RegExp(pattern, 'i');
    const matches: CacheItem[] = [];

    for (const [key, item] of this.cache.entries()) {
      if (regex.test(key)) {
        matches.push({ ...item });
      }
    }

    return matches.sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime());
  }

  /**
   * Private helper methods
   */
  private getApplicableStrategy(request: any, metadata?: Record<string, any>): CacheStrategy | null {
    const strategies = Array.from(this.cacheStrategies.values())
      .sort((a, b) => a.priority - b.priority);

    for (const strategy of strategies) {
      const key = strategy.getKey(request);
      if (strategy.shouldCache(key, null, metadata)) {
        return strategy;
      }
    }

    return null;
  }

  private generateCacheKey(prefix: string, request: any): string {
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(request));
    return `${prefix}:${hash.digest('hex')}`;
  }

  private generateSimilarityKey(request: any): string {
    // Extract key features for similarity matching
    const features = {
      provider: request.provider,
      agent: request.agent,
      type: request.type,
      // Normalize content for similarity
      content: this.normalizeContent(request.content || request.query || request.input)
    };
    
    return this.generateCacheKey('similar', features);
  }

  private generateProviderKey(request: any): string {
    const providerFeatures = {
      provider: request.provider,
      agent: request.agent,
      content: request.content || request.query
    };
    
    return this.generateCacheKey('provider', providerFeatures);
  }

  private generateUserKey(request: any): string {
    const userFeatures = {
      userId: request.userId,
      type: request.type,
      content: request.content || request.query
    };
    
    return this.generateCacheKey('user', userFeatures);
  }

  private generateGenericKey(request: any): string {
    return this.generateCacheKey('generic', request);
  }

  private normalizeContent(content: string): string {
    if (!content) return '';
    
    return content
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim();
  }

  private needsEviction(newItemSize: number): boolean {
    return this.stats.totalSize + newItemSize > this.config.maxCacheSize;
  }

  private async evictItems(spaceNeeded: number): Promise<void> {
    let spaceFreed = 0;
    const evictedItems: string[] = [];

    while (spaceFreed < spaceNeeded && this.cache.size > 0) {
      const keyToEvict = this.selectEvictionKey();
      
      if (!keyToEvict) break;

      const item = this.cache.get(keyToEvict);
      if (item) {
        this.cache.delete(keyToEvict);
        this.updateAccessOrder(keyToEvict, false);
        
        spaceFreed += item.size;
        evictedItems.push(keyToEvict);
        
        this.stats.evictions++;
        this.stats.totalSize -= item.size;
      }
    }

    this.stats.itemCount = this.cache.size;

    if (evictedItems.length > 0) {
      this.emit('itemsEvicted', {
        count: evictedItems.length,
        spaceFreed,
        policy: this.config.evictionPolicy
      });

      this.logger.debug('Evicted cache items', {
        count: evictedItems.length,
        spaceFreed,
        policy: this.config.evictionPolicy
      });
    }
  }

  private selectEvictionKey(): string | null {
    switch (this.config.evictionPolicy) {
      case 'lru':
        return this.accessOrder[0] || null;
        
      case 'lfu':
        return this.selectLfuKey();
        
      case 'fifo':
        return this.selectFifoKey();
        
      case 'random':
        return this.selectRandomKey();
        
      default:
        return this.accessOrder[0] || null;
    }
  }

  private selectLfuKey(): string | null {
    let minAccess = Infinity;
    let keyToEvict: string | null = null;

    for (const [key, item] of this.cache.entries()) {
      if (item.accessCount < minAccess) {
        minAccess = item.accessCount;
        keyToEvict = key;
      }
    }

    return keyToEvict;
  }

  private selectFifoKey(): string | null {
    let oldestTime = Infinity;
    let keyToEvict: string | null = null;

    for (const [key, item] of this.cache.entries()) {
      if (item.createdAt.getTime() < oldestTime) {
        oldestTime = item.createdAt.getTime();
        keyToEvict = key;
      }
    }

    return keyToEvict;
  }

  private selectRandomKey(): string | null {
    const keys = Array.from(this.cache.keys());
    return keys.length > 0 ? keys[Math.floor(Math.random() * keys.length)] : null;
  }

  private updateAccessOrder(key: string, accessed: boolean): void {
    const index = this.accessOrder.indexOf(key);
    
    if (accessed) {
      if (index !== -1) {
        this.accessOrder.splice(index, 1);
      }
      this.accessOrder.push(key);
    } else {
      if (index !== -1) {
        this.accessOrder.splice(index, 1);
      }
    }
  }

  private updateStrategyMetrics(strategyId: string, hit: boolean): void {
    const current = this.stats.strategies.get(strategyId) || 0;
    this.stats.strategies.set(strategyId, current + (hit ? 1 : 0));
  }

  private updateCompressionRatio(): void {
    let totalOriginalSize = 0;
    let totalCompressedSize = 0;

    for (const item of this.cache.values()) {
      const originalSize = item.metadata.originalSize || item.size;
      totalOriginalSize += originalSize;
      totalCompressedSize += item.size;
    }

    this.stats.compressionRatio = totalOriginalSize > 0 ? 
      totalCompressedSize / totalOriginalSize : 1;
  }

  private async compress(data: string): Promise<string> {
    // Simple compression simulation (in real implementation, use zlib or similar)
    const compressed = Buffer.from(data).toString('base64');
    return `compressed:${compressed}`;
  }

  private async decompress(data: string): Promise<any> {
    // Simple decompression simulation
    if (typeof data === 'string' && data.startsWith('compressed:')) {
      const compressed = data.substring(11);
      const decompressed = Buffer.from(compressed, 'base64').toString('utf8');
      return JSON.parse(decompressed);
    }
    return data;
  }

  private deleteByPattern(pattern: any): boolean {
    let deletedCount = 0;
    const regex = new RegExp(pattern.toString(), 'i');

    for (const [key, item] of this.cache.entries()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        this.updateAccessOrder(key, false);
        this.stats.totalSize -= item.size;
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      this.stats.deletes += deletedCount;
      this.stats.itemCount = this.cache.size;
      
      this.logger.debug('Deleted items by pattern', {
        pattern: pattern.toString(),
        count: deletedCount
      });
    }

    return deletedCount > 0;
  }

  private async simulateProcessing(request: any): Promise<any> {
    // Simulate processing delay
    await this.sleep(100 + Math.random() * 200);
    
    return {
      result: `Processed request: ${JSON.stringify(request).substring(0, 50)}`,
      timestamp: new Date().toISOString(),
      cached: false,
      processingTime: 100 + Math.random() * 200
    };
  }

  private calculatePopularity(request: any): number {
    // Simple popularity calculation
    return Math.random() * 10;
  }

  private matchPatterns(request: any, patterns: string[]): string[] {
    const matches: string[] = [];
    const requestStr = JSON.stringify(request);
    
    for (const pattern of patterns) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(requestStr)) {
        matches.push(pattern);
      }
    }
    
    return matches;
  }

  private startMaintenanceTasks(): void {
    // Cleanup expired items every 5 minutes
    setInterval(() => {
      this.cleanupExpiredItems();
    }, 300000);

    // Update statistics every minute
    setInterval(() => {
      this.updateStatistics();
    }, 60000);

    this.logger.info('Started cache maintenance tasks');
  }

  private cleanupExpiredItems(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt.getTime()) {
        expiredKeys.push(key);
      }
    }

    let totalSize = 0;
    for (const key of expiredKeys) {
      const item = this.cache.get(key);
      if (item) {
        totalSize += item.size;
        this.cache.delete(key);
        this.updateAccessOrder(key, false);
      }
    }

    if (expiredKeys.length > 0) {
      this.stats.evictions += expiredKeys.length;
      this.stats.itemCount = this.cache.size;
      this.stats.totalSize -= totalSize;

      this.logger.debug('Cleaned up expired cache items', {
        count: expiredKeys.length,
        sizeFreed: totalSize
      });
    }
  }

  private updateStatistics(): void {
    // Update hit rate
    const totalRequests = this.stats.hits + this.stats.misses;
    this.stats.hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;

    // Update compression ratio
    this.updateCompressionRatio();

    this.emit('statisticsUpdated', this.getStats());
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Public API methods
   */

  /**
   * Check if key exists in cache
   */
  has(request: any): boolean {
    const strategy = this.getApplicableStrategy(request);
    if (!strategy) return false;
    
    const key = strategy.getKey(request);
    const item = this.cache.get(key);
    
    return item !== undefined && Date.now() <= item.expiresAt.getTime();
  }

  /**
   * Get cache size information
   */
  getSizeInfo(): {
    itemCount: number;
    totalSize: number;
    maxSize: number;
    utilizationPercent: number;
    averageItemSize: number;
  } {
    const averageItemSize = this.cache.size > 0 ? 
      this.stats.totalSize / this.cache.size : 0;

    return {
      itemCount: this.stats.itemCount,
      totalSize: this.stats.totalSize,
      maxSize: this.config.maxCacheSize,
      utilizationPercent: (this.stats.totalSize / this.config.maxCacheSize) * 100,
      averageItemSize
    };
  }

  /**
   * Update cache configuration
   */
  updateConfig(newConfig: Partial<CacheConfig>): void {
    Object.assign(this.config, newConfig);
    this.logger.info('Updated cache configuration', { newConfig });
  }

  /**
   * Update warmup configuration
   */
  updateWarmupConfig(newConfig: Partial<WarmupConfig>): void {
    Object.assign(this.warmupConfig, newConfig);
    this.logger.info('Updated warmup configuration', { newConfig });
  }

  /**
   * Force cleanup of expired items
   */
  forceCleanup(): number {
    const initialCount = this.cache.size;
    this.cleanupExpiredItems();
    return initialCount - this.cache.size;
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      hitRate: 0,
      totalSize: this.stats.totalSize, // Keep current size
      itemCount: this.stats.itemCount, // Keep current count
      compressionRatio: this.stats.compressionRatio, // Keep current ratio
      averageAccessTime: 0,
      strategies: new Map()
    };
    
    this.logger.info('Reset cache statistics');
  }

  /**
   * Get top accessed items
   */
  getTopAccessedItems(limit: number = 10): Array<{
    key: string;
    accessCount: number;
    lastAccessed: Date;
    size: number;
  }> {
    return Array.from(this.cache.values())
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, limit)
      .map(item => ({
        key: item.key,
        accessCount: item.accessCount,
        lastAccessed: item.lastAccessed,
        size: item.size
      }));
  }
}

export default ResponseCacheService;
