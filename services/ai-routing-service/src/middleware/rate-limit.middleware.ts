
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import Redis from 'ioredis';
import { logger } from '../../../../packages/shared-utils/src/logger';

// Redis client for AI routing rate limiting
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  db: 3 // Use different DB for AI routing rate limiting
});

redis.on('error', (error) => {
  logger.error('Redis connection error for AI routing rate limiting', { error: error.message });
});

// Rate limiting configurations for AI routing endpoints
export const aiRoutingRateLimits = {
  // AI routing requests - most critical
  routing: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 1 * 60 * 1000, // 1 minute
    max: (req) => {
      // Different limits based on user tier/role
      const user = (req as any).user;
      if (!user) return 10; // Anonymous users get very low limit
      
      switch (user.role) {
        case 'SUPER_ADMIN':
          return 1000; // Very high limit for super admin
        case 'ADMIN':
          return 500;  // High limit for admin
        case 'EMPLOYEE':
          return 100;  // Standard limit for employees
        default:
          return 50;   // Lower limit for others
      }
    },
    message: {
      error: 'Too many AI routing requests',
      retryAfter: '1 minute'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const userId = (req as any).user?.id || 'anonymous';
      return `ai-routing:${userId}`;
    },
    handler: (req, res) => {
      logger.warn('AI routing rate limit exceeded', {
        ip: req.ip,
        userId: (req as any).user?.id,
        role: (req as any).user?.role,
        userAgent: req.headers['user-agent']
      });
      
      res.status(429).json({
        error: 'AI routing rate limit exceeded',
        message: 'Too many AI requests, please slow down',
        retryAfter: 60,
        suggestion: 'Consider upgrading your plan for higher limits'
      });
    }
  }),

  // Credit-based routing (checks user credits)
  creditBasedRouting: (req: any, res: any, next: any) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required for AI requests' });
    }

    // This would integrate with billing service to check credits
    // For now, we'll simulate credit checking
    const estimatedCost = req.body?.estimatedCost || 1;
    
    // In production, this would check actual credit balance
    logger.info('AI routing request with credit check', {
      userId: user.id,
      estimatedCost,
      requestType: req.body?.type || 'unknown'
    });

    next();
  },

  // Expensive AI operations (like GPT-4, long contexts)
  expensiveOperations: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: (req) => {
      const user = (req as any).user;
      if (!user) return 2;
      
      switch (user.role) {
        case 'SUPER_ADMIN':
          return 100;
        case 'ADMIN':
          return 50;
        case 'EMPLOYEE':
          return 20;
        default:
          return 10;
      }
    },
    keyGenerator: (req) => {
      const userId = (req as any).user?.id || 'anonymous';
      return `ai-expensive:${userId}`;
    },
    handler: (req, res) => {
      logger.warn('Expensive AI operations rate limit exceeded', {
        ip: req.ip,
        userId: (req as any).user?.id,
        operation: req.body?.model || 'unknown'
      });
      
      res.status(429).json({
        error: 'Expensive operations limit exceeded',
        message: 'Please wait before making another expensive AI request',
        retryAfter: 300
      });
    }
  }),

  // Capability queries
  capabilities: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 200, // High limit for capability queries
    keyGenerator: (req) => {
      const userId = (req as any).user?.id || 'anonymous';
      return `ai-capabilities:${userId}`;
    },
    handler: (req, res) => {
      res.status(429).json({
        error: 'Capability queries rate limit exceeded',
        retryAfter: 60
      });
    }
  }),

  // Analytics and metrics
  analytics: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100,
    keyGenerator: (req) => {
      const userId = (req as any).user?.id || 'anonymous';
      return `ai-analytics:${userId}`;
    },
    handler: (req, res) => {
      res.status(429).json({
        error: 'Analytics rate limit exceeded',
        retryAfter: 60
      });
    }
  }),

  // Simulation endpoints
  simulation: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 50, // Lower limit for simulations
    keyGenerator: (req) => {
      const userId = (req as any).user?.id || 'anonymous';
      return `ai-simulation:${userId}`;
    },
    handler: (req, res) => {
      res.status(429).json({
        error: 'Simulation rate limit exceeded',
        message: 'Too many simulation requests, please wait',
        retryAfter: 60
      });
    }
  })
};

// Token-based rate limiting (for specific AI models/providers)
export const tokenBasedRateLimit = (maxTokensPerMinute: number) => {
  const tokenUsage = new Map<string, { tokens: number; resetTime: number }>();

  return (req: any, res: any, next: any) => {
    const userId = req.user?.id || req.ip;
    const requestTokens = req.body?.maxTokens || req.body?.tokens || 1000; // Default estimate
    const now = Date.now();
    const key = `tokens:${userId}`;

    // Get current usage
    let usage = tokenUsage.get(key) || { tokens: 0, resetTime: now + 60000 }; // 1 minute window

    // Reset if time window passed
    if (now > usage.resetTime) {
      usage = { tokens: 0, resetTime: now + 60000 };
    }

    // Check if adding this request would exceed limit
    if (usage.tokens + requestTokens > maxTokensPerMinute) {
      logger.warn('Token-based rate limit exceeded', {
        userId,
        currentTokens: usage.tokens,
        requestTokens,
        limit: maxTokensPerMinute
      });

      return res.status(429).json({
        error: 'Token limit exceeded',
        message: `Request would exceed token limit of ${maxTokensPerMinute} per minute`,
        currentUsage: usage.tokens,
        requestTokens,
        retryAfter: Math.ceil((usage.resetTime - now) / 1000)
      });
    }

    // Update usage
    usage.tokens += requestTokens;
    tokenUsage.set(key, usage);

    // Add usage info to request for monitoring
    req.tokenUsage = {
      used: usage.tokens,
      limit: maxTokensPerMinute,
      resetTime: usage.resetTime
    };

    next();
  };
};

// Context-aware rate limiting (based on request complexity)
export const contextAwareRateLimit = (req: any, res: any, next: any) => {
  const baseLimit = 100;
  let complexityMultiplier = 1;

  // Calculate complexity based on request
  const contextLength = req.body?.context?.length || 0;
  const temperature = req.body?.temperature || 0.7;
  const maxTokens = req.body?.maxTokens || 1000;
  const model = req.body?.model || '';

  // Increase complexity based on factors
  if (contextLength > 8000) complexityMultiplier *= 1.5;
  if (maxTokens > 2000) complexityMultiplier *= 1.3;
  if (temperature > 0.8) complexityMultiplier *= 1.2;
  if (model.includes('gpt-4')) complexityMultiplier *= 2;

  const adjustedLimit = Math.max(Math.floor(baseLimit / complexityMultiplier), 5);

  const dynamicLimiter = rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 1 * 60 * 1000,
    max: adjustedLimit,
    keyGenerator: (req) => {
      const userId = (req as any).user?.id || 'anonymous';
      return `ai-context-aware:${userId}`;
    },
    handler: (req, res) => {
      logger.warn('Context-aware rate limit exceeded', {
        userId: req.user?.id,
        complexityMultiplier,
        adjustedLimit,
        originalLimit: baseLimit
      });

      res.status(429).json({
        error: 'Complex request rate limit exceeded',
        message: 'Request complexity requires lower rate limit',
        adjustedLimit,
        complexityMultiplier: Math.round(complexityMultiplier * 100) / 100
      });
    }
  });

  dynamicLimiter(req, res, next);
};

export { redis as aiRoutingRateLimitRedis };
