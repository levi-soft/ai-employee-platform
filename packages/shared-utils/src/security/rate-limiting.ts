
import { Request, Response, NextFunction } from 'express';

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  message: string;
  skipSuccessfulRequests: boolean;
  skipFailedRequests: boolean;
  keyGenerator: (req: Request) => string;
  skip: (req: Request) => boolean;
  onLimitReached?: (req: Request, res: Response) => void;
}

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

/**
 * In-memory rate limit store
 */
class MemoryStore {
  private store: RateLimitStore = {};
  private cleanupInterval: NodeJS.Timeout;
  
  constructor() {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }
  
  get(key: string): { count: number; resetTime: number } | undefined {
    return this.store[key];
  }
  
  set(key: string, value: { count: number; resetTime: number }): void {
    this.store[key] = value;
  }
  
  increment(key: string, windowMs: number): { count: number; resetTime: number } {
    const now = Date.now();
    const resetTime = now + windowMs;
    
    if (!this.store[key] || this.store[key].resetTime <= now) {
      // Create new entry or reset expired entry
      this.store[key] = { count: 1, resetTime };
    } else {
      // Increment existing entry
      this.store[key].count++;
    }
    
    return this.store[key];
  }
  
  reset(key: string): void {
    delete this.store[key];
  }
  
  private cleanup(): void {
    const now = Date.now();
    for (const key in this.store) {
      if (this.store[key].resetTime <= now) {
        delete this.store[key];
      }
    }
  }
  
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.store = {};
  }
}

// Global memory store instance
const globalStore = new MemoryStore();

const defaultRateLimitConfig: RateLimitConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100,
  message: 'Too many requests, please try again later',
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  keyGenerator: (req: Request) => {
    // Use IP address and user ID if available
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userId = (req as any).user?.id || '';
    return `${ip}:${userId}`;
  },
  skip: () => false
};

/**
 * Create rate limiting middleware
 */
export const createRateLimit = (config: Partial<RateLimitConfig> = {}) => {
  const finalConfig = { ...defaultRateLimitConfig, ...config };
  
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Check if request should be skipped
      if (finalConfig.skip(req)) {
        return next();
      }
      
      const key = finalConfig.keyGenerator(req);
      const result = globalStore.increment(key, finalConfig.windowMs);
      
      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', finalConfig.maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, finalConfig.maxRequests - result.count));
      res.setHeader('X-RateLimit-Reset', new Date(result.resetTime).toISOString());
      res.setHeader('X-RateLimit-Window', Math.ceil(finalConfig.windowMs / 1000));
      
      // Check if limit exceeded
      if (result.count > finalConfig.maxRequests) {
        // Call custom handler if provided
        if (finalConfig.onLimitReached) {
          finalConfig.onLimitReached(req, res);
        }
        
        return res.status(429).json({
          error: 'Too Many Requests',
          message: finalConfig.message,
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
        });
      }
      
      next();
    } catch (error) {
      console.error('Rate limiting error:', error);
      // Continue on error to avoid blocking legitimate requests
      next();
    }
  };
};

/**
 * IP-based rate limiting
 */
export const createIpRateLimit = (config?: Partial<RateLimitConfig>) => {
  return createRateLimit({
    ...config,
    keyGenerator: (req: Request) => req.ip || req.connection.remoteAddress || 'unknown'
  });
};

/**
 * User-based rate limiting
 */
export const createUserRateLimit = (config?: Partial<RateLimitConfig>) => {
  return createRateLimit({
    ...config,
    keyGenerator: (req: Request) => {
      const userId = (req as any).user?.id;
      if (!userId) {
        return req.ip || req.connection.remoteAddress || 'unknown';
      }
      return `user:${userId}`;
    }
  });
};

/**
 * API endpoint specific rate limiting
 */
export const createEndpointRateLimit = (endpoint: string, config?: Partial<RateLimitConfig>) => {
  return createRateLimit({
    ...config,
    keyGenerator: (req: Request) => {
      const base = req.ip || req.connection.remoteAddress || 'unknown';
      const userId = (req as any).user?.id || '';
      return `${endpoint}:${base}:${userId}`;
    }
  });
};

/**
 * Progressive rate limiting - increases restrictions for repeat offenders
 */
export const createProgressiveRateLimit = (config?: Partial<RateLimitConfig>) => {
  const progressiveStore = new Map<string, { violations: number; lastViolation: number }>();
  
  return createRateLimit({
    ...config,
    onLimitReached: (req: Request, res: Response) => {
      const key = config?.keyGenerator?.(req) || defaultRateLimitConfig.keyGenerator(req);
      const now = Date.now();
      const existing = progressiveStore.get(key);
      
      if (!existing || (now - existing.lastViolation) > 24 * 60 * 60 * 1000) {
        // First violation or more than 24 hours since last
        progressiveStore.set(key, { violations: 1, lastViolation: now });
      } else {
        // Repeat violation
        progressiveStore.set(key, { 
          violations: existing.violations + 1, 
          lastViolation: now 
        });
      }
      
      const violations = progressiveStore.get(key)?.violations || 1;
      
      // Increase restrictions based on violation count
      let multiplier = 1;
      if (violations >= 5) multiplier = 10;
      else if (violations >= 3) multiplier = 5;
      else if (violations >= 2) multiplier = 2;
      
      res.setHeader('X-RateLimit-Violations', violations);
      res.setHeader('X-RateLimit-Multiplier', multiplier);
      
      if (config?.onLimitReached) {
        config.onLimitReached(req, res);
      }
    }
  });
};

/**
 * Sliding window rate limiting
 */
export const createSlidingWindowRateLimit = (config: Partial<RateLimitConfig> = {}) => {
  const slidingStore = new Map<string, number[]>();
  
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const finalConfig = { ...defaultRateLimitConfig, ...config };
      
      if (finalConfig.skip(req)) {
        return next();
      }
      
      const key = finalConfig.keyGenerator(req);
      const now = Date.now();
      const windowStart = now - finalConfig.windowMs;
      
      // Get existing timestamps and filter out old ones
      let timestamps = slidingStore.get(key) || [];
      timestamps = timestamps.filter(timestamp => timestamp > windowStart);
      
      // Add current request
      timestamps.push(now);
      slidingStore.set(key, timestamps);
      
      // Set headers
      res.setHeader('X-RateLimit-Limit', finalConfig.maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, finalConfig.maxRequests - timestamps.length));
      res.setHeader('X-RateLimit-Reset', new Date(now + finalConfig.windowMs).toISOString());
      
      // Check limit
      if (timestamps.length > finalConfig.maxRequests) {
        if (finalConfig.onLimitReached) {
          finalConfig.onLimitReached(req, res);
        }
        
        return res.status(429).json({
          error: 'Too Many Requests',
          message: finalConfig.message,
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: Math.ceil(finalConfig.windowMs / 1000)
        });
      }
      
      next();
    } catch (error) {
      console.error('Sliding window rate limiting error:', error);
      next();
    }
  };
};

/**
 * Distributed rate limiting (for use with Redis)
 */
export const createDistributedRateLimit = (redisClient: any, config?: Partial<RateLimitConfig>) => {
  const finalConfig = { ...defaultRateLimitConfig, ...config };
  
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (finalConfig.skip(req)) {
        return next();
      }
      
      const key = `rate_limit:${finalConfig.keyGenerator(req)}`;
      const now = Date.now();
      const windowStart = now - finalConfig.windowMs;
      
      // Use Redis sorted set for sliding window
      const multi = redisClient.multi();
      
      // Remove old entries
      multi.zremrangebyscore(key, 0, windowStart);
      
      // Add current request
      multi.zadd(key, now, `${now}-${Math.random()}`);
      
      // Count current requests
      multi.zcard(key);
      
      // Set expiration
      multi.expire(key, Math.ceil(finalConfig.windowMs / 1000));
      
      const results = await multi.exec();
      const count = results[2][1];
      
      // Set headers
      res.setHeader('X-RateLimit-Limit', finalConfig.maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, finalConfig.maxRequests - count));
      res.setHeader('X-RateLimit-Reset', new Date(now + finalConfig.windowMs).toISOString());
      
      // Check limit
      if (count > finalConfig.maxRequests) {
        if (finalConfig.onLimitReached) {
          finalConfig.onLimitReached(req, res);
        }
        
        return res.status(429).json({
          error: 'Too Many Requests',
          message: finalConfig.message,
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: Math.ceil(finalConfig.windowMs / 1000)
        });
      }
      
      next();
    } catch (error) {
      console.error('Distributed rate limiting error:', error);
      next();
    }
  };
};

/**
 * Clean up global store (call on process exit)
 */
export const cleanupRateLimit = () => {
  globalStore.destroy();
};

// Clean up on process exit
process.on('exit', cleanupRateLimit);
process.on('SIGINT', cleanupRateLimit);
process.on('SIGTERM', cleanupRateLimit);
