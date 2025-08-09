
import { Request, Response, NextFunction } from 'express';
import { RedisCache, CacheKeys } from '@ai-platform/shared-utils';

export interface CacheMiddlewareConfig {
  cache: RedisCache;
  defaultTTL?: number;
  keyGenerator?: (req: Request) => string;
  shouldCache?: (req: Request, res: Response) => boolean;
  varyBy?: string[]; // Headers to vary cache by
  tags?: string[] | ((req: Request) => string[]);
}

export function cacheMiddleware(config: CacheMiddlewareConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { cache, defaultTTL = 300, keyGenerator, shouldCache, varyBy = [], tags } = config;
    
    // Skip caching for non-GET requests by default
    if (req.method !== 'GET') {
      return next();
    }

    // Check if response should be cached
    if (shouldCache && !shouldCache(req, res)) {
      return next();
    }

    try {
      // Generate cache key
      const cacheKey = keyGenerator ? keyGenerator(req) : generateDefaultCacheKey(req, varyBy);
      
      // Try to get cached response
      const cachedResponse = await cache.get(cacheKey);
      
      if (cachedResponse) {
        // Cache hit - return cached response
        const { statusCode, headers, data, timestamp } = cachedResponse;
        
        // Set headers
        Object.entries(headers).forEach(([key, value]) => {
          res.set(key, value as string);
        });
        
        // Add cache headers
        res.set('X-Cache', 'HIT');
        res.set('X-Cache-Key', cacheKey);
        res.set('X-Cached-At', new Date(timestamp).toISOString());
        
        return res.status(statusCode).json(data);
      }

      // Cache miss - continue to route handler
      res.set('X-Cache', 'MISS');
      res.set('X-Cache-Key', cacheKey);
      
      // Intercept response
      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);
      
      res.json = function(data: any) {
        cacheResponse(cache, cacheKey, res.statusCode, res.getHeaders(), data, defaultTTL, tags, req);
        return originalJson(data);
      };
      
      res.send = function(data: any) {
        cacheResponse(cache, cacheKey, res.statusCode, res.getHeaders(), data, defaultTTL, tags, req);
        return originalSend(data);
      };

      next();
    } catch (error) {
      console.error('[CacheMiddleware] Cache error:', error);
      next();
    }
  };
}

function generateDefaultCacheKey(req: Request, varyBy: string[]): string {
  const { method, path, query } = req;
  
  let key = `${method}:${path}`;
  
  // Add query parameters
  const queryKeys = Object.keys(query).sort();
  if (queryKeys.length > 0) {
    const queryString = queryKeys.map(k => `${k}=${query[k]}`).join('&');
    key += `?${queryString}`;
  }
  
  // Add vary headers
  if (varyBy.length > 0) {
    const varyValues = varyBy.map(header => req.get(header) || '').join('|');
    key += `:vary:${varyValues}`;
  }
  
  return key;
}

async function cacheResponse(
  cache: RedisCache,
  key: string,
  statusCode: number,
  headers: any,
  data: any,
  ttl: number,
  tags?: string[] | ((req: Request) => string[]),
  req?: Request
): Promise<void> {
  try {
    // Only cache successful responses
    if (statusCode < 200 || statusCode >= 300) {
      return;
    }

    const responseData = {
      statusCode,
      headers,
      data,
      timestamp: Date.now(),
    };

    const cacheTags = typeof tags === 'function' ? tags(req!) : tags;
    
    await cache.set(key, responseData, ttl, {
      tags: cacheTags,
      metadata: {
        url: req?.originalUrl,
        userAgent: req?.get('User-Agent'),
      },
    });
  } catch (error) {
    console.error('[CacheMiddleware] Error caching response:', error);
  }
}

// Auth-specific cache middleware configurations
export const authCacheConfigs = {
  userProfile: {
    keyGenerator: (req: Request) => CacheKeys.userProfile(req.params.userId || (req as any).user?.id),
    defaultTTL: 1800, // 30 minutes
    shouldCache: (req: Request) => !!req.params.userId || !!(req as any).user?.id,
    tags: ['user-data'],
  },

  userSessions: {
    keyGenerator: (req: Request) => CacheKeys.userSessions((req as any).user?.id),
    defaultTTL: 300, // 5 minutes
    shouldCache: (req: Request) => !!(req as any).user?.id,
    tags: ['user-sessions'],
  },

  publicEndpoints: {
    keyGenerator: (req: Request) => `public:${req.method}:${req.path}${req.url.includes('?') ? req.url.split('?')[1] : ''}`,
    defaultTTL: 3600, // 1 hour
    shouldCache: (req: Request) => req.method === 'GET' && !req.get('Authorization'),
    tags: ['public-data'],
  },
};

// Cache invalidation middleware
export function cacheInvalidationMiddleware(cache: RedisCache, patterns: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    
    const invalidateCache = async () => {
      try {
        for (const pattern of patterns) {
          let interpolatedPattern = pattern;
          
          // Replace placeholders with actual values
          if (req.params) {
            Object.entries(req.params).forEach(([key, value]) => {
              interpolatedPattern = interpolatedPattern.replace(`{${key}}`, value as string);
            });
          }
          
          if ((req as any).user?.id) {
            interpolatedPattern = interpolatedPattern.replace('{userId}', (req as any).user.id);
          }
          
          await cache.invalidateByPattern(interpolatedPattern);
        }
      } catch (error) {
        console.error('[CacheInvalidationMiddleware] Error invalidating cache:', error);
      }
    };

    res.json = function(data: any) {
      const result = originalJson(data);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        invalidateCache();
      }
      return result;
    };
    
    res.send = function(data: any) {
      const result = originalSend(data);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        invalidateCache();
      }
      return result;
    };

    next();
  };
}

// Response compression for cached data
export function cacheCompressionMiddleware(cache: RedisCache) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    
    res.json = function(data: any) {
      // Add compression hint for large responses
      const dataSize = JSON.stringify(data).length;
      if (dataSize > 1000) {
        res.set('X-Cache-Compress', 'true');
      }
      
      return originalJson(data);
    };

    next();
  };
}

// Cache warming middleware for specific routes
export function cacheWarmingMiddleware(cache: RedisCache, warmingData: Record<string, any>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Check if we should pre-warm related data
      const userId = req.params.userId || (req as any).user?.id;
      
      if (userId && warmingData) {
        // Warm user-related caches
        const userKey = CacheKeys.user(userId);
        const profileKey = CacheKeys.userProfile(userId);
        
        const promises = [];
        
        if (warmingData.userData) {
          promises.push(cache.set(userKey, warmingData.userData, 1800));
        }
        
        if (warmingData.profileData) {
          promises.push(cache.set(profileKey, warmingData.profileData, 1800));
        }
        
        await Promise.all(promises);
      }
    } catch (error) {
      console.error('[CacheWarmingMiddleware] Error warming cache:', error);
    }
    
    next();
  };
}
