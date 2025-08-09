
import { Request, Response, NextFunction } from 'express'
import { RoutingService } from '../services/routing.service'
import { logger } from '@ai-platform/shared-utils'

export class RoutingController {
  private routingService: RoutingService

  constructor() {
    this.routingService = new RoutingService()
  }

  // Route a user request to the optimal AI agent
  async routeRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        prompt,
        capabilities = [],
        maxCost,
        preferredProvider,
        priority = 'normal',
        estimatedTokens,
        responseFormat = 'text'
      } = req.body

      if (!prompt) {
        return res.status(400).json({
          success: false,
          error: 'Prompt is required'
        })
      }

      const routingRequest = {
        userId: (req as any).user.id,
        prompt,
        capabilities,
        maxCost,
        preferredProvider,
        priority,
        estimatedTokens,
        responseFormat
      }

      const routingResponse = await this.routingService.routeRequest(routingRequest)

      logger.info('Request routed successfully', {
        userId: (req as any).user.id,
        selectedAgent: routingResponse.selectedAgent.id,
        score: routingResponse.reasoning.totalScore
      })

      res.json({
        success: true,
        data: routingResponse
      })

    } catch (error) {
      logger.error('Error routing request', {
        userId: (req as any).user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      next(error)
    }
  }

  // Get available capabilities across all agents
  async getCapabilities(req: Request, res: Response, next: NextFunction) {
    try {
      const capabilities = await this.routingService.getAvailableCapabilities()

      res.json({
        success: true,
        data: capabilities
      })

    } catch (error) {
      logger.error('Error getting capabilities', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      next(error)
    }
  }

  // Get routing recommendations for a user
  async getRecommendations(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.id
      const recommendations = await this.routingService.getRoutingRecommendations(userId)

      res.json({
        success: true,
        data: recommendations
      })

    } catch (error) {
      logger.error('Error getting recommendations', {
        userId: (req as any).user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      next(error)
    }
  }

  // Get routing metrics and analytics
  async getMetrics(req: Request, res: Response, next: NextFunction) {
    try {
      const { timeRange = 'day' } = req.query
      const metrics = await this.routingService.getRoutingMetrics(timeRange as any)

      res.json({
        success: true,
        data: metrics
      })

    } catch (error) {
      logger.error('Error getting routing metrics', {
        timeRange: req.query.timeRange,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      next(error)
    }
  }

  // Health check for routing service
  async healthCheck(req: Request, res: Response, next: NextFunction) {
    try {
      const health = await this.routingService.healthCheck()

      const statusCode = health.status === 'healthy' ? 200 : 
                        health.status === 'degraded' ? 200 : 503

      res.status(statusCode).json({
        success: health.status !== 'unhealthy',
        data: health
      })

    } catch (error) {
      logger.error('Error in routing health check', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      
      res.status(503).json({
        success: false,
        error: 'Routing service health check failed'
      })
    }
  }

  // Simulate a routing request for testing
  async simulateRouting(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        capabilities = ['text-generation'],
        priority = 'normal',
        estimatedTokens = 1000
      } = req.body

      const simulatedRequest = {
        userId: (req as any).user.id,
        prompt: 'Simulated test request',
        capabilities,
        priority,
        estimatedTokens,
        responseFormat: 'text' as const
      }

      const routingResponse = await this.routingService.routeRequest(simulatedRequest)

      res.json({
        success: true,
        data: {
          ...routingResponse,
          simulation: true,
          message: 'This is a simulated routing response for testing purposes'
        }
      })

    } catch (error) {
      logger.error('Error in routing simulation', {
        userId: (req as any).user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      next(error)
    }
  }

  // Get routing performance statistics
  async getPerformanceStats(req: Request, res: Response, next: NextFunction) {
    try {
      const { agentId, timeRange = 'day' } = req.query

      // This would typically come from a performance monitoring service
      const performanceStats = {
        agentId: agentId || 'all',
        timeRange,
        metrics: {
          totalRequests: 150,
          averageRoutingTime: 45,
          successRate: 98.5,
          averageResponseTime: 1200,
          costOptimizationRate: 22.3,
          topCapabilities: [
            { capability: 'text-generation', usage: 45 },
            { capability: 'analysis', usage: 32 },
            { capability: 'conversation', usage: 23 }
          ]
        },
        trends: {
          requestVolume: 'increasing',
          responseTime: 'stable',
          costEfficiency: 'improving'
        }
      }

      res.json({
        success: true,
        data: performanceStats
      })

    } catch (error) {
      logger.error('Error getting performance stats', {
        agentId: req.query.agentId,
        timeRange: req.query.timeRange,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      next(error)
    }
  }

  // Get routing insights and recommendations
  async getInsights(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.id
      const { includeOptimizations = true } = req.query

      const insights = {
        userId,
        routingInsights: [
          'Your most used capability is text-generation (65% of requests)',
          'You could save 15% on costs by scheduling batch requests during off-peak hours',
          'GPT-3.5-turbo is optimal for 78% of your typical requests'
        ],
        performanceInsights: [
          'Your requests have 20% faster response times than average',
          'Peak usage hours: 9-11 AM and 2-4 PM'
        ],
        costInsights: [
          'Monthly cost trend: $45 (stable)',
          'Potential monthly savings: $8 with optimization',
          'Cost per request has decreased 12% this month'
        ]
      }

      if (includeOptimizations === 'true') {
        const recommendations = await this.routingService.getRoutingRecommendations(userId)
        insights['optimizations'] = recommendations
      }

      res.json({
        success: true,
        data: insights
      })

    } catch (error) {
      logger.error('Error getting routing insights', {
        userId: (req as any).user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      next(error)
    }
  }
}
