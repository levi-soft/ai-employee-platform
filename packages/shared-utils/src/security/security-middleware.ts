
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validateInput, sanitizeHtml } from '../validation/security.schemas';

export interface SecurityConfig {
  enableXssProtection: boolean;
  enableSqlInjectionProtection: boolean;
  enableCsrfProtection: boolean;
  enableInputSanitization: boolean;
  maxRequestSize: number;
  allowedOrigins: string[];
  rateLimiting?: {
    windowMs: number;
    maxRequests: number;
  };
}

const defaultSecurityConfig: SecurityConfig = {
  enableXssProtection: true,
  enableSqlInjectionProtection: true,
  enableCsrfProtection: true,
  enableInputSanitization: true,
  maxRequestSize: 10 * 1024 * 1024, // 10MB
  allowedOrigins: process.env.NODE_ENV === 'production' 
    ? ['https://ai-platform.com', 'https://admin.ai-platform.com']
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:8080'],
};

/**
 * Main security middleware factory
 */
export const createSecurityMiddleware = (config: Partial<SecurityConfig> = {}) => {
  const finalConfig = { ...defaultSecurityConfig, ...config };
  
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Set security headers
      setSecurityHeaders(res, finalConfig);
      
      // Validate origin
      if (req.method !== 'GET' && req.headers.origin) {
        if (!validateOrigin(req.headers.origin, finalConfig.allowedOrigins)) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Origin not allowed',
            code: 'INVALID_ORIGIN'
          });
        }
      }
      
      // Check request size
      const contentLength = parseInt(req.headers['content-length'] || '0');
      if (contentLength > finalConfig.maxRequestSize) {
        return res.status(413).json({
          error: 'Payload Too Large',
          message: `Request size exceeds ${finalConfig.maxRequestSize} bytes`,
          code: 'PAYLOAD_TOO_LARGE'
        });
      }
      
      // XSS Protection
      if (finalConfig.enableXssProtection) {
        sanitizeRequestData(req);
      }
      
      // SQL Injection Protection
      if (finalConfig.enableSqlInjectionProtection) {
        if (containsSqlInjection(req)) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Potential SQL injection detected',
            code: 'SQL_INJECTION_DETECTED'
          });
        }
      }
      
      next();
    } catch (error) {
      console.error('Security middleware error:', error);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Security validation failed',
        code: 'SECURITY_ERROR'
      });
    }
  };
};

/**
 * Set comprehensive security headers
 */
const setSecurityHeaders = (res: Response, config: SecurityConfig) => {
  // XSS Protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Content Type Options
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Frame Options
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Content Security Policy
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' https://api.openai.com https://api.anthropic.com",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '));
  
  // HSTS (only in production with HTTPS)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  
  // Permissions Policy
  res.setHeader('Permissions-Policy', [
    'camera=()',
    'microphone=()',
    'geolocation=()',
    'payment=()',
    'usb=()'
  ].join(', '));
  
  // CORS headers if origin is allowed
  const origin = res.req?.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  }
};

/**
 * Sanitize request data for XSS protection
 */
const sanitizeRequestData = (req: Request) => {
  if (req.body && typeof req.body === 'object') {
    sanitizeObject(req.body);
  }
  
  if (req.query && typeof req.query === 'object') {
    sanitizeObject(req.query);
  }
  
  if (req.params && typeof req.params === 'object') {
    sanitizeObject(req.params);
  }
};

/**
 * Recursively sanitize object properties
 */
const sanitizeObject = (obj: any) => {
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      if (typeof obj[key] === 'string') {
        obj[key] = sanitizeHtml(obj[key]);
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitizeObject(obj[key]);
      }
    }
  }
};

/**
 * Check for SQL injection patterns
 */
const containsSqlInjection = (req: Request): boolean => {
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/gi,
    /(--|#|\/\*|\*\/)/g,
    /(\b(OR|AND)\s+[\w\s]*=[\w\s]*)/gi,
    /('|(\\x27)|(\\x2D\\x2D))/gi,
    /(\b(CAST|CONVERT|CHAR|ASCII)\s*\()/gi
  ];
  
  const checkString = (str: string): boolean => {
    return sqlPatterns.some(pattern => pattern.test(str));
  };
  
  const checkObject = (obj: any): boolean => {
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const value = obj[key];
        if (typeof value === 'string') {
          if (checkString(value)) return true;
        } else if (typeof value === 'object' && value !== null) {
          if (checkObject(value)) return true;
        }
      }
    }
    return false;
  };
  
  // Check URL parameters
  if (typeof req.url === 'string' && checkString(req.url)) {
    return true;
  }
  
  // Check request body
  if (req.body && checkObject(req.body)) {
    return true;
  }
  
  // Check query parameters
  if (req.query && checkObject(req.query)) {
    return true;
  }
  
  return false;
};

/**
 * Validate origin against allowed origins
 */
const validateOrigin = (origin: string, allowedOrigins: string[]): boolean => {
  if (!origin) return false;
  
  // Allow localhost in development
  if (process.env.NODE_ENV === 'development') {
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return true;
    }
  }
  
  return allowedOrigins.includes(origin);
};

/**
 * Input validation middleware factory
 */
export const createValidationMiddleware = <T>(schema: z.ZodSchema<T>, target: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = req[target];
      const validated = validateInput(schema, data);
      
      // Replace the original data with validated data
      (req as any)[target] = validated;
      
      next();
    } catch (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error instanceof Error ? error.message : 'Invalid input data',
        code: 'VALIDATION_FAILED'
      });
    }
  };
};

/**
 * File upload security middleware
 */
export const createFileUploadSecurityMiddleware = (config?: {
  maxFileSize?: number;
  allowedMimeTypes?: string[];
  maxFiles?: number;
}) => {
  const defaultConfig = {
    maxFileSize: 50 * 1024 * 1024, // 50MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf', 'text/plain'],
    maxFiles: 5,
    ...config
  };
  
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.files) {
      return next();
    }
    
    const files = Array.isArray(req.files) ? req.files : [req.files];
    
    // Check file count
    if (files.length > defaultConfig.maxFiles) {
      return res.status(400).json({
        error: 'Too Many Files',
        message: `Maximum ${defaultConfig.maxFiles} files allowed`,
        code: 'TOO_MANY_FILES'
      });
    }
    
    // Validate each file
    for (const file of files) {
      // Check file size
      if (file.size > defaultConfig.maxFileSize) {
        return res.status(400).json({
          error: 'File Too Large',
          message: `File size must be less than ${defaultConfig.maxFileSize / (1024 * 1024)}MB`,
          code: 'FILE_TOO_LARGE'
        });
      }
      
      // Check mime type
      if (!defaultConfig.allowedMimeTypes.includes(file.mimetype)) {
        return res.status(400).json({
          error: 'Unsupported File Type',
          message: `File type ${file.mimetype} is not allowed`,
          code: 'UNSUPPORTED_FILE_TYPE'
        });
      }
      
      // Check filename for path traversal
      if (file.name && (file.name.includes('..') || file.name.includes('/') || file.name.includes('\\'))) {
        return res.status(400).json({
          error: 'Invalid Filename',
          message: 'Filename contains invalid characters',
          code: 'INVALID_FILENAME'
        });
      }
    }
    
    next();
  };
};
