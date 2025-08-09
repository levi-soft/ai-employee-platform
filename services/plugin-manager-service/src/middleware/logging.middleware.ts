
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createServiceLogger, metrics } from '@ai-platform/shared-utils';

const logger = createServiceLogger('plugin-manager-request');

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
  logger.info('Plugin Manager Request', {
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
    logger.info('Plugin Manager Response', {
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
  
  logger.error('Plugin Manager Error', {
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
 * Plugin execution logging middleware
 */
export const pluginExecutionLoggingMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (req.path.includes('/execute')) {
    const startTime = Date.now();
    const requestId = (req as any).requestId;
    
    logger.info('Plugin Execution Started', {
      requestId,
      pluginId: req.params.pluginId,
      userId: req.user?.id,
      executionContext: req.body.context,
      timestamp: new Date().toISOString()
    });

    // Override res.json to log execution result
    const originalJson = res.json;
    res.json = function(body: any) {
      const duration = Date.now() - startTime;
      
      logger.info('Plugin Execution Completed', {
        requestId,
        pluginId: req.params.pluginId,
        userId: req.user?.id,
        duration,
        success: body.success,
        hasError: !!body.data?.error,
        executionTime: body.data?.metrics?.executionTime,
        memoryUsage: body.data?.metrics?.memoryUsage
      });

      // Update plugin execution metrics
      metrics.incrementCounter('plugin_executions_total', {
        status: body.success ? 'success' : 'failure',
        plugin_id: req.params.pluginId
      });

      metrics.observeHistogram('plugin_execution_duration_ms', duration, {
        plugin_id: req.params.pluginId
      });

      if (body.data?.metrics?.memoryUsage) {
        metrics.observeGauge('plugin_memory_usage_bytes', body.data.metrics.memoryUsage, {
          plugin_id: req.params.pluginId
        });
      }

      return originalJson.call(this, body);
    };
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
    'install', 'update', 'uninstall', 'execute'
  ];

  const isSecurityEvent = securityEvents.some(event => req.path.includes(event));

  if (isSecurityEvent) {
    const requestId = (req as any).requestId;
    
    logger.info('Security Event', {
      requestId,
      event: req.method + ' ' + req.path,
      userId: req.user?.id,
      userRole: req.user?.role,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      pluginId: req.params.pluginId,
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
