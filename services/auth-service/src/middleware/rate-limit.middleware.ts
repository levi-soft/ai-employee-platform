
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import Redis from 'ioredis';
import { logger } from '../../../../packages/shared-utils/src/logger';

// Redis client for rate limiting
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  db: 1 // Use different DB for rate limiting
});

redis.on('error', (error) => {
  logger.error('Redis connection error for rate limiting', { error: error.message });
});

// Rate limiting configurations for different endpoints
export const authRateLimits = {
  // Login endpoint - more strict
  login: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per 15 minutes
    message: {
      error: 'Too many login attempts, please try again later',
      retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Rate limit by IP and email combination for login
      const email = req.body?.email || 'unknown';
      return `login:${req.ip}:${email}`;
    },
    handler: (req, res) => {
      logger.warn('Login rate limit exceeded', {
        ip: req.ip,
        email: req.body?.email,
        userAgent: req.headers['user-agent']
      });
      
      res.status(429).json({
        error: 'Too many login attempts',
        message: 'Please wait 15 minutes before trying again',
        retryAfter: 900 // 15 minutes in seconds
      });
    }
  }),

  // Registration endpoint
  register: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 registrations per hour per IP
    message: {
      error: 'Too many registration attempts, please try again later',
      retryAfter: '1 hour'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `register:${req.ip}`,
    handler: (req, res) => {
      logger.warn('Registration rate limit exceeded', {
        ip: req.ip,
        email: req.body?.email,
        userAgent: req.headers['user-agent']
      });
      
      res.status(429).json({
        error: 'Too many registration attempts',
        message: 'Please wait 1 hour before trying again',
        retryAfter: 3600 // 1 hour in seconds
      });
    }
  }),

  // Password reset
  passwordReset: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3, // 3 password reset attempts per 15 minutes
    message: {
      error: 'Too many password reset attempts, please try again later',
      retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const email = req.body?.email || 'unknown';
      return `password-reset:${req.ip}:${email}`;
    },
    handler: (req, res) => {
      logger.warn('Password reset rate limit exceeded', {
        ip: req.ip,
        email: req.body?.email,
        userAgent: req.headers['user-agent']
      });
      
      res.status(429).json({
        error: 'Too many password reset attempts',
        message: 'Please wait 15 minutes before trying again',
        retryAfter: 900
      });
    }
  }),

  // Token refresh
  tokenRefresh: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // 10 refresh attempts per minute
    message: {
      error: 'Too many token refresh attempts',
      retryAfter: '1 minute'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `token-refresh:${req.ip}`,
    handler: (req, res) => {
      logger.warn('Token refresh rate limit exceeded', {
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      
      res.status(429).json({
        error: 'Too many token refresh attempts',
        message: 'Please wait 1 minute before trying again',
        retryAfter: 60
      });
    }
  }),

  // General API endpoints
  general: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute per IP
    message: {
      error: 'Too many requests',
      retryAfter: '1 minute'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `general:${req.ip}`,
    handler: (req, res) => {
      logger.warn('General rate limit exceeded', {
        ip: req.ip,
        path: req.path,
        userAgent: req.headers['user-agent']
      });
      
      res.status(429).json({
        error: 'Rate limit exceeded',
        message: 'Too many requests, please slow down',
        retryAfter: 60
      });
    }
  }),

  // Admin endpoints - more lenient for authenticated admin users
  admin: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 200, // 200 requests per minute for admin
    message: {
      error: 'Admin rate limit exceeded',
      retryAfter: '1 minute'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const userId = (req as any).user?.id || 'unknown';
      return `admin:${userId}:${req.ip}`;
    },
    skip: (req) => {
      // Skip rate limiting for super admin
      return (req as any).user?.role === 'SUPER_ADMIN';
    },
    handler: (req, res) => {
      logger.warn('Admin rate limit exceeded', {
        ip: req.ip,
        userId: (req as any).user?.id,
        path: req.path,
        userAgent: req.headers['user-agent']
      });
      
      res.status(429).json({
        error: 'Admin rate limit exceeded',
        message: 'Too many admin requests, please slow down',
        retryAfter: 60
      });
    }
  })
};

// Advanced rate limiting with progressive delays
export class ProgressiveRateLimit {
  private static violationCounts = new Map<string, number>();
  private static lastViolation = new Map<string, number>();

  public static createMiddleware(baseLimit: number, windowMs: number, maxViolations: number = 3) {
    return (req: any, res: any, next: any) => {
      const key = `progressive:${req.ip}`;
      const now = Date.now();
      const violations = this.violationCounts.get(key) || 0;
      const lastViolationTime = this.lastViolation.get(key) || 0;

      // Reset violations if enough time has passed
      if (now - lastViolationTime > windowMs * 2) {
        this.violationCounts.set(key, 0);
      }

      // Calculate current limit based on violations
      const currentLimit = Math.max(1, baseLimit - (violations * 10));
      const currentWindow = Math.min(windowMs * Math.pow(2, violations), windowMs * 8);

      // Create dynamic rate limiter
      const dynamicLimiter = rateLimit({
        store: new RedisStore({
          sendCommand: (...args: string[]) => redis.call(...args),
        }),
        windowMs: currentWindow,
        max: currentLimit,
        keyGenerator: () => key,
        handler: (req, res) => {
          // Increment violation count
          const newViolations = violations + 1;
          this.violationCounts.set(key, newViolations);
          this.lastViolation.set(key, now);

          // Temporarily ban after max violations
          if (newViolations >= maxViolations) {
            logger.error('IP temporarily banned due to repeated rate limit violations', {
              ip: req.ip,
              violations: newViolations,
              banDuration: currentWindow
            });

            res.status(429).json({
              error: 'Temporarily banned',
              message: `Too many violations. Banned for ${currentWindow / 1000} seconds`,
              retryAfter: currentWindow / 1000,
              violations: newViolations
            });
            return;
          }

          logger.warn('Progressive rate limit exceeded', {
            ip: req.ip,
            violations: newViolations,
            currentLimit,
            currentWindow
          });

          res.status(429).json({
            error: 'Rate limit exceeded',
            message: `Request limit reduced due to previous violations`,
            retryAfter: currentWindow / 1000,
            violations: newViolations
          });
        }
      });

      dynamicLimiter(req, res, next);
    };
  }
}

// Burst protection - allows short bursts but enforces sustained rate limits
export const burstProtection = (burstLimit: number, sustainedLimit: number, windowMs: number) => {
  return rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs,
    max: sustainedLimit,
    // Allow short bursts
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    keyGenerator: (req) => `burst:${req.ip}`,
    handler: (req, res) => {
      logger.warn('Burst protection triggered', {
        ip: req.ip,
        burstLimit,
        sustainedLimit,
        windowMs
      });

      res.status(429).json({
        error: 'Sustained rate limit exceeded',
        message: 'Please maintain a lower request rate',
        retryAfter: windowMs / 1000
      });
    }
  });
};

// IP whitelist middleware
export const ipWhitelist = (allowedIPs: string[]) => {
  return (req: any, res: any, next: any) => {
    const clientIP = req.ip;
    
    if (allowedIPs.includes(clientIP)) {
      return next();
    }

    logger.warn('Request from non-whitelisted IP blocked', {
      ip: clientIP,
      allowedIPs: allowedIPs.length
    });

    res.status(403).json({
      error: 'IP not allowed',
      message: 'Your IP address is not authorized to access this resource'
    });
  };
};

// Cleanup function to clear old violation records
export const cleanupRateLimit = () => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  for (const [key, timestamp] of ProgressiveRateLimit['lastViolation'].entries()) {
    if (now - timestamp > maxAge) {
      ProgressiveRateLimit['violationCounts'].delete(key);
      ProgressiveRateLimit['lastViolation'].delete(key);
    }
  }
};

// Start cleanup interval
setInterval(cleanupRateLimit, 60 * 60 * 1000); // Clean up every hour

export { redis as rateLimitRedis };
