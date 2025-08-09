
import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { createServiceLogger } from '@ai-platform/shared-utils';
import { z } from 'zod';

const logger = createServiceLogger('plugin-security');

/**
 * Plugin-specific security middleware
 */
export const pluginSecurityMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Set security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Plugin-specific CSP for sandboxed execution
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-eval'; " +
    "object-src 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'"
  );

  next();
};

/**
 * Rate limiting for plugin operations
 */
export const pluginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit to 10 plugin executions per window per IP
  message: {
    success: false,
    message: 'Too many plugin executions, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Plugin execution rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    res.status(429).json({
      success: false,
      message: 'Rate limit exceeded for plugin execution'
    });
  }
});

/**
 * General plugin API rate limiting
 */
export const pluginApiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit to 100 requests per window per IP
  message: {
    success: false,
    message: 'Too many requests, please try again later'
  }
});

/**
 * Plugin validation middleware
 */
export const pluginValidation = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    // Validate plugin code for dangerous patterns
    if (req.body.code) {
      const dangerousPatterns = [
        /require\s*\(\s*['"]fs['"]/,
        /require\s*\(\s*['"]child_process['"]/,
        /require\s*\(\s*['"]net['"]/,
        /eval\s*\(/,
        /Function\s*\(/,
        /process\.exit/,
        /process\.kill/,
        /global\./,
        /globalThis\./
      ];

      const code = req.body.code;
      for (const pattern of dangerousPatterns) {
        if (pattern.test(code)) {
          logger.warn('Dangerous pattern detected in plugin code', {
            pattern: pattern.source,
            userId: req.user?.id
          });
          res.status(400).json({
            success: false,
            message: `Dangerous pattern detected: ${pattern.source}`
          });
          return;
        }
      }
    }

    // Validate plugin size
    if (req.body.code && req.body.code.length > 1024 * 1024) { // 1MB limit
      res.status(400).json({
        success: false,
        message: 'Plugin code exceeds maximum size limit (1MB)'
      });
      return;
    }

    next();
  } catch (error) {
    logger.error('Plugin validation error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    res.status(500).json({
      success: false,
      message: 'Plugin validation failed'
    });
  }
};

/**
 * Sandbox security middleware
 */
export const sandboxSecurityMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Add sandbox-specific headers
  res.setHeader('X-Sandbox-Mode', 'enabled');
  res.setHeader('X-Plugin-Execution', 'sandboxed');
  
  // Track execution context
  req.headers['x-execution-context'] = 'plugin-sandbox';
  
  next();
};

/**
 * Plugin upload validation
 */
const PluginUploadSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9-_]+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  author: z.string().min(1).max(100),
  description: z.string().max(500),
  code: z.string().min(1).max(1024 * 1024), // 1MB max
  category: z.string().max(50).optional(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  permissions: z.array(z.string().max(50)).max(20).optional(),
  dependencies: z.array(z.string().max(100)).max(50).optional()
});

export const validatePluginUpload = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    PluginUploadSchema.parse(req.body);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Plugin upload validation failed', {
        errors: error.errors,
        userId: req.user?.id
      });
      res.status(400).json({
        success: false,
        message: 'Plugin validation failed',
        errors: error.errors
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Validation error'
      });
    }
  }
};

/**
 * Plugin execution context validation
 */
const ExecutionContextSchema = z.object({
  userId: z.string().uuid(),
  organizationId: z.string().uuid().optional(),
  permissions: z.array(z.string()).min(0).max(100),
  maxExecutionTime: z.number().min(1000).max(300000).optional(), // 1s to 5min
  maxMemory: z.number().min(1024 * 1024).max(512 * 1024 * 1024).optional() // 1MB to 512MB
});

export const validateExecutionContext = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    if (req.body.context) {
      ExecutionContextSchema.parse(req.body.context);
    }
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        message: 'Invalid execution context',
        errors: error.errors
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Context validation error'
      });
    }
  }
};

/**
 * Log security events
 */
export const logSecurityEvent = (
  eventType: string,
  details: any = {}
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    logger.info(`Security event: ${eventType}`, {
      ...details,
      userId: req.user?.id,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });
    next();
  };
};
