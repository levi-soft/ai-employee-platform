

import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authenticateToken, rateLimit } from '../middleware/auth.middleware';

const router = Router();

// Rate limiting for auth endpoints
const authRateLimit = rateLimit(10, 15 * 60 * 1000); // 10 requests per 15 minutes
const generalRateLimit = rateLimit(100, 15 * 60 * 1000); // 100 requests per 15 minutes

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register', authRateLimit, AuthController.register);

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post('/login', authRateLimit, AuthController.login);

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh access token
 * @access  Public (requires refresh token)
 */
router.post('/refresh', generalRateLimit, AuthController.refreshToken);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user (single session)
 * @access  Private
 */
router.post('/logout', authenticateToken, AuthController.logout);

/**
 * @route   POST /api/auth/logout-all
 * @desc    Logout user from all sessions
 * @access  Private
 */
router.post('/logout-all', authenticateToken, AuthController.logoutAll);

/**
 * @route   GET /api/auth/profile
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/profile', authenticateToken, AuthController.getProfile);

/**
 * @route   POST /api/auth/verify
 * @desc    Verify token validity
 * @access  Public (requires token in header)
 */
router.post('/verify', generalRateLimit, AuthController.verifyToken);

export default router;

