
import { Request, Response, NextFunction } from 'express';
import { createServiceLogger, LogContext, metrics } from '@ai-platform/shared-utils';
import { v4 as uuidv4 } from 'uuid';

const logger = createServiceLogger('auth-service');

// Extend Request interface to include logging context
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      startTime?: number;
      logger?: typeof logger;
    }
  }
}

export const requestLoggingMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // Generate unique request ID
  req.requestId = uuidv4();
  req.startTime = Date.now();
  req.logger = logger;

  // Create logging context
  const context: LogContext = {
    requestId: req.requestId,
    method: req.method,
    url: req.url,
    userAgent: req.get('user-agent'),
    ip: req.ip || req.connection.remoteAddress,
  };

  // Add user context if authenticated
  if (req.user) {
    context.userId = (req.user as any).userId;
    context.sessionId = (req.user as any).sessionId;
  }

  // Log incoming request
  logger.http(req.method, req.url, 0, 0, {
    ...context,
    type: 'request_start',
  });

  // Increment request counter
  metrics.incrementCounter('http_requests_total', {
    method: req.method,
    service: 'auth-service',
  });

  // Override res.json to log response
  const originalJson = res.json;
  res.json = function(body: any) {
    const duration = Date.now() - (req.startTime || Date.now());
    
    // Log response
    logger.http(req.method, req.url, res.statusCode, duration, {
      ...context,
      statusCode: res.statusCode,
      duration,
      type: 'request_end',
    });

    // Record metrics
    metrics.recordHistogram('http_request_duration_ms', duration, {
      method: req.method,
      status_code: res.statusCode.toString(),
      service: 'auth-service',
    });

    metrics.incrementCounter('http_responses_total', {
      method: req.method,
      status_code: res.statusCode.toString(),
      service: 'auth-service',
    });

    return originalJson.call(this, body);
  };

  // Handle response finish for non-JSON responses
  res.on('finish', () => {
    if (!res.headersSent) return;
    
    const duration = Date.now() - (req.startTime || Date.now());
    
    // Only log if we haven't already logged via json override
    if (res.getHeader('content-type')?.toString().includes('application/json')) {
      return;
    }

    logger.http(req.method, req.url, res.statusCode, duration, {
      ...context,
      statusCode: res.statusCode,
      duration,
      type: 'request_end',
    });

    // Record metrics
    metrics.recordHistogram('http_request_duration_ms', duration, {
      method: req.method,
      status_code: res.statusCode.toString(),
      service: 'auth-service',
    });
  });

  next();
};

export const errorLoggingMiddleware = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const context: LogContext = {
    requestId: req.requestId,
    method: req.method,
    url: req.url,
    userId: (req.user as any)?.userId,
    statusCode: res.statusCode || 500,
  };

  // Log error with context
  logger.error('Request error occurred', error, context);

  // Record error metrics
  metrics.incrementCounter('http_errors_total', {
    method: req.method,
    error_type: error.name,
    service: 'auth-service',
  });

  next(error);
};

// Security event logging middleware
export const securityLoggingMiddleware = {
  loginAttempt: (req: Request, success: boolean, userId?: string): void => {
    const context: LogContext = {
      requestId: req.requestId,
      userId,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      operation: 'login_attempt',
    };

    if (success) {
      logger.security('Successful login attempt', context);
      metrics.incrementCounter('auth_login_success_total');
    } else {
      logger.security('Failed login attempt', context);
      metrics.incrementCounter('auth_login_failed_total');
    }
  },

  logout: (req: Request, userId: string): void => {
    logger.security('User logout', {
      requestId: req.requestId,
      userId,
      operation: 'logout',
    });
    metrics.incrementCounter('auth_logout_total');
  },

  tokenRefresh: (req: Request, userId: string): void => {
    logger.security('Token refresh', {
      requestId: req.requestId,
      userId,
      operation: 'token_refresh',
    });
    metrics.incrementCounter('auth_token_refresh_total');
  },

  suspiciousActivity: (req: Request, activity: string, details?: any): void => {
    logger.security(`Suspicious activity detected: ${activity}`, {
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      operation: 'suspicious_activity',
      details,
    });
    metrics.incrementCounter('auth_suspicious_activity_total', {
      activity_type: activity,
    });
  },
};

// Business logic logging middleware
export const businessLoggingMiddleware = {
  userRegistration: (userId: string, email: string): void => {
    logger.business('User registration completed', {
      userId,
      operation: 'user_registration',
      metadata: { email },
    });
    metrics.incrementCounter('auth_user_registrations_total');
  },

  roleChange: (adminUserId: string, targetUserId: string, oldRole: string, newRole: string): void => {
    logger.business('User role changed', {
      userId: adminUserId,
      operation: 'role_change',
      metadata: {
        targetUserId,
        oldRole,
        newRole,
      },
    });
    metrics.incrementCounter('auth_role_changes_total');
  },

  accountLocked: (userId: string, reason: string): void => {
    logger.business('Account locked', {
      userId,
      operation: 'account_locked',
      metadata: { reason },
    });
    metrics.incrementCounter('auth_account_locks_total');
  },
};

// Performance monitoring middleware
export const performanceMonitoringMiddleware = (operation: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      
      logger.performance(operation, duration, {
        requestId: req.requestId,
        userId: (req.user as any)?.userId,
      });

      // Record performance metrics
      metrics.recordHistogram('operation_duration_ms', duration, {
        operation,
        service: 'auth-service',
      });
    });

    next();
  };
};
