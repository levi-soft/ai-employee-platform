
import { Request, Response, NextFunction } from 'express';
import { createServiceLogger } from '@ai-platform/shared-utils';

const logger = createServiceLogger('plugin-error-handler');

export class PluginError extends Error {
  public statusCode: number;
  public code: string;
  public details?: any;

  constructor(message: string, statusCode: number = 500, code: string = 'PLUGIN_ERROR', details?: any) {
    super(message);
    this.name = 'PluginError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    
    Error.captureStackTrace(this, PluginError);
  }
}

export class PluginValidationError extends PluginError {
  constructor(message: string, details?: any) {
    super(message, 400, 'PLUGIN_VALIDATION_ERROR', details);
    this.name = 'PluginValidationError';
  }
}

export class PluginExecutionError extends PluginError {
  constructor(message: string, details?: any) {
    super(message, 500, 'PLUGIN_EXECUTION_ERROR', details);
    this.name = 'PluginExecutionError';
  }
}

export class PluginSecurityError extends PluginError {
  constructor(message: string, details?: any) {
    super(message, 403, 'PLUGIN_SECURITY_ERROR', details);
    this.name = 'PluginSecurityError';
  }
}

export class PluginNotFoundError extends PluginError {
  constructor(pluginId: string) {
    super(`Plugin with ID ${pluginId} not found`, 404, 'PLUGIN_NOT_FOUND');
    this.name = 'PluginNotFoundError';
  }
}

export class PluginTimeoutError extends PluginError {
  constructor(timeout: number) {
    super(`Plugin execution timed out after ${timeout}ms`, 408, 'PLUGIN_TIMEOUT');
    this.name = 'PluginTimeoutError';
  }
}

export class PluginMemoryError extends PluginError {
  constructor(memoryLimit: number) {
    super(`Plugin exceeded memory limit of ${memoryLimit} bytes`, 507, 'PLUGIN_MEMORY_LIMIT');
    this.name = 'PluginMemoryError';
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
  logger.error('Plugin Manager Error Handler', {
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

  // Handle specific plugin errors
  if (error instanceof PluginError) {
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
          message: 'A plugin with this name already exists'
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
          message: 'Requested plugin not found'
        },
        requestId
      });
      return;
    }
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
  
  logger.warn('Plugin Manager Route Not Found', {
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
