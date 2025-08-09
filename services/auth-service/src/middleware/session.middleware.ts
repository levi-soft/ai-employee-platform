
import { Request, Response, NextFunction } from 'express';
import { SessionService } from '../services/session.service';
import { JWTService } from '../services/jwt.service';
import { UserModel } from '../models/user.model';
import { AuditLogModel, AuditEventType, AuditSeverity, createAuditLog } from '../models/audit-log.model';

export interface SessionRequest extends Request {
  sessionId?: string;
  user?: any;
}

export class SessionMiddleware {
  /**
   * Enhanced authentication middleware with audit logging
   */
  static async authenticate(req: SessionRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const authHeader = req.headers.authorization;
      const token = JWTService.extractBearerToken(authHeader);

      if (!token) {
        await createAuditLog(AuditEventType.UNAUTHORIZED_ACCESS, {
          severity: AuditSeverity.MEDIUM,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          resource: req.path,
          action: req.method,
          success: false,
          errorMessage: 'No token provided',
        });

        res.status(401).json({
          error: 'Authentication required',
          message: 'Access token is required',
          code: 'AUTH_REQUIRED',
        });
        return;
      }

      try {
        // Verify token
        const tokenData = JWTService.verifyAccessToken(token);
        
        // Validate session
        const sessionData = await SessionService.getSession(tokenData.sessionId);
        if (!sessionData) {
          await createAuditLog(AuditEventType.SESSION_EXPIRED, {
            severity: AuditSeverity.MEDIUM,
            userId: tokenData.userId,
            userEmail: tokenData.email,
            sessionId: tokenData.sessionId,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            resource: req.path,
            success: false,
            errorMessage: 'Session not found',
          });

          res.status(401).json({
            error: 'Authentication failed',
            message: 'Session expired',
            code: 'SESSION_EXPIRED',
          });
          return;
        }

        // Get fresh user data
        const user = await UserModel.findById(tokenData.userId);
        if (!user || !user.isActive) {
          await createAuditLog(AuditEventType.UNAUTHORIZED_ACCESS, {
            severity: AuditSeverity.HIGH,
            userId: tokenData.userId,
            userEmail: tokenData.email,
            sessionId: tokenData.sessionId,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            resource: req.path,
            success: false,
            errorMessage: 'User not found or deactivated',
          });

          res.status(401).json({
            error: 'Authentication failed',
            message: 'User not found or deactivated',
            code: 'USER_NOT_FOUND',
          });
          return;
        }

        // Extend session if needed (auto-renewal)
        await SessionService.extendSession(tokenData.sessionId);

        // Add to request
        req.sessionId = tokenData.sessionId;
        req.user = UserModel.toAuthenticatedUser(user);

        // Log successful API access
        await createAuditLog(AuditEventType.API_ACCESS, {
          severity: AuditSeverity.LOW,
          userId: user.id,
          userEmail: user.email,
          sessionId: tokenData.sessionId,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          resource: req.path,
          action: req.method,
          success: true,
        });

        next();
      } catch (tokenError) {
        let eventType = AuditEventType.INVALID_TOKEN;
        let message = 'Invalid token';

        if (tokenError instanceof Error) {
          if (tokenError.message === 'Token expired') {
            eventType = AuditEventType.TOKEN_EXPIRED;
            message = 'Token expired';
          }
        }

        await createAuditLog(eventType, {
          severity: AuditSeverity.MEDIUM,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          resource: req.path,
          success: false,
          errorMessage: message,
        });

        res.status(401).json({
          error: 'Authentication failed',
          message,
          code: eventType,
        });
      }
    } catch (error) {
      console.error('Authentication middleware error:', error);
      
      await createAuditLog(AuditEventType.UNAUTHORIZED_ACCESS, {
        severity: AuditSeverity.HIGH,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        resource: req.path,
        success: false,
        errorMessage: 'Authentication middleware error',
      });

      res.status(500).json({
        error: 'Authentication failed',
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Optional authentication middleware
   */
  static async optionalAuthenticate(req: SessionRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const authHeader = req.headers.authorization;
      const token = JWTService.extractBearerToken(authHeader);

      if (!token) {
        next();
        return;
      }

      try {
        const tokenData = JWTService.verifyAccessToken(token);
        const sessionData = await SessionService.getSession(tokenData.sessionId);
        
        if (sessionData) {
          const user = await UserModel.findById(tokenData.userId);
          if (user && user.isActive) {
            req.sessionId = tokenData.sessionId;
            req.user = UserModel.toAuthenticatedUser(user);
            await SessionService.extendSession(tokenData.sessionId);
          }
        }
      } catch (error) {
        // Ignore token errors for optional auth
      }

      next();
    } catch (error) {
      console.error('Optional authentication middleware error:', error);
      next();
    }
  }

  /**
   * Role-based authorization middleware
   */
  static requireRole(roles: string | string[]) {
    return async (req: SessionRequest, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!req.user) {
          await createAuditLog(AuditEventType.PERMISSION_DENIED, {
            severity: AuditSeverity.MEDIUM,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            resource: req.path,
            action: req.method,
            success: false,
            errorMessage: 'User not authenticated',
          });

          res.status(401).json({
            error: 'Authentication required',
            message: 'Please log in to access this resource',
            code: 'AUTH_REQUIRED',
          });
          return;
        }

        const requiredRoles = Array.isArray(roles) ? roles : [roles];
        const userRole = req.user.role;

        if (!requiredRoles.includes(userRole)) {
          await createAuditLog(AuditEventType.PERMISSION_DENIED, {
            severity: AuditSeverity.HIGH,
            userId: req.user.id,
            userEmail: req.user.email,
            sessionId: req.sessionId,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            resource: req.path,
            action: req.method,
            details: {
              userRole,
              requiredRoles,
            },
            success: false,
            errorMessage: `Role ${userRole} not authorized`,
          });

          res.status(403).json({
            error: 'Access denied',
            message: 'Insufficient permissions to access this resource',
            code: 'PERMISSION_DENIED',
          });
          return;
        }

        next();
      } catch (error) {
        console.error('Role authorization middleware error:', error);
        
        await createAuditLog(AuditEventType.PERMISSION_DENIED, {
          severity: AuditSeverity.HIGH,
          userId: req.user?.id,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          resource: req.path,
          success: false,
          errorMessage: 'Authorization middleware error',
        });

        res.status(500).json({
          error: 'Authorization failed',
          message: 'Internal server error',
          code: 'INTERNAL_ERROR',
        });
      }
    };
  }

  /**
   * Admin-only authorization middleware
   */
  static requireAdmin = SessionMiddleware.requireRole('ADMIN');

  /**
   * Session activity tracking middleware
   */
  static async trackActivity(req: SessionRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      // Track request details for analytics
      if (req.sessionId && req.user) {
        const activityData = {
          sessionId: req.sessionId,
          userId: req.user.id,
          method: req.method,
          path: req.path,
          userAgent: req.get('User-Agent'),
          ipAddress: req.ip,
          timestamp: new Date(),
        };

        // Store activity asynchronously (don't block request)
        setImmediate(async () => {
          try {
            const redis = await require('../config/redis').connectRedis();
            await redis.lPush(
              `session_activity:${req.sessionId}`,
              JSON.stringify(activityData)
            );
            await redis.lTrim(`session_activity:${req.sessionId}`, 0, 99); // Keep last 100 activities
            await redis.expire(`session_activity:${req.sessionId}`, 86400); // 24 hours
          } catch (error) {
            console.error('Error tracking session activity:', error);
          }
        });
      }

      next();
    } catch (error) {
      console.error('Activity tracking middleware error:', error);
      next(); // Don't block request on tracking errors
    }
  }

  /**
   * Rate limiting middleware with audit logging
   */
  static async rateLimit(options: {
    windowMs?: number;
    maxRequests?: number;
    identifier?: (req: Request) => string;
  } = {}) {
    const windowMs = options.windowMs || 900000; // 15 minutes
    const maxRequests = options.maxRequests || 100;
    const getIdentifier = options.identifier || ((req: Request) => req.ip || 'unknown');

    return async (req: SessionRequest, res: Response, next: NextFunction): Promise<void> => {
      try {
        const identifier = getIdentifier(req);
        const redis = await require('../config/redis').connectRedis();
        const key = `rate_limit:${identifier}:${Math.floor(Date.now() / windowMs)}`;

        const current = await redis.incr(key);
        await redis.expire(key, Math.ceil(windowMs / 1000));

        if (current > maxRequests) {
          await createAuditLog(AuditEventType.RATE_LIMIT_EXCEEDED, {
            severity: AuditSeverity.MEDIUM,
            userId: req.user?.id,
            userEmail: req.user?.email,
            sessionId: req.sessionId,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            resource: req.path,
            details: {
              requestCount: current,
              limit: maxRequests,
              identifier,
            },
            success: false,
            errorMessage: 'Rate limit exceeded',
          });

          res.status(429).json({
            error: 'Rate limit exceeded',
            message: `Too many requests. Limit: ${maxRequests} requests per ${windowMs / 60000} minutes`,
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: Math.ceil(windowMs / 1000),
          });
          return;
        }

        next();
      } catch (error) {
        console.error('Rate limiting middleware error:', error);
        next(); // Don't block requests on rate limiting errors
      }
    };
  }

  /**
   * Security headers middleware
   */
  static securityHeaders(req: Request, res: Response, next: NextFunction): void {
    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Download-Options', 'noopen');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    
    // Remove server information
    res.removeHeader('X-Powered-By');
    
    next();
  }

  /**
   * Session validation for concurrent session limits
   */
  static async validateConcurrentSessions(req: SessionRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user || !req.sessionId) {
        next();
        return;
      }

      const maxConcurrentSessions = parseInt(process.env.MAX_CONCURRENT_SESSIONS || '5');
      const userSessions = await SessionService.getUserSessions(req.user.id);

      if (userSessions.length > maxConcurrentSessions) {
        // Remove oldest sessions
        const sessionsToRemove = userSessions
          .sort((a, b) => new Date(a.lastAccessAt).getTime() - new Date(b.lastAccessAt).getTime())
          .slice(0, userSessions.length - maxConcurrentSessions);

        for (const session of sessionsToRemove) {
          await SessionService.deleteSession(session.sessionId!);
        }

        await createAuditLog(AuditEventType.CONCURRENT_SESSION_LIMIT, {
          severity: AuditSeverity.MEDIUM,
          userId: req.user.id,
          userEmail: req.user.email,
          sessionId: req.sessionId,
          ipAddress: req.ip,
          details: {
            removedSessions: sessionsToRemove.length,
            maxAllowed: maxConcurrentSessions,
          },
          success: true,
        });
      }

      next();
    } catch (error) {
      console.error('Concurrent session validation error:', error);
      next(); // Don't block requests on validation errors
    }
  }
}

export default SessionMiddleware;
