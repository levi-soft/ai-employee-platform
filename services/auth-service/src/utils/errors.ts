

/**
 * Custom error classes for the auth service
 */

export class AuthError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: any;

  constructor(
    message: string,
    code: string = 'AUTH_ERROR',
    statusCode: number = 400,
    details?: any
  ) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ValidationError extends AuthError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends AuthError {
  constructor(message: string = 'Unauthorized', code: string = 'UNAUTHORIZED') {
    super(message, code, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AuthError {
  constructor(message: string = 'Forbidden', code: string = 'FORBIDDEN') {
    super(message, code, 403);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AuthError {
  constructor(message: string = 'Not found', code: string = 'NOT_FOUND') {
    super(message, code, 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AuthError {
  constructor(message: string = 'Conflict', code: string = 'CONFLICT') {
    super(message, code, 409);
    this.name = 'ConflictError';
  }
}

export class TooManyRequestsError extends AuthError {
  constructor(message: string = 'Too many requests', code: string = 'RATE_LIMITED') {
    super(message, code, 429);
    this.name = 'TooManyRequestsError';
  }
}

export class InternalServerError extends AuthError {
  constructor(message: string = 'Internal server error', code: string = 'INTERNAL_ERROR') {
    super(message, code, 500);
    this.name = 'InternalServerError';
  }
}

/**
 * Error handler middleware for Express
 */
export const errorHandler = (error: any, req: any, res: any, next: any) => {
  console.error('Auth Service Error:', {
    error: error.message,
    code: error.code,
    stack: error.stack,
    path: req.path,
    method: req.method,
    body: req.body,
    user: req.user?.id,
  });

  if (error instanceof AuthError) {
    return res.status(error.statusCode).json({
      error: error.name,
      message: error.message,
      code: error.code,
      details: error.details,
    });
  }

  // Handle Prisma errors
  if (error.code === 'P2002') {
    return res.status(409).json({
      error: 'ConflictError',
      message: 'Resource already exists',
      code: 'DUPLICATE_ENTRY',
    });
  }

  if (error.code?.startsWith('P2')) {
    return res.status(400).json({
      error: 'DatabaseError',
      message: 'Database operation failed',
      code: 'DATABASE_ERROR',
    });
  }

  // Default error response
  res.status(500).json({
    error: 'InternalServerError',
    message: 'An unexpected error occurred',
    code: 'INTERNAL_ERROR',
  });
};

