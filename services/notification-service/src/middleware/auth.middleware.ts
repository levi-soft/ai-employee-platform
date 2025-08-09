
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createServiceLogger } from '@ai-platform/shared-utils';

const logger = createServiceLogger('notification-auth-middleware');

// Extend Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        role: string;
        permissions: string[];
      };
    }
  }
}

export interface JWTPayload {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}

/**
 * Middleware to authenticate JWT tokens
 */
export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Access token is required'
      });
      return;
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret') as JWTPayload;

    // Attach user to request
    req.user = {
      id: decoded.id,
      email: decoded.email,
      name: decoded.name,
      role: decoded.role,
      permissions: decoded.permissions || []
    };

    logger.debug('User authenticated', { 
      userId: req.user.id, 
      role: req.user.role 
    });

    next();
  } catch (error) {
    logger.warn('Token authentication failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        success: false,
        message: 'Invalid access token'
      });
    } else if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        success: false,
        message: 'Access token expired'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Authentication error'
      });
    }
  }
};

/**
 * Middleware to check user roles
 */
export const requireRole = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    // Check if user has any of the allowed roles
    const hasRole = allowedRoles.includes(req.user.role) || 
                   allowedRoles.some(role => req.user!.permissions.includes(role));

    if (!hasRole) {
      logger.warn('Access denied - insufficient role', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRoles: allowedRoles
      });

      res.status(403).json({
        success: false,
        message: `Access denied. Required roles: ${allowedRoles.join(', ')}`
      });
      return;
    }

    logger.debug('Role check passed', {
      userId: req.user.id,
      role: req.user.role,
      requiredRoles: allowedRoles
    });

    next();
  };
};

/**
 * Optional authentication middleware
 */
export const optionalAuth = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    next();
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret') as JWTPayload;
    req.user = {
      id: decoded.id,
      email: decoded.email,
      name: decoded.name,
      role: decoded.role,
      permissions: decoded.permissions || []
    };
  } catch (error) {
    // Silently fail for optional auth
    logger.debug('Optional authentication failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }

  next();
};
