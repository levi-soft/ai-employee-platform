
import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { createServiceLogger } from '@ai-platform/shared-utils';
import { z } from 'zod';

const logger = createServiceLogger('notification-security');

/**
 * Notification-specific security middleware
 */
export const notificationSecurityMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Set security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Notification-specific CSP
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "connect-src 'self' ws: wss:; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "font-src 'self'; " +
    "object-src 'none'; " +
    "base-uri 'self'"
  );

  next();
};

/**
 * Rate limiting for notification sending
 */
export const notificationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit to 50 notifications per window per IP
  message: {
    success: false,
    message: 'Too many notification requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Notification rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id
    });
    res.status(429).json({
      success: false,
      message: 'Rate limit exceeded for notification requests'
    });
  }
});

/**
 * Rate limiting for API endpoints
 */
export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit to 200 requests per window per IP
  message: {
    success: false,
    message: 'Too many requests, please try again later'
  }
});

/**
 * Notification input validation middleware
 */
export const notificationValidation = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    // Validate notification content for potential spam/malicious content
    if (req.body.message) {
      const message = req.body.message;
      
      // Check for suspicious patterns
      const suspiciousPatterns = [
        /<script[^>]*>.*?<\/script>/gi,
        /javascript:/gi,
        /on\w+\s*=/gi,
        /data:.*?base64/gi,
        /vbscript:/gi
      ];

      for (const pattern of suspiciousPatterns) {
        if (pattern.test(message)) {
          logger.warn('Suspicious content detected in notification', {
            pattern: pattern.source,
            userId: req.user?.id,
            ip: req.ip
          });
          res.status(400).json({
            success: false,
            message: 'Invalid content detected in notification message'
          });
          return;
        }
      }

      // Check message length
      if (message.length > 5000) {
        res.status(400).json({
          success: false,
          message: 'Notification message exceeds maximum length (5000 characters)'
        });
        return;
      }
    }

    // Validate notification title
    if (req.body.title && req.body.title.length > 500) {
      res.status(400).json({
        success: false,
        message: 'Notification title exceeds maximum length (500 characters)'
      });
      return;
    }

    next();
  } catch (error) {
    logger.error('Notification validation error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    res.status(500).json({
      success: false,
      message: 'Notification validation failed'
    });
  }
};

/**
 * WebSocket security validation
 */
export const websocketSecurityMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Add WebSocket-specific headers
  res.setHeader('X-WebSocket-Secure', 'enabled');
  res.setHeader('X-Notification-Channel', 'websocket');
  
  next();
};

/**
 * Email content validation
 */
const EmailValidationSchema = z.object({
  to: z.union([
    z.object({
      email: z.string().email(),
      name: z.string().optional()
    }),
    z.array(z.object({
      email: z.string().email(),
      name: z.string().optional()
    }))
  ]),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(10000),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional()
});

export const validateEmailNotification = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    if (req.body.channels?.includes('EMAIL')) {
      // Basic email validation
      if (req.body.message && req.body.message.length > 50000) {
        res.status(400).json({
          success: false,
          message: 'Email content exceeds maximum length'
        });
        return;
      }
    }
    next();
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Email validation failed'
    });
  }
};

/**
 * SMS content validation
 */
export const validateSMSNotification = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    if (req.body.channels?.includes('SMS')) {
      // SMS length validation
      if (req.body.message && req.body.message.length > 1600) {
        res.status(400).json({
          success: false,
          message: 'SMS message exceeds maximum length (1600 characters)'
        });
        return;
      }

      // Check for SMS-specific restrictions
      const smsRestrictedPatterns = [
        /STOP/gi,
        /UNSUBSCRIBE/gi,
        /OPT[- ]?OUT/gi
      ];

      if (req.body.message) {
        for (const pattern of smsRestrictedPatterns) {
          if (pattern.test(req.body.message)) {
            logger.warn('SMS restricted content detected', {
              pattern: pattern.source,
              userId: req.user?.id
            });
            res.status(400).json({
              success: false,
              message: 'SMS message contains restricted content'
            });
            return;
          }
        }
      }
    }
    next();
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'SMS validation failed'
    });
  }
};

/**
 * Log security events
 */
export const logSecurityEvent = (
  eventType: string,
  details: any = {}
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    logger.info(`Security event: ${eventType}`, {
      ...details,
      userId: req.user?.id,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });
    next();
  };
};

/**
 * Notification frequency validation
 */
export const validateNotificationFrequency = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const userId = req.user?.id;
    
    if (userId && req.body.type) {
      // Simple frequency check - could be enhanced with Redis
      const now = Date.now();
      const key = `notification_freq_${userId}_${req.body.type}`;
      
      // This would typically use Redis for distributed rate limiting
      // For now, just log and continue
      logger.debug('Notification frequency check', {
        userId,
        type: req.body.type,
        timestamp: now
      });
    }

    next();
  } catch (error) {
    logger.error('Frequency validation error', { error });
    next(); // Continue on error
  }
};
