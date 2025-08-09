
import { Request, Response, NextFunction } from 'express'
import { logger } from '@ai-platform/shared-utils'

export interface AppError extends Error {
  statusCode?: number
  status?: string
  isOperational?: boolean
}

export const errorHandler = (
  error: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let statusCode = error.statusCode || 500
  let message = error.message || 'Internal Server Error'

  // Log error details
  logger.error('Error occurred in AI routing service', {
    error: message,
    stack: error.stack,
    statusCode,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: (req as any).id,
    userId: (req as any).user?.id
  })

  // Handle specific error types
  if (error.name === 'ValidationError') {
    statusCode = 400
    message = 'Request validation failed'
  }

  if (error.name === 'RoutingError') {
    statusCode = 422
    message = 'Unable to route request to suitable AI agent'
  }

  if (error.name === 'AgentUnavailableError') {
    statusCode = 503
    message = 'No AI agents currently available'
  }

  if (error.name === 'CostLimitExceededError') {
    statusCode = 402
    message = 'Request exceeds cost limit'
  }

  if (error.name === 'UnauthorizedError' || error.name === 'JsonWebTokenError') {
    statusCode = 401
    message = 'Unauthorized'
  }

  // Don't leak error details in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'Internal Server Error'
  }

  res.status(statusCode).json({
    success: false,
    error: message,
    service: 'ai-routing-service',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  })
}

export const notFound = (req: Request, res: Response, next: NextFunction) => {
  const error = new Error(`Not Found - ${req.originalUrl}`) as AppError
  error.statusCode = 404
  next(error)
}

export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}
