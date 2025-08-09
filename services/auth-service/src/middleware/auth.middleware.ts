

import { Request, Response, NextFunction } from 'express';
import { JWTService } from '../services/jwt.service';
import { SessionService } from '../services/session.service';
import { UserModel } from '../models/user.model';
import type { Role } from '@prisma/client';
import type { AuthenticatedUser, ValidatedTokenData } from '../types';

// Extend Express Request interface to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      sessionId?: string;
    }
  }
}

/**
 * Middleware to authenticate JWT token
 */
export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = JWTService.extractBearerToken(authHeader);

    if (!token) {
      res.status(401).json({
        error: 'Access denied',
        message: 'No token provided',
        code: 'NO_TOKEN',
      });
      return;
    }

    // Verify the token
    const tokenData: ValidatedTokenData = JWTService.verifyAccessToken(token);

    // Validate session exists
    const sessionExists = await SessionService.validateSession(tokenData.sessionId);
    if (!sessionExists) {
      res.status(401).json({
        error: 'Access denied',
        message: 'Session expired',
        code: 'SESSION_EXPIRED',
      });
      return;
    }

    // Get fresh user data
    const user = await UserModel.findById(tokenData.userId);
    if (!user || !user.isActive) {
      res.status(401).json({
        error: 'Access denied',
        message: 'User not found or deactivated',
        code: 'USER_NOT_FOUND',
      });
      return;
    }

    // Extend session
    await SessionService.extendSession(tokenData.sessionId);

    // Attach user info to request
    req.user = UserModel.toAuthenticatedUser(user);
    req.sessionId = tokenData.sessionId;

    next();
  } catch (error) {
    let message = 'Token verification failed';
    let code = 'INVALID_TOKEN';

    if (error instanceof Error) {
      if (error.message === 'Token expired') {
        message = 'Token expired';
        code = 'TOKEN_EXPIRED';
      } else if (error.message === 'Invalid token') {
        message = 'Invalid token';
        code = 'INVALID_TOKEN';
      }
    }

    res.status(401).json({
      error: 'Access denied',
      message,
      code,
    });
  }
};

/**
 * Middleware to check user roles
 */
export const requireRole = (roles: Role | Role[]) => {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Access denied',
        message: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Access denied',
        message: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        required: allowedRoles,
        current: req.user.role,
      });
      return;
    }

    next();
  };
};

/**
 * Middleware to require admin role
 */
export const requireAdmin = requireRole('ADMIN');

/**
 * Middleware to require admin or employee role
 */
export const requireAuthenticated = requireRole(['ADMIN', 'EMPLOYEE']);

/**
 * Middleware for optional authentication (doesn't fail if no token)
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = JWTService.extractBearerToken(authHeader);

    if (!token) {
      // No token provided, continue without authentication
      next();
      return;
    }

    // Try to verify the token
    const tokenData: ValidatedTokenData = JWTService.verifyAccessToken(token);

    // Validate session exists
    const sessionExists = await SessionService.validateSession(tokenData.sessionId);
    if (!sessionExists) {
      // Session doesn't exist, continue without authentication
      next();
      return;
    }

    // Get user data
    const user = await UserModel.findById(tokenData.userId);
    if (user && user.isActive) {
      // Attach user info if valid
      req.user = UserModel.toAuthenticatedUser(user);
      req.sessionId = tokenData.sessionId;
      
      // Extend session
      await SessionService.extendSession(tokenData.sessionId);
    }

    next();
  } catch {
    // Authentication failed, continue without user
    next();
  }
};

/**
 * Middleware to extract user info from request
 */
export const getCurrentUser = (req: Request): AuthenticatedUser | null => {
  return req.user || null;
};

/**
 * Middleware to check if current user can access resource
 */
export const canAccessResource = (
  resourceUserId: string,
  req: Request
): boolean => {
  const currentUser = req.user;
  
  if (!currentUser) {
    return false;
  }

  // Admins can access any resource
  if (currentUser.role === 'ADMIN') {
    return true;
  }

  // Users can only access their own resources
  return currentUser.id === resourceUserId;
};

/**
 * Rate limiting data storage (simple in-memory for now)
 */
const rateLimitStore = new Map<string, { requests: number; resetTime: number }>();

/**
 * Simple rate limiting middleware
 */
export const rateLimit = (
  maxRequests: number = 100,
  windowMs: number = 15 * 60 * 1000 // 15 minutes
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const clientId = req.ip || 'unknown';
    const now = Date.now();
    
    // Clean up expired entries
    for (const [key, value] of rateLimitStore.entries()) {
      if (now > value.resetTime) {
        rateLimitStore.delete(key);
      }
    }

    // Get or create rate limit data
    let rateLimitData = rateLimitStore.get(clientId);
    if (!rateLimitData || now > rateLimitData.resetTime) {
      rateLimitData = { requests: 0, resetTime: now + windowMs };
      rateLimitStore.set(clientId, rateLimitData);
    }

    // Check if limit exceeded
    if (rateLimitData.requests >= maxRequests) {
      res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((rateLimitData.resetTime - now) / 1000),
      });
      return;
    }

    // Increment request count
    rateLimitData.requests++;
    rateLimitStore.set(clientId, rateLimitData);

    // Set rate limit headers
    res.set({
      'X-RateLimit-Limit': maxRequests.toString(),
      'X-RateLimit-Remaining': Math.max(0, maxRequests - rateLimitData.requests).toString(),
      'X-RateLimit-Reset': new Date(rateLimitData.resetTime).toISOString(),
    });

    next();
  };
};

