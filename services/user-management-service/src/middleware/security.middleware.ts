
import { Request, Response, NextFunction } from 'express';
import { createSecurityMiddleware, createUserRateLimit, createFileUploadSecurityMiddleware } from '@ai-platform/shared-utils/security';
import { createValidationMiddleware } from '@ai-platform/shared-utils/security';
import { secureUserInputSchema, secureApiRequestSchema, secureDatabaseQuerySchema, secureFileUploadSchema } from '@ai-platform/shared-utils/validation/security.schemas';

/**
 * User management service security configuration
 */
const userManagementSecurityConfig = {
  enableXssProtection: true,
  enableSqlInjectionProtection: true,
  enableCsrfProtection: false, // API service
  enableInputSanitization: true,
  maxRequestSize: 10 * 1024 * 1024, // 10MB for file uploads
  allowedOrigins: process.env.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGINS?.split(',') || ['https://ai-platform.com'])
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:8080']
};

/**
 * General user management security middleware
 */
export const userManagementSecurityMiddleware = createSecurityMiddleware(userManagementSecurityConfig);

/**
 * User data validation middleware
 */
export const validateUserData = createValidationMiddleware(
  secureUserInputSchema.partial().omit({ password: true }),
  'body'
);

/**
 * User update validation middleware
 */
export const validateUserUpdate = createValidationMiddleware(
  secureUserInputSchema.partial().omit({ password: true, email: true }),
  'body'
);

/**
 * Database query validation middleware
 */
export const validateDatabaseQuery = createValidationMiddleware(secureDatabaseQuerySchema, 'query');

/**
 * File upload validation middleware
 */
export const validateFileUpload = createValidationMiddleware(secureFileUploadSchema, 'body');

/**
 * User management rate limiting
 */
export const userManagementRateLimit = createUserRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100, // 100 requests per 15 minutes
  message: 'Too many requests to user management service',
  keyGenerator: (req: Request) => {
    const userId = (req as any).user?.id || req.ip || 'unknown';
    return `user-mgmt:${userId}`;
  }
});

/**
 * File upload rate limiting
 */
export const fileUploadRateLimit = createUserRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 20, // 20 file uploads per hour
  message: 'Too many file uploads, please try again later',
  keyGenerator: (req: Request) => {
    const userId = (req as any).user?.id || req.ip || 'unknown';
    return `upload:${userId}`;
  }
});

/**
 * File upload security middleware
 */
export const fileUploadSecurity = createFileUploadSecurityMiddleware({
  maxFileSize: 50 * 1024 * 1024, // 50MB
  allowedMimeTypes: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/json'
  ],
  maxFiles: 5
});

/**
 * User data access control middleware
 */
export const userDataAccessControl = (req: Request, res: Response, next: NextFunction) => {
  const requestedUserId = req.params.userId || req.params.id;
  const currentUser = (req as any).user;
  
  if (!currentUser) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }
  
  // Admins can access all user data
  if (currentUser.role === 'ADMIN') {
    return next();
  }
  
  // Users can only access their own data
  if (requestedUserId && requestedUserId !== currentUser.id) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Cannot access other user data',
      code: 'ACCESS_DENIED'
    });
  }
  
  next();
};

/**
 * Sensitive data filtering middleware
 */
export const filterSensitiveData = (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json;
  
  res.json = function(body) {
    if (body && typeof body === 'object') {
      // Remove sensitive fields from user objects
      const filteredBody = removeSensitiveFields(body);
      return originalJson.call(this, filteredBody);
    }
    return originalJson.call(this, body);
  };
  
  next();
};

/**
 * Remove sensitive fields from user data
 */
const removeSensitiveFields = (data: any): any => {
  if (Array.isArray(data)) {
    return data.map(item => removeSensitiveFields(item));
  }
  
  if (data && typeof data === 'object') {
    const filtered = { ...data };
    
    // Remove sensitive fields
    delete filtered.password;
    delete filtered.passwordHash;
    delete filtered.sessionSecret;
    delete filtered.resetToken;
    delete filtered.verificationToken;
    delete filtered.twoFactorSecret;
    
    // Recursively filter nested objects
    for (const key in filtered) {
      if (filtered[key] && typeof filtered[key] === 'object') {
        filtered[key] = removeSensitiveFields(filtered[key]);
      }
    }
    
    return filtered;
  }
  
  return data;
};

/**
 * Profile update security validation
 */
export const profileUpdateSecurity = (req: Request, res: Response, next: NextFunction) => {
  const currentUser = (req as any).user;
  const updateData = req.body;
  
  if (!currentUser) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }
  
  // Prevent role escalation
  if (updateData.role && currentUser.role !== 'ADMIN') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Cannot modify user role',
      code: 'ROLE_MODIFICATION_DENIED'
    });
  }
  
  // Prevent ID modification
  if (updateData.id || updateData.userId) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Cannot modify user ID',
      code: 'ID_MODIFICATION_DENIED'
    });
  }
  
  // Prevent email modification without proper verification
  if (updateData.email && updateData.email !== currentUser.email) {
    if (!updateData.emailVerificationToken) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Email verification required for email changes',
        code: 'EMAIL_VERIFICATION_REQUIRED'
      });
    }
  }
  
  next();
};

/**
 * Audit logging for user operations
 */
export const userOperationAuditLog = (req: Request, res: Response, next: NextFunction) => {
  const originalSend = res.send;
  const originalJson = res.json;
  
  res.send = function(body) {
    logUserOperation(req, res, body);
    return originalSend.call(this, body);
  };
  
  res.json = function(body) {
    logUserOperation(req, res, body);
    return originalJson.call(this, body);
  };
  
  next();
};

/**
 * Log user operations for audit trail
 */
const logUserOperation = (req: Request, res: Response, body: any) => {
  const statusCode = res.statusCode;
  const method = req.method;
  const path = req.path;
  const currentUser = (req as any).user;
  const ip = req.ip || req.connection.remoteAddress;
  
  // Only log successful operations that modify data
  if (statusCode >= 200 && statusCode < 300 && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    console.info('User Operation Audit', {
      timestamp: new Date().toISOString(),
      operation: `${method} ${path}`,
      performedBy: {
        userId: currentUser?.id || 'unknown',
        email: currentUser?.email || 'unknown',
        role: currentUser?.role || 'unknown'
      },
      targetUser: req.params.userId || req.params.id || 'unknown',
      ip,
      userAgent: req.headers['user-agent'],
      statusCode,
      changes: method === 'PUT' || method === 'PATCH' ? req.body : undefined
    });
  }
};

/**
 * PII (Personally Identifiable Information) protection
 */
export const piiProtection = (req: Request, res: Response, next: NextFunction) => {
  // Mask sensitive data in request logging
  if (req.body) {
    const maskedBody = maskPiiData(req.body);
    (req as any).logBody = maskedBody;
  }
  
  next();
};

/**
 * Mask PII data for logging
 */
const maskPiiData = (data: any): any => {
  if (!data || typeof data !== 'object') {
    return data;
  }
  
  const masked = { ...data };
  const piiFields = ['email', 'phone', 'ssn', 'address', 'fullName', 'firstName', 'lastName'];
  
  for (const field of piiFields) {
    if (masked[field]) {
      if (field === 'email') {
        // Mask email: j***@example.com
        const [local, domain] = masked[field].split('@');
        masked[field] = `${local[0]}***@${domain}`;
      } else {
        // Mask other fields with ***
        masked[field] = '***';
      }
    }
  }
  
  return masked;
};
