
/**
 * Auth Service API v1 Routes Index
 * Main router for version 1 of the authentication API
 */

import { Router } from 'express'
import authRoutes from './auth.routes'
import { Request, Response } from 'express'

const router = Router()

// Mount auth routes
router.use('/auth', authRoutes)

// API version info endpoint
router.get('/', (req: Request, res: Response) => {
  res.json({
    service: 'AI Employee Platform - Authentication Service',
    version: 'v1',
    description: 'Authentication and user session management API',
    endpoints: {
      auth: '/auth',
      health: '/auth/health',
      documentation: '/docs'
    },
    features: [
      'JWT-based authentication',
      'User registration and login',
      'Session management',
      'Role-based access control',
      'Rate limiting',
      'Security audit logging'
    ],
    support: {
      email: 'support@ai-employee-platform.com',
      documentation: 'https://docs.ai-employee-platform.com/api/v1'
    }
  })
})

// Catch-all for undefined routes in v1
router.use('*', (req: Request, res: Response) => {
  res.status(404).json({
    error: {
      code: 'ENDPOINT_NOT_FOUND',
      message: `Endpoint ${req.method} ${req.originalUrl} not found in API v1`,
      details: {
        availableEndpoints: ['/auth'],
        documentation: '/docs'
      }
    }
  })
})

export default router
