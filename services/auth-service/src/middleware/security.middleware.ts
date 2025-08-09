
import { Request, Response, NextFunction } from 'express';
import { createSecurityMiddleware, createCsrfProtection, createUserRateLimit } from '@ai-platform/shared-utils/security';
import { createValidationMiddleware } from '@ai-platform/shared-utils/security';
import { secureUserInputSchema, secureApiRequestSchema, secureTokenSchema } from '@ai-platform/shared-utils/validation/security.schemas';

/**
 * Auth service specific security configuration
 */
const authSecurityConfig = {
  enableXssProtection: true,
  enableSqlInjectionProtection: true,
  enableCsrfProtection: false, // JWT-based API, no CSRF needed
  enableInputSanitization: true,
  maxRequestSize: 1 * 1024 * 1024, // 1MB for auth requests
  allowedOrigins: process.env.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGINS?.split(',') || ['https://ai-platform.com'])
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:8080']
};

/**
 * General auth service security middleware
 */
export const authSecurityMiddleware = createSecurityMiddleware(authSecurityConfig);

/**
 * User registration validation middleware
 */
export const validateUserRegistration = createValidationMiddleware(secureUserInputSchema, 'body');

/**
 * Login validation middleware
 */
export const validateUserLogin = createValidationMiddleware(
  secureUserInputSchema.pick({ email: true, password: true }),
  'body'
);

/**
 * Token validation middleware
 */
export const validateToken = createValidationMiddleware(secureTokenSchema, 'body');

/**
 * Query parameters validation
 */
export const validateApiQuery = createValidationMiddleware(secureApiRequestSchema, 'query');

/**
 * Rate limiting for authentication endpoints
 */
export const authRateLimit = createUserRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 50, // 50 requests per 15 minutes per user
  message: 'Too many authentication requests, please try again later',
  keyGenerator: (req: Request) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const email = req.body?.email || '';
    return `auth:${ip}:${email}`;
  }
});

/**
 * Strict rate limiting for login attempts
 */
export const loginRateLimit = createUserRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5, // 5 login attempts per 15 minutes
  message: 'Too many login attempts, please try again later',
  keyGenerator: (req: Request) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const email = req.body?.email || '';
    return `login:${ip}:${email}`;
  },
  onLimitReached: (req: Request, res: Response) => {
    console.warn(`Login rate limit exceeded for IP: ${req.ip}, Email: ${req.body?.email}`);
  }
});

/**
 * Registration rate limiting
 */
export const registrationRateLimit = createUserRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 3, // 3 registrations per hour per IP
  message: 'Too many registration attempts, please try again later',
  keyGenerator: (req: Request) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    return `register:${ip}`;
  }
});

/**
 * Token refresh rate limiting
 */
export const tokenRefreshRateLimit = createUserRateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  maxRequests: 10, // 10 token refreshes per 5 minutes
  message: 'Too many token refresh attempts, please try again later',
  keyGenerator: (req: Request) => {
    const userId = (req as any).user?.id || req.ip || 'unknown';
    return `refresh:${userId}`;
  }
});

/**
 * Password reset rate limiting
 */
export const passwordResetRateLimit = createUserRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 3, // 3 password reset attempts per hour
  message: 'Too many password reset attempts, please try again later',
  keyGenerator: (req: Request) => {
    const email = req.body?.email || req.ip || 'unknown';
    return `reset:${email}`;
  }
});

/**
 * Security event logging middleware
 */
export const securityEventLogger = (req: Request, res: Response, next: NextFunction) => {
  const originalSend = res.send;
  const originalJson = res.json;
  
  // Override response methods to log security events
  res.send = function(body) {
    logSecurityEvent(req, res, body);
    return originalSend.call(this, body);
  };
  
  res.json = function(body) {
    logSecurityEvent(req, res, body);
    return originalJson.call(this, body);
  };
  
  next();
};

/**
 * Log security-related events
 */
const logSecurityEvent = (req: Request, res: Response, body: any) => {
  const statusCode = res.statusCode;
  const method = req.method;
  const path = req.path;
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'];
  
  // Log failed authentication attempts
  if (statusCode === 401 || statusCode === 403) {
    console.warn('Security Event - Authentication Failed', {
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      method,
      path,
      statusCode,
      email: req.body?.email || 'unknown'
    });
  }
  
  // Log rate limit violations
  if (statusCode === 429) {
    console.warn('Security Event - Rate Limit Exceeded', {
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      method,
      path,
      statusCode
    });
  }
  
  // Log successful logins
  if (statusCode === 200 && path.includes('login')) {
    console.info('Security Event - Successful Login', {
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      email: req.body?.email || 'unknown'
    });
  }
  
  // Log successful registrations
  if (statusCode === 201 && path.includes('register')) {
    console.info('Security Event - User Registration', {
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      email: req.body?.email || 'unknown'
    });
  }
};

/**
 * Brute force protection middleware
 */
export const bruteForceProtection = (req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const email = req.body?.email;
  
  // Check for common brute force patterns
  const suspiciousPatterns = [
    /admin/i,
    /test/i,
    /root/i,
    /guest/i,
    /password/i,
    /123456/,
    /qwerty/i
  ];
  
  if (email && suspiciousPatterns.some(pattern => pattern.test(email))) {
    console.warn('Security Event - Suspicious Login Attempt', {
      timestamp: new Date().toISOString(),
      ip,
      email,
      userAgent: req.headers['user-agent']
    });
    
    // Delay response to slow down brute force attempts
    setTimeout(() => {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }, 2000);
    
    return;
  }
  
  next();
};

/**
 * JWT token validation security middleware
 */
export const jwtSecurityValidation = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return next();
  }
  
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
  
  // Basic JWT format validation
  if (!token.match(/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid token format',
      code: 'INVALID_TOKEN_FORMAT'
    });
  }
  
  // Check token length (prevent DoS with very long tokens)
  if (token.length > 2000) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Token too long',
      code: 'TOKEN_TOO_LONG'
    });
  }
  
  next();
};

/**
 * Session security validation
 */
export const sessionSecurityValidation = (req: Request, res: Response, next: NextFunction) => {
  if (req.session) {
    // Check session age
    const sessionAge = Date.now() - ((req.session as any).createdAt || Date.now());
    const maxSessionAge = 24 * 60 * 60 * 1000; // 24 hours
    
    if (sessionAge > maxSessionAge) {
      req.session.destroy((err) => {
        if (err) {
          console.error('Session destruction error:', err);
        }
      });
      
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Session expired',
        code: 'SESSION_EXPIRED'
      });
    }
    
    // Update last activity
    (req.session as any).lastActivity = Date.now();
  }
  
  next();
};
