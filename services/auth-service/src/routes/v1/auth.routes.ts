
/**
 * Auth Service API v1 Routes
 * Versioned routing for authentication endpoints
 */

import { Router } from 'express'
import { AuthController } from '../../controllers/auth.controller'
import { authenticateToken, optionalAuth, rateLimit } from '../../middleware/auth.middleware'
import { validateRequest } from '../../middleware/validation.middleware'
import { loginSchema, registerSchema, refreshTokenSchema } from '../../validation/auth.validation'

const router = Router()
const authController = new AuthController()

// Rate limiting for auth endpoints
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts. Please try again later.',
      details: { retryAfter: 300 }
    }
  }
})

const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please try again later.',
      details: { retryAfter: 300 }
    }
  }
})

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     tags:
 *       - Authentication v1
 *     summary: Register new user
 *     description: Register a new user account with email and password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserRegistration'
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Validation error
 *       409:
 *         description: Email already exists
 */
router.post('/register', authRateLimit, validateRequest(registerSchema), authController.register)

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     tags:
 *       - Authentication v1
 *     summary: User login
 *     description: Authenticate user with email and password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserLogin'
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Invalid credentials
 *       429:
 *         description: Too many login attempts
 */
router.post('/login', authRateLimit, validateRequest(loginSchema), authController.login)

/**
 * @swagger
 * /api/v1/auth/refresh:
 *   post:
 *     tags:
 *       - Authentication v1
 *     summary: Refresh access token
 *     description: Generate new access token using refresh token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 *       401:
 *         description: Invalid refresh token
 */
router.post('/refresh', generalRateLimit, validateRequest(refreshTokenSchema), authController.refreshToken)

/**
 * @swagger
 * /api/v1/auth/logout:
 *   post:
 *     tags:
 *       - Authentication v1
 *     summary: Logout user
 *     description: Invalidate current session and tokens
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *       401:
 *         description: Unauthorized
 */
router.post('/logout', authenticateToken, authController.logout)

/**
 * @swagger
 * /api/v1/auth/logout-all:
 *   post:
 *     tags:
 *       - Authentication v1
 *     summary: Logout from all devices
 *     description: Invalidate all sessions and tokens for the user
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out from all devices
 *       401:
 *         description: Unauthorized
 */
router.post('/logout-all', authenticateToken, authController.logoutAll)

/**
 * @swagger
 * /api/v1/auth/profile:
 *   get:
 *     tags:
 *       - Authentication v1
 *     summary: Get current user profile
 *     description: Retrieve the authenticated user's profile information
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 */
router.get('/profile', authenticateToken, authController.getProfile)

/**
 * @swagger
 * /api/v1/auth/verify:
 *   post:
 *     tags:
 *       - Authentication v1
 *     summary: Verify token
 *     description: Verify JWT token validity for microservice authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token is valid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Token is invalid
 */
router.post('/verify', authController.verifyToken)

// Health check endpoint (no authentication required)
/**
 * @swagger
 * /api/v1/auth/health:
 *   get:
 *     tags:
 *       - Authentication v1
 *     summary: Health check
 *     description: Check the health status of the authentication service
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: healthy
 *                 version:
 *                   type: string
 *                   example: v1.0.0
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'auth-service',
    version: 'v1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  })
})

export default router
