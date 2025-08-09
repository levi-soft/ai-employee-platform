
import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';

// Error types
export enum ErrorType {
  VALIDATION = 'VALIDATION',
  AUTHENTICATION = 'AUTHENTICATION',
  AUTHORIZATION = 'AUTHORIZATION',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  RATE_LIMITED = 'RATE_LIMITED',
  EXTERNAL_SERVICE = 'EXTERNAL_SERVICE',
  DATABASE = 'DATABASE',
  INTERNAL = 'INTERNAL',
  CIRCUIT_BREAKER = 'CIRCUIT_BREAKER',
  TIMEOUT = 'TIMEOUT'
}

export class AppError extends Error {
  public statusCode: number;
  public type: ErrorType;
  public isOperational: boolean;
  public timestamp: Date;
  public context?: Record<string, any>;

  constructor(
    message: string,
    statusCode: number = 500,
    type: ErrorType = ErrorType.INTERNAL,
    isOperational: boolean = true,
    context?: Record<string, any>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.type = type;
    this.isOperational = isOperational;
    this.timestamp = new Date();
    this.context = context;
    
    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

// Specific error classes
export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 400, ErrorType.VALIDATION, true, context);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required', context?: Record<string, any>) {
    super(message, 401, ErrorType.AUTHENTICATION, true, context);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions', context?: Record<string, any>) {
    super(message, 403, ErrorType.AUTHORIZATION, true, context);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found', context?: Record<string, any>) {
    super(message, 404, ErrorType.NOT_FOUND, true, context);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 409, ErrorType.CONFLICT, true, context);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests', context?: Record<string, any>) {
    super(message, 429, ErrorType.RATE_LIMITED, true, context);
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 502, ErrorType.EXTERNAL_SERVICE, true, context);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 500, ErrorType.DATABASE, true, context);
  }
}

export class CircuitBreakerError extends AppError {
  constructor(message: string = 'Service temporarily unavailable', context?: Record<string, any>) {
    super(message, 503, ErrorType.CIRCUIT_BREAKER, true, context);
  }
}

export class TimeoutError extends AppError {
  constructor(message: string = 'Request timeout', context?: Record<string, any>) {
    super(message, 504, ErrorType.TIMEOUT, true, context);
  }
}

// Error response formatter
interface ErrorResponse {
  error: {
    message: string;
    type: string;
    code: number;
    timestamp: string;
    requestId?: string;
    details?: any;
  };
}

export function formatErrorResponse(error: Error, requestId?: string): ErrorResponse {
  if (error instanceof AppError) {
    return {
      error: {
        message: error.message,
        type: error.type,
        code: error.statusCode,
        timestamp: error.timestamp.toISOString(),
        requestId,
        details: error.context
      }
    };
  }

  // Handle unknown errors
  return {
    error: {
      message: 'Internal server error',
      type: ErrorType.INTERNAL,
      code: 500,
      timestamp: new Date().toISOString(),
      requestId
    }
  };
}

// Global error handler middleware
export function globalErrorHandler(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = req.headers['x-request-id'] as string || req.headers['x-correlation-id'] as string;

  // Log the error
  const logContext = {
    error: {
      message: error.message,
      stack: error.stack,
      type: error instanceof AppError ? error.type : 'UNKNOWN',
      statusCode: error instanceof AppError ? error.statusCode : 500
    },
    request: {
      id: requestId,
      method: req.method,
      url: req.url,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      userId: (req as any).user?.id
    }
  };

  if (error instanceof AppError && error.isOperational) {
    logger.warn('Operational error occurred', logContext);
  } else {
    logger.error('Unexpected error occurred', logContext);
  }

  // Format and send error response
  const errorResponse = formatErrorResponse(error, requestId);
  const statusCode = error instanceof AppError ? error.statusCode : 500;

  res.status(statusCode).json(errorResponse);
}

// Async error wrapper
export function asyncHandler(fn: Function) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Unhandled error handlers
export function setupGlobalErrorHandlers(): void {
  // Handle uncaught exceptions
  process.on('uncaughtException', (error: Error) => {
    logger.fatal('Uncaught Exception', {
      error: {
        message: error.message,
        stack: error.stack
      }
    });
    
    // Give time for logging to complete then exit
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    logger.fatal('Unhandled Rejection', {
      reason: reason?.message || reason,
      stack: reason?.stack,
      promise: promise.toString()
    });
    
    // Give time for logging to complete then exit
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  // Handle SIGTERM gracefully
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
  });

  // Handle SIGINT gracefully
  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    process.exit(0);
  });
}

// Error sanitizer for production
export function sanitizeError(error: Error, isProduction: boolean = false): any {
  if (!isProduction) {
    return {
      message: error.message,
      stack: error.stack,
      ...(error instanceof AppError && { context: error.context })
    };
  }

  // In production, only return safe error information
  if (error instanceof AppError && error.isOperational) {
    return {
      message: error.message,
      type: error.type,
      ...(error.context && { details: error.context })
    };
  }

  return {
    message: 'Internal server error',
    type: ErrorType.INTERNAL
  };
}
