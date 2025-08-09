
import { Router } from 'express'
import { RoutingController } from '../controllers/routing.controller'
import { authenticateToken } from '@ai-platform/shared-utils'

const router = Router()
const routingController = new RoutingController()

// Route a request to optimal AI agent
router.post('/route',
  authenticateToken,
  routingController.routeRequest.bind(routingController)
)

// Get available capabilities
router.get('/capabilities',
  authenticateToken,
  routingController.getCapabilities.bind(routingController)
)

// Get routing recommendations for user
router.get('/recommendations',
  authenticateToken,
  routingController.getRecommendations.bind(routingController)
)

// Get routing metrics and analytics
router.get('/metrics',
  authenticateToken,
  routingController.getMetrics.bind(routingController)
)

// Get routing insights
router.get('/insights',
  authenticateToken,
  routingController.getInsights.bind(routingController)
)

// Get performance statistics
router.get('/performance',
  authenticateToken,
  routingController.getPerformanceStats.bind(routingController)
)

// Simulate routing for testing
router.post('/simulate',
  authenticateToken,
  routingController.simulateRouting.bind(routingController)
)

// Health check
router.get('/health',
  routingController.healthCheck.bind(routingController)
)

export default router
