
import { Request, Response, NextFunction } from 'express';
import { RedisCache, CacheKeys } from '@ai-platform/shared-utils';

// User-specific cache configurations
export const userCacheConfigs = {
  userList: {
    keyGenerator: (req: Request) => {
      const { page = '1', limit = '10', search = '', role = '', sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
      return `users:list:page:${page}:limit:${limit}:search:${search}:role:${role}:sort:${sortBy}:${sortOrder}`;
    },
    defaultTTL: 300, // 5 minutes
    shouldCache: (req: Request) => req.method === 'GET' && req.path === '/api/users',
    tags: ['user-list', 'user-data'],
  },

  userProfile: {
    keyGenerator: (req: Request) => CacheKeys.userProfile(req.params.id),
    defaultTTL: 1800, // 30 minutes
    shouldCache: (req: Request) => req.method === 'GET' && !!req.params.id,
    tags: ['user-data', 'user-profile'],
    varyBy: ['authorization'], // Different cache for different requesting users
  },

  userActivity: {
    keyGenerator: (req: Request) => {
      const { page = '1', limit = '50', days = '30' } = req.query;
      return `user:activity:${req.params.id}:page:${page}:limit:${limit}:days:${days}`;
    },
    defaultTTL: 600, // 10 minutes
    shouldCache: (req: Request) => req.method === 'GET' && req.path.includes('/activity'),
    tags: ['user-activity'],
  },

  userStats: {
    keyGenerator: (req: Request) => `user:stats:${req.params.id}`,
    defaultTTL: 1800, // 30 minutes
    shouldCache: (req: Request) => req.method === 'GET' && req.path.includes('/statistics'),
    tags: ['user-stats', 'user-data'],
  },

  userPreferences: {
    keyGenerator: (req: Request) => CacheKeys.userPreferences(req.params.id),
    defaultTTL: 3600, // 1 hour
    shouldCache: (req: Request) => req.method === 'GET' && req.path.includes('/preferences'),
    tags: ['user-preferences'],
  },
};

// Cache invalidation patterns for user operations
export const userInvalidationPatterns = {
  userUpdate: [
    'user:{id}',
    'user:profile:{id}',
    'user:stats:{id}',
    'users:list:*',
  ],

  userDelete: [
    'user:{id}*',
    'users:list:*',
  ],

  roleUpdate: [
    'user:{id}',
    'user:profile:{id}',
    'users:list:*',
  ],

  preferencesUpdate: [
    'user:preferences:{id}',
    'user:profile:{id}',
  ],

  bulkUpdate: [
    'users:list:*',
    'user:stats:*',
  ],
};

// User-specific cache middleware factory
export function createUserCacheMiddleware(cache: RedisCache, configName: keyof typeof userCacheConfigs) {
  const config = userCacheConfigs[configName];
  
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || !config.shouldCache(req)) {
      return next();
    }

    try {
      const cacheKey = config.keyGenerator(req);
      const cachedData = await cache.get(cacheKey);

      if (cachedData) {
        res.set('X-Cache', 'HIT');
        res.set('X-Cache-Key', cacheKey);
        return res.json(cachedData);
      }

      res.set('X-Cache', 'MISS');
      res.set('X-Cache-Key', cacheKey);

      // Intercept response to cache it
      const originalJson = res.json.bind(res);
      res.json = function(data: any) {
        if (res.statusCode === 200) {
          cache.set(cacheKey, data, config.defaultTTL, {
            tags: config.tags,
            metadata: {
              userId: req.params.id,
              requestedBy: (req as any).user?.id,
              endpoint: req.originalUrl,
            },
          }).catch(error => {
            console.error('[UserCacheMiddleware] Error caching response:', error);
          });
        }
        return originalJson(data);
      };

      next();
    } catch (error) {
      console.error('[UserCacheMiddleware] Cache error:', error);
      next();
    }
  };
}

// User cache invalidation middleware
export function createUserInvalidationMiddleware(cache: RedisCache, patternName: keyof typeof userInvalidationPatterns) {
  const patterns = userInvalidationPatterns[patternName];
  
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    
    res.json = function(data: any) {
      const result = originalJson(data);
      
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Invalidate cache patterns asynchronously
        setImmediate(async () => {
          try {
            for (const pattern of patterns) {
              let interpolatedPattern = pattern;
              
              // Replace {id} with actual user ID
              if (req.params.id) {
                interpolatedPattern = interpolatedPattern.replace('{id}', req.params.id);
              }
              
              // Replace {userId} if present in request body or params
              const userIds = req.body?.userIds || [req.params.id].filter(Boolean);
              if (userIds.length === 1) {
                interpolatedPattern = interpolatedPattern.replace('{userId}', userIds[0]);
              }
              
              await cache.invalidateByPattern(interpolatedPattern);
            }
          } catch (error) {
            console.error('[UserInvalidationMiddleware] Error invalidating cache:', error);
          }
        });
      }
      
      return result;
    };

    next();
  };
}

// User data warming middleware
export function userCacheWarmingMiddleware(cache: RedisCache) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.params.id;
      
      if (userId && req.method === 'GET') {
        // Pre-warm related user data
        const warmingPromises = [];
        
        // Check if user profile is cached, if not, warm it
        const profileKey = CacheKeys.userProfile(userId);
        const profileExists = await cache.exists(profileKey);
        
        if (!profileExists) {
          // In a real scenario, you'd fetch this from the database
          // For now, we'll just mark it for warming
          res.set('X-Cache-Warm', 'profile-needed');
        }
        
        // Pre-warm user preferences if not cached
        const prefsKey = CacheKeys.userPreferences(userId);
        const prefsExists = await cache.exists(prefsKey);
        
        if (!prefsExists) {
          res.set('X-Cache-Warm', 'preferences-needed');
        }
      }
    } catch (error) {
      console.error('[UserWarmingMiddleware] Error in cache warming:', error);
    }
    
    next();
  };
}

// User activity cache middleware with time-based invalidation
export function userActivityCacheMiddleware(cache: RedisCache) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || !req.path.includes('/activity')) {
      return next();
    }

    const userId = req.params.id;
    const { days = '30' } = req.query;
    
    try {
      const cacheKey = `user:activity:${userId}:days:${days}`;
      const cachedActivity = await cache.get(cacheKey);

      if (cachedActivity) {
        // Check if cache is stale (older than 10 minutes)
        const cacheAge = Date.now() - cachedActivity.timestamp;
        const maxAge = 10 * 60 * 1000; // 10 minutes
        
        if (cacheAge < maxAge) {
          res.set('X-Cache', 'HIT');
          res.set('X-Cache-Age', Math.floor(cacheAge / 1000).toString());
          return res.json(cachedActivity.data);
        } else {
          // Cache is stale, refresh it
          await cache.del(cacheKey);
        }
      }

      res.set('X-Cache', 'MISS');

      const originalJson = res.json.bind(res);
      res.json = function(data: any) {
        if (res.statusCode === 200) {
          const cacheData = {
            data,
            timestamp: Date.now(),
          };
          
          cache.set(cacheKey, cacheData, 600, { // 10 minutes TTL
            tags: ['user-activity'],
            metadata: { userId, days },
          }).catch(error => {
            console.error('[UserActivityCache] Error caching activity:', error);
          });
        }
        return originalJson(data);
      };

      next();
    } catch (error) {
      console.error('[UserActivityCache] Cache error:', error);
      next();
    }
  };
}

// Permission-aware cache middleware
export function permissionAwareCacheMiddleware(cache: RedisCache) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') {
      return next();
    }

    const requestingUser = (req as any).user;
    const targetUserId = req.params.id;
    
    try {
      // Create permission-aware cache key
      let cacheKey = `${req.method}:${req.path}`;
      
      // Include requesting user's role and permissions in cache key
      if (requestingUser) {
        const permissionContext = `${requestingUser.role}:${requestingUser.id === targetUserId ? 'self' : 'other'}`;
        cacheKey += `:perm:${permissionContext}`;
      }
      
      const cachedResponse = await cache.get(cacheKey);
      
      if (cachedResponse) {
        res.set('X-Cache', 'HIT');
        res.set('X-Cache-Permission', 'aware');
        return res.json(cachedResponse);
      }

      res.set('X-Cache', 'MISS');

      const originalJson = res.json.bind(res);
      res.json = function(data: any) {
        if (res.statusCode === 200) {
          // Filter data based on permissions before caching
          let filteredData = data;
          
          // If not admin and not accessing own data, remove sensitive fields
          if (requestingUser?.role !== 'ADMIN' && requestingUser?.id !== targetUserId) {
            if (typeof filteredData === 'object' && filteredData !== null) {
              const { password, email, ...publicData } = filteredData;
              filteredData = publicData;
            }
          }
          
          cache.set(cacheKey, filteredData, 1800, {
            tags: ['user-data', 'permission-filtered'],
            metadata: {
              requestingUser: requestingUser?.id,
              targetUser: targetUserId,
              role: requestingUser?.role,
            },
          }).catch(error => {
            console.error('[PermissionCache] Error caching filtered data:', error);
          });
        }
        return originalJson(data);
      };

      next();
    } catch (error) {
      console.error('[PermissionCache] Cache error:', error);
      next();
    }
  };
}

// Bulk operation cache invalidation
export function bulkOperationCacheMiddleware(cache: RedisCache) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.body?.userIds || !Array.isArray(req.body.userIds)) {
      return next();
    }

    const originalJson = res.json.bind(res);
    
    res.json = function(data: any) {
      const result = originalJson(data);
      
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Invalidate cache for all affected users
        setImmediate(async () => {
          try {
            const userIds = req.body.userIds;
            const invalidationPromises = [];
            
            for (const userId of userIds) {
              invalidationPromises.push(
                cache.invalidateByPattern(`user:${userId}*`),
                cache.invalidateByPattern(`user:profile:${userId}*`),
                cache.invalidateByPattern(`user:stats:${userId}*`)
              );
            }
            
            // Also invalidate list caches
            invalidationPromises.push(
              cache.invalidateByPattern('users:list:*')
            );
            
            await Promise.all(invalidationPromises);
            console.log(`[BulkOperationCache] Invalidated cache for ${userIds.length} users`);
          } catch (error) {
            console.error('[BulkOperationCache] Error invalidating cache:', error);
          }
        });
      }
      
      return result;
    };

    next();
  };
}
