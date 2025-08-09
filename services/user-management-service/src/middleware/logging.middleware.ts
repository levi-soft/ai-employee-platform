
import { Request, Response, NextFunction } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { logger } from '@ai-platform/shared-utils'

export interface RequestWithId extends Request {
  id?: string
}

export const requestLogger = (req: RequestWithId, res: Response, next: NextFunction) => {
  const startTime = Date.now()
  const requestId = uuidv4()
  
  // Add request ID to request object
  req.id = requestId

  // Log incoming request
  logger.info('Incoming request', {
    requestId,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    contentType: req.get('Content-Type'),
    userId: (req as any).user?.id
  })

  // Override res.json to log response
  const originalJson = res.json
  res.json = function(obj) {
    const duration = Date.now() - startTime
    
    logger.info('Request completed', {
      requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userId: (req as any).user?.id,
      responseSize: JSON.stringify(obj).length
    })

    return originalJson.call(this, obj)
  }

  next()
}
