
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

  // Log incoming request with routing-specific info
  logger.info('AI routing request received', {
    requestId,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    contentType: req.get('Content-Type'),
    userId: (req as any).user?.id,
    hasPrompt: !!(req.body?.prompt),
    capabilities: req.body?.capabilities?.length || 0,
    priority: req.body?.priority || 'normal'
  })

  // Override res.json to log response with routing metrics
  const originalJson = res.json
  res.json = function(obj) {
    const duration = Date.now() - startTime
    
    // Extract routing-specific metrics from response
    const routingInfo: any = {
      requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userId: (req as any).user?.id,
      responseSize: JSON.stringify(obj).length
    }

    // Add routing-specific metrics if available
    if (obj.data?.selectedAgent) {
      routingInfo.selectedAgent = obj.data.selectedAgent.id
      routingInfo.agentProvider = obj.data.selectedAgent.provider
      routingInfo.routingScore = obj.data.reasoning?.totalScore
      routingInfo.estimatedCost = obj.data.selectedAgent.costPerToken
    }

    if (obj.data?.alternatives) {
      routingInfo.alternativeCount = obj.data.alternatives.length
    }

    logger.info('AI routing request completed', routingInfo)

    return originalJson.call(this, obj)
  }

  next()
}
