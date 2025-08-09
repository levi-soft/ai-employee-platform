
import Redis from 'ioredis';
import { EventEmitter } from 'events';

export interface CacheConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
    keyPrefix?: string;
  };
  defaultTTL?: number; // seconds
  enableCompression?: boolean;
  enableMetrics?: boolean;
  maxMemoryPolicy?: 'noeviction' | 'allkeys-lru' | 'allkeys-lfu' | 'volatile-lru' | 'volatile-lfu' | 'allkeys-random' | 'volatile-random' | 'volatile-ttl';
  connectionPool?: {
    min?: number;
    max?: number;
    acquireTimeoutMillis?: number;
  };
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  hitRate: number;
  totalOperations: number;
  averageResponseTime: number;
  memoryUsage: number;
  keyCount: number;
  evictions: number;
  connections: number;
  uptime: number;
}

export interface CacheEntry<T = any> {
  value: T;
  ttl: number;
  createdAt: Date;
  accessCount: number;
  lastAccessed: Date;
  tags?: string[];
  metadata?: Record<string, any>;
}

export class RedisCache extends EventEmitter {
  private redis: Redis;
  private config: CacheConfig;
  private metrics: CacheMetrics;
  private startTime: Date;
  private operationTimes: number[] = [];

  constructor(config: CacheConfig) {
    super();
    this.config = {
      defaultTTL: 3600, // 1 hour
      enableCompression: false,
      enableMetrics: true,
      maxMemoryPolicy: 'allkeys-lru',
      ...config,
    };
    
    this.startTime = new Date();
    this.initializeMetrics();
    this.setupRedis();
  }

  private setupRedis(): void {
    this.redis = new Redis({
      host: this.config.redis.host,
      port: this.config.redis.port,
      password: this.config.redis.password,
      db: this.config.redis.db || 0,
      keyPrefix: this.config.redis.keyPrefix || 'cache:',
      retryDelayOnFailover: 1000,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keepAlive: 30000,
    });

    this.redis.on('connect', () => {
      console.log('[RedisCache] Connected to Redis');
      this.emit('connect');
    });

    this.redis.on('error', (error) => {
      console.error('[RedisCache] Redis error:', error);
      this.emit('error', error);
    });

    this.redis.on('ready', () => {
      this.configureRedis();
      this.emit('ready');
    });

    if (this.config.enableMetrics) {
      this.startMetricsCollection();
    }
  }

  private async configureRedis(): Promise<void> {
    try {
      // Set memory policy
      if (this.config.maxMemoryPolicy) {
        await this.redis.config('SET', 'maxmemory-policy', this.config.maxMemoryPolicy);
      }
      
      // Configure other Redis settings for optimal caching
      await this.redis.config('SET', 'save', ''); // Disable persistence for cache-only usage
      await this.redis.config('SET', 'appendonly', 'no'); // Disable AOF for performance
    } catch (error) {
      console.warn('[RedisCache] Could not configure Redis settings:', error);
    }
  }

  private initializeMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      totalOperations: 0,
      averageResponseTime: 0,
      memoryUsage: 0,
      keyCount: 0,
      evictions: 0,
      connections: 1,
      uptime: 0,
    };
  }

  private startMetricsCollection(): void {
    setInterval(async () => {
      await this.updateMetrics();
    }, 30000); // Update every 30 seconds
  }

  private async updateMetrics(): Promise<void> {
    try {
      const info = await this.redis.info('memory');
      const keyspace = await this.redis.info('keyspace');
      const stats = await this.redis.info('stats');

      // Parse memory info
      const memoryMatch = info.match(/used_memory:(\d+)/);
      if (memoryMatch) {
        this.metrics.memoryUsage = parseInt(memoryMatch[1]);
      }

      // Parse keyspace info
      const keyMatch = keyspace.match(/keys=(\d+)/);
      if (keyMatch) {
        this.metrics.keyCount = parseInt(keyMatch[1]);
      }

      // Parse stats
      const evictedMatch = stats.match(/evicted_keys:(\d+)/);
      if (evictedMatch) {
        this.metrics.evictions = parseInt(evictedMatch[1]);
      }

      // Calculate hit rate
      this.metrics.hitRate = this.metrics.totalOperations > 0 
        ? (this.metrics.hits / this.metrics.totalOperations) * 100 
        : 0;

      // Calculate average response time
      if (this.operationTimes.length > 0) {
        this.metrics.averageResponseTime = 
          this.operationTimes.reduce((sum, time) => sum + time, 0) / this.operationTimes.length;
        
        // Keep only recent operation times (last 1000)
        if (this.operationTimes.length > 1000) {
          this.operationTimes = this.operationTimes.slice(-1000);
        }
      }

      // Calculate uptime
      this.metrics.uptime = Date.now() - this.startTime.getTime();
    } catch (error) {
      console.error('[RedisCache] Error updating metrics:', error);
    }
  }

  private trackOperation(startTime: number, hit: boolean): void {
    if (!this.config.enableMetrics) return;

    const duration = Date.now() - startTime;
    this.operationTimes.push(duration);
    this.metrics.totalOperations++;
    
    if (hit) {
      this.metrics.hits++;
    } else {
      this.metrics.misses++;
    }
  }

  // Basic cache operations
  public async get<T = any>(key: string): Promise<T | null> {
    const startTime = Date.now();
    
    try {
      const data = await this.redis.get(key);
      
      if (data === null) {
        this.trackOperation(startTime, false);
        this.emit('miss', key);
        return null;
      }

      const parsed = JSON.parse(data);
      this.trackOperation(startTime, true);
      this.emit('hit', key);
      
      // Update access information if stored with metadata
      if (parsed.metadata) {
        await this.updateAccessInfo(key);
      }

      return parsed.value !== undefined ? parsed.value : parsed;
    } catch (error) {
      this.trackOperation(startTime, false);
      console.error(`[RedisCache] Error getting key ${key}:`, error);
      return null;
    }
  }

  public async set<T = any>(key: string, value: T, ttl?: number, options?: {
    tags?: string[];
    metadata?: Record<string, any>;
    compress?: boolean;
  }): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      const expirationTime = ttl || this.config.defaultTTL;
      const entry: CacheEntry<T> = {
        value,
        ttl: expirationTime!,
        createdAt: new Date(),
        accessCount: 0,
        lastAccessed: new Date(),
        tags: options?.tags,
        metadata: options?.metadata,
      };

      let serializedData = JSON.stringify(entry);
      
      // Compress if enabled and beneficial
      if ((options?.compress || this.config.enableCompression) && serializedData.length > 1000) {
        // In a real implementation, you'd use compression library like zlib
        // For now, we'll just mark it as compressed
        entry.metadata = { ...entry.metadata, compressed: true };
        serializedData = JSON.stringify(entry);
      }

      let result;
      if (expirationTime) {
        result = await this.redis.setex(key, expirationTime, serializedData);
      } else {
        result = await this.redis.set(key, serializedData);
      }

      // Add to tag indexes if tags provided
      if (options?.tags && options.tags.length > 0) {
        await this.addToTagIndexes(key, options.tags);
      }

      this.trackOperation(startTime, false);
      this.emit('set', key, value);
      
      return result === 'OK';
    } catch (error) {
      this.trackOperation(startTime, false);
      console.error(`[RedisCache] Error setting key ${key}:`, error);
      return false;
    }
  }

  public async del(key: string | string[]): Promise<number> {
    const startTime = Date.now();
    
    try {
      const keys = Array.isArray(key) ? key : [key];
      const result = await this.redis.del(...keys);
      
      // Remove from tag indexes
      for (const k of keys) {
        await this.removeFromTagIndexes(k);
      }
      
      this.trackOperation(startTime, false);
      this.emit('delete', keys);
      
      return result;
    } catch (error) {
      this.trackOperation(startTime, false);
      console.error(`[RedisCache] Error deleting key(s):`, error);
      return 0;
    }
  }

  public async exists(key: string | string[]): Promise<number> {
    const startTime = Date.now();
    
    try {
      const keys = Array.isArray(key) ? key : [key];
      const result = await this.redis.exists(...keys);
      
      this.trackOperation(startTime, true);
      return result;
    } catch (error) {
      this.trackOperation(startTime, false);
      console.error(`[RedisCache] Error checking existence:`, error);
      return 0;
    }
  }

  public async ttl(key: string): Promise<number> {
    try {
      return await this.redis.ttl(key);
    } catch (error) {
      console.error(`[RedisCache] Error getting TTL for ${key}:`, error);
      return -2; // Key doesn't exist
    }
  }

  public async expire(key: string, seconds: number): Promise<boolean> {
    try {
      const result = await this.redis.expire(key, seconds);
      return result === 1;
    } catch (error) {
      console.error(`[RedisCache] Error setting expiry for ${key}:`, error);
      return false;
    }
  }

  // Advanced cache operations
  public async mget<T = any>(keys: string[]): Promise<(T | null)[]> {
    const startTime = Date.now();
    
    try {
      const results = await this.redis.mget(...keys);
      const parsedResults: (T | null)[] = results.map((data, index) => {
        if (data === null) {
          this.emit('miss', keys[index]);
          return null;
        }
        
        try {
          const parsed = JSON.parse(data);
          this.emit('hit', keys[index]);
          return parsed.value !== undefined ? parsed.value : parsed;
        } catch {
          return null;
        }
      });
      
      this.trackOperation(startTime, parsedResults.some(r => r !== null));
      return parsedResults;
    } catch (error) {
      this.trackOperation(startTime, false);
      console.error('[RedisCache] Error in mget:', error);
      return new Array(keys.length).fill(null);
    }
  }

  public async mset<T = any>(keyValuePairs: Record<string, T>, ttl?: number): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      const pipeline = this.redis.pipeline();
      const entries = Object.entries(keyValuePairs);
      
      for (const [key, value] of entries) {
        const entry: CacheEntry<T> = {
          value,
          ttl: ttl || this.config.defaultTTL || 0,
          createdAt: new Date(),
          accessCount: 0,
          lastAccessed: new Date(),
        };
        
        const serializedData = JSON.stringify(entry);
        
        if (ttl) {
          pipeline.setex(key, ttl, serializedData);
        } else {
          pipeline.set(key, serializedData);
        }
      }
      
      const results = await pipeline.exec();
      this.trackOperation(startTime, false);
      
      return results?.every(result => result[1] === 'OK') || false;
    } catch (error) {
      this.trackOperation(startTime, false);
      console.error('[RedisCache] Error in mset:', error);
      return false;
    }
  }

  // Tag-based operations
  public async getByTag<T = any>(tag: string): Promise<Record<string, T>> {
    try {
      const keys = await this.redis.smembers(`tags:${tag}`);
      if (keys.length === 0) return {};
      
      const values = await this.mget<T>(keys);
      const result: Record<string, T> = {};
      
      keys.forEach((key, index) => {
        if (values[index] !== null) {
          result[key] = values[index];
        }
      });
      
      return result;
    } catch (error) {
      console.error(`[RedisCache] Error getting by tag ${tag}:`, error);
      return {};
    }
  }

  public async invalidateByTag(tag: string): Promise<number> {
    try {
      const keys = await this.redis.smembers(`tags:${tag}`);
      if (keys.length === 0) return 0;
      
      const deleted = await this.del(keys);
      await this.redis.del(`tags:${tag}`);
      
      this.emit('invalidateTag', tag, keys);
      return deleted;
    } catch (error) {
      console.error(`[RedisCache] Error invalidating tag ${tag}:`, error);
      return 0;
    }
  }

  public async invalidateByPattern(pattern: string): Promise<number> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length === 0) return 0;
      
      const deleted = await this.del(keys);
      this.emit('invalidatePattern', pattern, keys);
      
      return deleted;
    } catch (error) {
      console.error(`[RedisCache] Error invalidating pattern ${pattern}:`, error);
      return 0;
    }
  }

  // Hash operations for complex data structures
  public async hget<T = any>(key: string, field: string): Promise<T | null> {
    const startTime = Date.now();
    
    try {
      const data = await this.redis.hget(key, field);
      
      if (data === null) {
        this.trackOperation(startTime, false);
        return null;
      }

      const parsed = JSON.parse(data);
      this.trackOperation(startTime, true);
      
      return parsed;
    } catch (error) {
      this.trackOperation(startTime, false);
      console.error(`[RedisCache] Error in hget ${key}:${field}:`, error);
      return null;
    }
  }

  public async hset<T = any>(key: string, field: string, value: T, ttl?: number): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      const serializedData = JSON.stringify(value);
      const result = await this.redis.hset(key, field, serializedData);
      
      if (ttl) {
        await this.redis.expire(key, ttl);
      }
      
      this.trackOperation(startTime, false);
      return result >= 0;
    } catch (error) {
      this.trackOperation(startTime, false);
      console.error(`[RedisCache] Error in hset ${key}:${field}:`, error);
      return false;
    }
  }

  public async hgetall<T = any>(key: string): Promise<Record<string, T>> {
    const startTime = Date.now();
    
    try {
      const data = await this.redis.hgetall(key);
      const result: Record<string, T> = {};
      
      for (const [field, value] of Object.entries(data)) {
        try {
          result[field] = JSON.parse(value);
        } catch {
          result[field] = value as unknown as T;
        }
      }
      
      this.trackOperation(startTime, Object.keys(result).length > 0);
      return result;
    } catch (error) {
      this.trackOperation(startTime, false);
      console.error(`[RedisCache] Error in hgetall ${key}:`, error);
      return {};
    }
  }

  // List operations for queues and logs
  public async lpush<T = any>(key: string, ...values: T[]): Promise<number> {
    try {
      const serializedValues = values.map(v => JSON.stringify(v));
      return await this.redis.lpush(key, ...serializedValues);
    } catch (error) {
      console.error(`[RedisCache] Error in lpush ${key}:`, error);
      return 0;
    }
  }

  public async rpop<T = any>(key: string): Promise<T | null> {
    try {
      const data = await this.redis.rpop(key);
      if (!data) return null;
      
      return JSON.parse(data);
    } catch (error) {
      console.error(`[RedisCache] Error in rpop ${key}:`, error);
      return null;
    }
  }

  public async lrange<T = any>(key: string, start: number, stop: number): Promise<T[]> {
    try {
      const data = await this.redis.lrange(key, start, stop);
      return data.map(item => JSON.parse(item));
    } catch (error) {
      console.error(`[RedisCache] Error in lrange ${key}:`, error);
      return [];
    }
  }

  // Utility methods
  private async addToTagIndexes(key: string, tags: string[]): Promise<void> {
    const pipeline = this.redis.pipeline();
    
    for (const tag of tags) {
      pipeline.sadd(`tags:${tag}`, key);
    }
    
    await pipeline.exec();
  }

  private async removeFromTagIndexes(key: string): Promise<void> {
    try {
      // Get all tag sets and remove the key from them
      const tagPattern = 'tags:*';
      const tagKeys = await this.redis.keys(tagPattern);
      
      if (tagKeys.length > 0) {
        const pipeline = this.redis.pipeline();
        
        for (const tagKey of tagKeys) {
          pipeline.srem(tagKey, key);
        }
        
        await pipeline.exec();
      }
    } catch (error) {
      console.error(`[RedisCache] Error removing from tag indexes:`, error);
    }
  }

  private async updateAccessInfo(key: string): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      pipeline.hincrby(`${key}:meta`, 'accessCount', 1);
      pipeline.hset(`${key}:meta`, 'lastAccessed', new Date().toISOString());
      await pipeline.exec();
    } catch (error) {
      // Ignore errors for access info updates
    }
  }

  // Cache warming and preloading
  public async warmUp<T = any>(keyValuePairs: Record<string, T>, ttl?: number): Promise<void> {
    console.log(`[RedisCache] Warming up cache with ${Object.keys(keyValuePairs).length} entries`);
    
    const batchSize = 100;
    const entries = Object.entries(keyValuePairs);
    
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const batchObject = Object.fromEntries(batch);
      
      await this.mset(batchObject, ttl);
    }
    
    this.emit('warmUp', Object.keys(keyValuePairs));
  }

  public async flush(): Promise<void> {
    try {
      await this.redis.flushdb();
      this.emit('flush');
    } catch (error) {
      console.error('[RedisCache] Error flushing cache:', error);
    }
  }

  public getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  public async getSize(): Promise<{ keyCount: number; memoryUsage: number }> {
    try {
      const keyCount = await this.redis.dbsize();
      const info = await this.redis.info('memory');
      const memoryMatch = info.match(/used_memory:(\d+)/);
      const memoryUsage = memoryMatch ? parseInt(memoryMatch[1]) : 0;
      
      return { keyCount, memoryUsage };
    } catch (error) {
      console.error('[RedisCache] Error getting size:', error);
      return { keyCount: 0, memoryUsage: 0 };
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.redis.disconnect();
      this.emit('disconnect');
    } catch (error) {
      console.error('[RedisCache] Error disconnecting:', error);
    }
  }
}

// Factory function
export function createRedisCache(config: CacheConfig): RedisCache {
  return new RedisCache(config);
}

// Cache key generators
export const CacheKeys = {
  user: (userId: string) => `user:${userId}`,
  userProfile: (userId: string) => `user:profile:${userId}`,
  userPreferences: (userId: string) => `user:prefs:${userId}`,
  userSessions: (userId: string) => `user:sessions:${userId}`,
  
  ai: {
    agent: (agentId: string) => `ai:agent:${agentId}`,
    agentHealth: (agentId: string) => `ai:agent:health:${agentId}`,
    routing: (userId: string, capabilities: string) => `ai:routing:${userId}:${capabilities}`,
    capabilities: () => 'ai:capabilities:all',
    models: () => 'ai:models:all',
  },
  
  billing: {
    credits: (userId: string) => `billing:credits:${userId}`,
    usage: (userId: string, period: string) => `billing:usage:${userId}:${period}`,
    invoice: (invoiceId: string) => `billing:invoice:${invoiceId}`,
  },
  
  plugins: {
    installed: (userId: string) => `plugins:installed:${userId}`,
    marketplace: () => 'plugins:marketplace:all',
    plugin: (pluginId: string) => `plugins:plugin:${pluginId}`,
  },
  
  notifications: {
    preferences: (userId: string) => `notifications:prefs:${userId}`,
    templates: () => 'notifications:templates:all',
    queue: (userId: string) => `notifications:queue:${userId}`,
  },
};
