
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createServiceLogger, metrics } from '@ai-platform/shared-utils';

const logger = createServiceLogger('notification-request');

/**
 * Request logging middleware with performance tracking
 */
export const requestLoggingMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const startTime = Date.now();
  const requestId = uuidv4();
  
  // Add request ID to request object
  (req as any).requestId = requestId;
  
  // Log request
  logger.info('Notification Service Request', {
    requestId,
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    userId: req.user?.id,
    timestamp: new Date().toISOString()
  });

  // Override res.json to log response
  const originalJson = res.json;
  res.json = function(body: any) {
    const duration = Date.now() - startTime;
    
    // Log response
    logger.info('Notification Service Response', {
      requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      responseSize: JSON.stringify(body).length,
      userId: req.user?.id
    });

    // Update metrics
    metrics.incrementCounter('http_requests_total', {
      method: req.method,
      status_code: res.statusCode.toString(),
      endpoint: req.route?.path || req.path
    });

    metrics.observeHistogram('http_request_duration_ms', duration, {
      method: req.method,
      endpoint: req.route?.path || req.path
    });

    return originalJson.call(this, body);
  };

  next();
};

/**
 * Error logging middleware
 */
export const errorLoggingMiddleware = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const requestId = (req as any).requestId;
  
  logger.error('Notification Service Error', {
    requestId,
    method: req.method,
    url: req.url,
    error: error.message,
    stack: error.stack,
    userId: req.user?.id,
    timestamp: new Date().toISOString()
  });

  // Update error metrics
  metrics.incrementCounter('http_errors_total', {
    method: req.method,
    endpoint: req.route?.path || req.path,
    error_type: error.constructor.name
  });

  next(error);
};

/**
 * Notification sending logging middleware
 */
export const notificationSendingLoggingMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (req.path.includes('/send')) {
    const startTime = Date.now();
    const requestId = (req as any).requestId;
    
    logger.info('Notification Sending Started', {
      requestId,
      type: req.body.type,
      userId: req.body.userId,
      organizationId: req.body.organizationId,
      channels: req.body.channels,
      priority: req.body.priority,
      sentBy: req.user?.id,
      timestamp: new Date().toISOString()
    });

    // Override res.json to log sending result
    const originalJson = res.json;
    res.json = function(body: any) {
      const duration = Date.now() - startTime;
      
      logger.info('Notification Sending Completed', {
        requestId,
        type: req.body.type,
        userId: req.body.userId,
        duration,
        success: body.success,
        channels: body.data?.channels,
        notificationId: body.data?.notificationId
      });

      // Update notification metrics
      metrics.incrementCounter('notifications_sent_total', {
        type: req.body.type || 'unknown',
        status: body.success ? 'success' : 'failure',
        priority: req.body.priority || 'medium'
      });

      metrics.observeHistogram('notification_send_duration_ms', duration, {
        type: req.body.type || 'unknown'
      });

      // Track channel-specific success rates
      if (body.data?.channels) {
        Object.entries(body.data.channels).forEach(([channel, result]: [string, any]) => {
          metrics.incrementCounter('notification_channel_attempts_total', {
            channel,
            status: result.success ? 'success' : 'failure'
          });
        });
      }

      return originalJson.call(this, body);
    };
  }

  next();
};

/**
 * WebSocket event logging middleware
 */
export const websocketEventLoggingMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Log WebSocket-related requests
  if (req.path.includes('/websocket') || req.headers['upgrade'] === 'websocket') {
    const requestId = (req as any).requestId;
    
    logger.info('WebSocket Event', {
      requestId,
      event: 'websocket_request',
      userId: req.user?.id,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });

    metrics.incrementCounter('websocket_events_total', {
      event_type: 'connection_request'
    });
  }

  next();
};

/**
 * Security event logging middleware
 */
export const securityEventLoggingMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Log security-relevant events
  const securityEvents = [
    'send', 'preferences', 'test'
  ];

  const isSecurityEvent = securityEvents.some(event => req.path.includes(event));

  if (isSecurityEvent) {
    const requestId = (req as any).requestId;
    
    logger.info('Notification Security Event', {
      requestId,
      event: req.method + ' ' + req.path,
      userId: req.user?.id,
      userRole: req.user?.role,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      notificationType: req.body?.type,
      timestamp: new Date().toISOString()
    });

    // Update security metrics
    metrics.incrementCounter('security_events_total', {
      event_type: req.path.split('/').pop() || 'unknown',
      user_role: req.user?.role || 'anonymous'
    });
  }

  next();
};

/**
 * User activity logging middleware
 */
export const userActivityLoggingMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Log user activity for analytics
  const userActivities = [
    '/user', '/read', '/preferences', '/stats', '/search'
  ];

  const isUserActivity = userActivities.some(activity => req.path.includes(activity));

  if (isUserActivity && req.user) {
    const requestId = (req as any).requestId;
    
    logger.info('User Activity', {
      requestId,
      activity: req.method + ' ' + req.path,
      userId: req.user.id,
      userRole: req.user.role,
      timestamp: new Date().toISOString()
    });

    // Update user activity metrics
    metrics.incrementCounter('user_activity_total', {
      activity_type: req.path.split('/').pop() || 'unknown',
      user_role: req.user.role
    });
  }

  next();
};
