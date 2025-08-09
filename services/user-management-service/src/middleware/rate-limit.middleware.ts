
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
  db: 2 // Use different DB for user management rate limiting
});

redis.on('error', (error) => {
  logger.error('Redis connection error for user management rate limiting', { error: error.message });
});

// Rate limiting configurations for user management endpoints
export const userManagementRateLimits = {
  // General user operations
  general: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute per user
    message: {
      error: 'Too many requests',
      retryAfter: '1 minute'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const userId = (req as any).user?.id;
      return userId ? `user-general:${userId}` : `user-general-ip:${req.ip}`;
    },
    handler: (req, res) => {
      logger.warn('User management general rate limit exceeded', {
        ip: req.ip,
        userId: (req as any).user?.id,
        path: req.path,
        userAgent: req.headers['user-agent']
      });
      
      res.status(429).json({
        error: 'Rate limit exceeded',
        message: 'Too many user management requests, please slow down',
        retryAfter: 60
      });
    }
  }),

  // Profile updates - more restrictive
  profileUpdate: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // 10 profile updates per 5 minutes
    message: {
      error: 'Too many profile updates',
      retryAfter: '5 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const userId = (req as any).user?.id || 'unknown';
      return `profile-update:${userId}`;
    },
    handler: (req, res) => {
      logger.warn('Profile update rate limit exceeded', {
        ip: req.ip,
        userId: (req as any).user?.id,
        userAgent: req.headers['user-agent']
      });
      
      res.status(429).json({
        error: 'Too many profile updates',
        message: 'Please wait before updating your profile again',
        retryAfter: 300
      });
    }
  }),

  // User search - moderate limits
  search: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // 30 searches per minute
    message: {
      error: 'Too many search requests',
      retryAfter: '1 minute'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const userId = (req as any).user?.id || 'unknown';
      return `user-search:${userId}`;
    },
    handler: (req, res) => {
      logger.warn('User search rate limit exceeded', {
        ip: req.ip,
        userId: (req as any).user?.id,
        query: req.query.q,
        userAgent: req.headers['user-agent']
      });
      
      res.status(429).json({
        error: 'Too many search requests',
        message: 'Please wait before searching again',
        retryAfter: 60
      });
    }
  }),

  // Bulk operations - very restrictive
  bulkOperations: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 3, // 3 bulk operations per 10 minutes
    message: {
      error: 'Too many bulk operations',
      retryAfter: '10 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const userId = (req as any).user?.id || 'unknown';
      return `bulk-ops:${userId}`;
    },
    handler: (req, res) => {
      logger.warn('Bulk operations rate limit exceeded', {
        ip: req.ip,
        userId: (req as any).user?.id,
        operation: req.path,
        userAgent: req.headers['user-agent']
      });
      
      res.status(429).json({
        error: 'Too many bulk operations',
        message: 'Please wait before performing another bulk operation',
        retryAfter: 600
      });
    }
  }),

  // Admin user management - higher limits
  admin: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 200, // 200 requests per minute for admins
    message: {
      error: 'Admin rate limit exceeded',
      retryAfter: '1 minute'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const userId = (req as any).user?.id || 'unknown';
      return `admin-user-mgmt:${userId}`;
    },
    skip: (req) => {
      return (req as any).user?.role === 'SUPER_ADMIN';
    },
    handler: (req, res) => {
      logger.warn('Admin user management rate limit exceeded', {
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
  }),

  // File upload operations
  fileUpload: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 20, // 20 file uploads per 5 minutes
    message: {
      error: 'Too many file uploads',
      retryAfter: '5 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const userId = (req as any).user?.id || 'unknown';
      return `file-upload:${userId}`;
    },
    handler: (req, res) => {
      logger.warn('File upload rate limit exceeded', {
        ip: req.ip,
        userId: (req as any).user?.id,
        userAgent: req.headers['user-agent']
      });
      
      res.status(429).json({
        error: 'Too many file uploads',
        message: 'Please wait before uploading another file',
        retryAfter: 300
      });
    }
  })
};

// Advanced rate limiting with user role-based limits
export const roleBasedRateLimit = (baseLimit: number, windowMs: number) => {
  return rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs,
    max: (req) => {
      const userRole = (req as any).user?.role;
      
      switch (userRole) {
        case 'SUPER_ADMIN':
          return baseLimit * 10; // 10x limit for super admin
        case 'ADMIN':
          return baseLimit * 5;  // 5x limit for admin
        case 'EMPLOYEE':
          return baseLimit * 2;  // 2x limit for employees
        default:
          return baseLimit;      // Base limit for others
      }
    },
    keyGenerator: (req) => {
      const userId = (req as any).user?.id || 'unknown';
      const role = (req as any).user?.role || 'unknown';
      return `role-based:${role}:${userId}`;
    },
    handler: (req, res) => {
      logger.warn('Role-based rate limit exceeded', {
        ip: req.ip,
        userId: (req as any).user?.id,
        role: (req as any).user?.role,
        path: req.path
      });
      
      res.status(429).json({
        error: 'Rate limit exceeded',
        message: 'Request limit based on your role has been exceeded',
        retryAfter: windowMs / 1000
      });
    }
  });
};

export { redis as userManagementRateLimitRedis };
