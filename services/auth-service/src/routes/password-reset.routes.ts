
import { Router } from 'express';
import { PasswordResetController } from '../controllers/password-reset.controller';
import SessionMiddleware from '../middleware/session.middleware';

const router = Router();

/**
 * Request password reset
 */
router.post('/request',
  SessionMiddleware.rateLimit({ windowMs: 900000, maxRequests: 3 }), // 3 requests per 15 minutes
  PasswordResetController.requestPasswordReset
);

/**
 * Reset password with token
 */
router.post('/reset',
  SessionMiddleware.rateLimit({ windowMs: 300000, maxRequests: 5 }), // 5 attempts per 5 minutes
  PasswordResetController.resetPassword
);

/**
 * Verify reset token (for frontend validation)
 */
router.get('/verify/:token',
  PasswordResetController.verifyResetToken
);

/**
 * Send email verification
 */
router.post('/send-verification',
  SessionMiddleware.authenticate,
  SessionMiddleware.rateLimit({ windowMs: 300000, maxRequests: 3 }), // 3 requests per 5 minutes
  PasswordResetController.sendEmailVerification
);

/**
 * Verify email with token
 */
router.post('/verify-email',
  PasswordResetController.verifyEmail
);

export default router;
