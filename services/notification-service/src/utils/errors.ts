
import { Request, Response, NextFunction } from 'express';
import { createServiceLogger } from '@ai-platform/shared-utils';

const logger = createServiceLogger('notification-error-handler');

export class NotificationError extends Error {
  public statusCode: number;
  public code: string;
  public details?: any;

  constructor(message: string, statusCode: number = 500, code: string = 'NOTIFICATION_ERROR', details?: any) {
    super(message);
    this.name = 'NotificationError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    
    Error.captureStackTrace(this, NotificationError);
  }
}

export class NotificationValidationError extends NotificationError {
  constructor(message: string, details?: any) {
    super(message, 400, 'NOTIFICATION_VALIDATION_ERROR', details);
    this.name = 'NotificationValidationError';
  }
}

export class NotificationDeliveryError extends NotificationError {
  constructor(message: string, channel?: string, details?: any) {
    super(message, 500, 'NOTIFICATION_DELIVERY_ERROR', { channel, ...details });
    this.name = 'NotificationDeliveryError';
  }
}

export class NotificationPermissionError extends NotificationError {
  constructor(message: string, details?: any) {
    super(message, 403, 'NOTIFICATION_PERMISSION_ERROR', details);
    this.name = 'NotificationPermissionError';
  }
}

export class NotificationNotFoundError extends NotificationError {
  constructor(notificationId: string) {
    super(`Notification with ID ${notificationId} not found`, 404, 'NOTIFICATION_NOT_FOUND');
    this.name = 'NotificationNotFoundError';
  }
}

export class NotificationRateLimitError extends NotificationError {
  constructor(limit: string) {
    super(`Notification rate limit exceeded: ${limit}`, 429, 'NOTIFICATION_RATE_LIMIT');
    this.name = 'NotificationRateLimitError';
  }
}

export class WebSocketError extends NotificationError {
  constructor(message: string, details?: any) {
    super(message, 500, 'WEBSOCKET_ERROR', details);
    this.name = 'WebSocketError';
  }
}

export class EmailDeliveryError extends NotificationError {
  constructor(message: string, details?: any) {
    super(message, 500, 'EMAIL_DELIVERY_ERROR', details);
    this.name = 'EmailDeliveryError';
  }
}

export class SMSDeliveryError extends NotificationError {
  constructor(message: string, details?: any) {
    super(message, 500, 'SMS_DELIVERY_ERROR', details);
    this.name = 'SMSDeliveryError';
  }
}

/**
 * Global error handler middleware
 */
export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const requestId = (req as any).requestId;
  
  // Log the error
  logger.error('Notification Service Error Handler', {
    requestId,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    },
    request: {
      method: req.method,
      url: req.url,
      userId: req.user?.id,
      ip: req.ip
    }
  });

  // Handle specific notification errors
  if (error instanceof NotificationError) {
    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      },
      requestId
    });
    return;
  }

  // Handle validation errors (Zod, etc.)
  if (error.name === 'ZodError') {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: (error as any).errors
      },
      requestId
    });
    return;
  }

  // Handle JWT errors
  if (error.name === 'JsonWebTokenError') {
    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid authentication token'
      },
      requestId
    });
    return;
  }

  if (error.name === 'TokenExpiredError') {
    res.status(401).json({
      success: false,
      error: {
        code: 'TOKEN_EXPIRED',
        message: 'Authentication token expired'
      },
      requestId
    });
    return;
  }

  // Handle Prisma errors
  if (error.name === 'PrismaClientKnownRequestError') {
    const prismaError = error as any;
    
    if (prismaError.code === 'P2002') {
      res.status(409).json({
        success: false,
        error: {
          code: 'DUPLICATE_ENTRY',
          message: 'A notification preference with this configuration already exists'
        },
        requestId
      });
      return;
    }
    
    if (prismaError.code === 'P2025') {
      res.status(404).json({
        success: false,
        error: {
          code: 'RECORD_NOT_FOUND',
          message: 'Requested notification not found'
        },
        requestId
      });
      return;
    }
  }

  // Handle WebSocket errors
  if (error.message?.includes('WebSocket')) {
    res.status(500).json({
      success: false,
      error: {
        code: 'WEBSOCKET_ERROR',
        message: 'WebSocket communication error'
      },
      requestId
    });
    return;
  }

  // Handle email service errors
  if (error.message?.includes('SMTP') || error.message?.includes('email')) {
    res.status(500).json({
      success: false,
      error: {
        code: 'EMAIL_SERVICE_ERROR',
        message: 'Email service temporarily unavailable'
      },
      requestId
    });
    return;
  }

  // Handle SMS service errors
  if (error.message?.includes('SMS') || error.message?.includes('Twilio')) {
    res.status(500).json({
      success: false,
      error: {
        code: 'SMS_SERVICE_ERROR',
        message: 'SMS service temporarily unavailable'
      },
      requestId
    });
    return;
  }

  // Handle rate limit errors
  if (error.message?.includes('Too many requests')) {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded, please try again later'
      },
      requestId
    });
    return;
  }

  // Handle generic errors
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: isDevelopment ? error.message : 'An internal server error occurred'
    },
    requestId,
    ...(isDevelopment && { stack: error.stack })
  });
};

/**
 * Async error handler wrapper
 */
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Not found handler
 */
export const notFoundHandler = (req: Request, res: Response): void => {
  const requestId = (req as any).requestId;
  
  logger.warn('Notification Service Route Not Found', {
    requestId,
    method: req.method,
    url: req.url,
    ip: req.ip
  });

  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Route ${req.method} ${req.url} not found`
    },
    requestId
  });
};

/**
 * Service availability checker
 */
export const checkServiceAvailability = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Check if critical services are available
  const criticalServices = {
    database: true, // Would check Prisma connection
    websocket: true, // Would check WebSocket gateway
    email: process.env.SMTP_HOST ? true : false,
    sms: process.env.SMS_API_KEY ? true : false
  };

  const unavailableServices = Object.entries(criticalServices)
    .filter(([_, available]) => !available)
    .map(([service, _]) => service);

  if (unavailableServices.length > 0 && req.path !== '/health') {
    logger.warn('Service availability warning', {
      unavailableServices,
      requestPath: req.path
    });
    
    // Don't block the request, just log the warning
    // In a production system, you might want to return a 503 for certain endpoints
  }

  next();
};
