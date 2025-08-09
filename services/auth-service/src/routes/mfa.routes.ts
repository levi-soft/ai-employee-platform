
import { Router } from 'express';
import { OTPService } from '../services/otp.service';
import { createAuditLog, AuditEventType, AuditSeverity } from '../models/audit-log.model';
import SessionMiddleware from '../middleware/session.middleware';
import { z } from 'zod';

const router = Router();

// Validation schemas
const generateOTPSchema = z.object({
  type: z.enum(['email', 'sms'], { message: 'Type must be email or sms' }),
  phoneNumber: z.string().optional(),
});

const verifyOTPSchema = z.object({
  type: z.enum(['email', 'sms', 'totp'], { message: 'Type must be email, sms, or totp' }),
  code: z.string().min(4, 'Code must be at least 4 characters').max(8, 'Code must be at most 8 characters'),
});

const verifyTOTPSetupSchema = z.object({
  token: z.string().length(6, 'TOTP token must be 6 digits'),
});

/**
 * Generate OTP for email/SMS
 */
router.post('/generate-otp',
  SessionMiddleware.authenticate,
  SessionMiddleware.rateLimit({ windowMs: 300000, maxRequests: 5 }), // 5 requests per 5 minutes
  async (req, res) => {
    try {
      const validatedData = generateOTPSchema.parse(req.body);
      let success = false;

      if (validatedData.type === 'email') {
        success = await OTPService.generateEmailOTP(req.user.id, req.user.email);
      } else if (validatedData.type === 'sms') {
        if (!validatedData.phoneNumber) {
          res.status(400).json({
            error: 'Phone number required',
            message: 'Phone number is required for SMS OTP',
          });
          return;
        }
        success = await OTPService.generateSMSOTP(req.user.id, validatedData.phoneNumber);
      }

      if (success) {
        await createAuditLog(AuditEventType.MFA_VERIFIED, {
          severity: AuditSeverity.LOW,
          userId: req.user.id,
          userEmail: req.user.email,
          sessionId: req.sessionId,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          details: { type: validatedData.type, action: 'generate' },
          success: true,
        });

        res.json({
          message: `${validatedData.type.toUpperCase()} OTP sent successfully`,
        });
      } else {
        res.status(500).json({
          error: 'OTP generation failed',
          message: `Failed to send ${validatedData.type.toUpperCase()} OTP`,
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          message: 'Invalid input data',
          details: error.errors.map((err: any) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
        return;
      }

      console.error('OTP generation error:', error);
      res.status(500).json({
        error: 'OTP generation failed',
        message: 'Internal server error',
      });
    }
  }
);

/**
 * Verify OTP
 */
router.post('/verify-otp',
  SessionMiddleware.authenticate,
  SessionMiddleware.rateLimit({ windowMs: 300000, maxRequests: 10 }), // 10 attempts per 5 minutes
  async (req, res) => {
    try {
      const validatedData = verifyOTPSchema.parse(req.body);

      const isValid = await OTPService.verifyOTP(req.user.id, validatedData.code, validatedData.type);

      if (isValid) {
        await createAuditLog(AuditEventType.MFA_VERIFIED, {
          severity: AuditSeverity.MEDIUM,
          userId: req.user.id,
          userEmail: req.user.email,
          sessionId: req.sessionId,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          details: { type: validatedData.type },
          success: true,
        });

        res.json({
          message: 'OTP verified successfully',
          verified: true,
        });
      } else {
        await createAuditLog(AuditEventType.MFA_FAILED, {
          severity: AuditSeverity.MEDIUM,
          userId: req.user.id,
          userEmail: req.user.email,
          sessionId: req.sessionId,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          details: { type: validatedData.type },
          success: false,
          errorMessage: 'Invalid or expired OTP',
        });

        res.status(400).json({
          error: 'OTP verification failed',
          message: 'Invalid or expired OTP',
          verified: false,
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          message: 'Invalid input data',
          details: error.errors.map((err: any) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
        return;
      }

      console.error('OTP verification error:', error);
      res.status(500).json({
        error: 'OTP verification failed',
        message: 'Internal server error',
      });
    }
  }
);

/**
 * Setup TOTP (Time-based OTP)
 */
router.post('/setup-totp',
  SessionMiddleware.authenticate,
  async (req, res) => {
    try {
      // Check if MFA is already enabled
      const isMFAEnabled = await OTPService.isMFAEnabled(req.user.id);
      if (isMFAEnabled) {
        res.status(409).json({
          error: 'MFA already enabled',
          message: 'TOTP is already configured for this account',
        });
        return;
      }

      const mfaSetup = await OTPService.setupTOTP(req.user.id, req.user.email);

      await createAuditLog(AuditEventType.MFA_ENABLED, {
        severity: AuditSeverity.MEDIUM,
        userId: req.user.id,
        userEmail: req.user.email,
        sessionId: req.sessionId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        details: { action: 'setup_initiated' },
        success: true,
      });

      res.json({
        message: 'TOTP setup initiated. Scan QR code with your authenticator app.',
        data: {
          qrCode: mfaSetup.qrCodeUrl,
          secret: mfaSetup.secret,
          backupCodes: mfaSetup.backupCodes,
        },
      });
    } catch (error) {
      console.error('TOTP setup error:', error);
      
      await createAuditLog(AuditEventType.MFA_FAILED, {
        severity: AuditSeverity.HIGH,
        userId: req.user?.id,
        userEmail: req.user?.email,
        sessionId: req.sessionId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        details: { action: 'setup_failed' },
        success: false,
        errorMessage: 'TOTP setup failed',
      });

      res.status(500).json({
        error: 'TOTP setup failed',
        message: 'Failed to initialize TOTP setup',
      });
    }
  }
);

/**
 * Verify TOTP setup
 */
router.post('/verify-totp-setup',
  SessionMiddleware.authenticate,
  async (req, res) => {
    try {
      const validatedData = verifyTOTPSetupSchema.parse(req.body);

      const isValid = await OTPService.verifyTOTPSetup(req.user.id, validatedData.token);

      if (isValid) {
        // Generate backup codes
        const backupCodes = await OTPService.generateBackupCodes(req.user.id);

        await createAuditLog(AuditEventType.MFA_ENABLED, {
          severity: AuditSeverity.HIGH,
          userId: req.user.id,
          userEmail: req.user.email,
          sessionId: req.sessionId,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          details: { action: 'setup_completed', backupCodesGenerated: backupCodes.length },
          success: true,
        });

        res.json({
          message: 'TOTP enabled successfully',
          data: {
            enabled: true,
            backupCodes,
          },
        });
      } else {
        await createAuditLog(AuditEventType.MFA_FAILED, {
          severity: AuditSeverity.MEDIUM,
          userId: req.user.id,
          userEmail: req.user.email,
          sessionId: req.sessionId,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          details: { action: 'setup_verification_failed' },
          success: false,
          errorMessage: 'Invalid TOTP token',
        });

        res.status(400).json({
          error: 'TOTP verification failed',
          message: 'Invalid TOTP token. Please try again.',
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          message: 'Invalid input data',
          details: error.errors.map((err: any) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
        return;
      }

      console.error('TOTP verification error:', error);
      res.status(500).json({
        error: 'TOTP verification failed',
        message: 'Internal server error',
      });
    }
  }
);

/**
 * Disable MFA
 */
router.post('/disable',
  SessionMiddleware.authenticate,
  async (req, res) => {
    try {
      const { confirmationCode } = req.body;

      if (!confirmationCode) {
        res.status(400).json({
          error: 'Confirmation required',
          message: 'Please provide your current TOTP code to disable MFA',
        });
        return;
      }

      // Verify current TOTP before disabling
      const isValid = await OTPService.verifyOTP(req.user.id, confirmationCode, 'totp');

      if (!isValid) {
        await createAuditLog(AuditEventType.MFA_FAILED, {
          severity: AuditSeverity.HIGH,
          userId: req.user.id,
          userEmail: req.user.email,
          sessionId: req.sessionId,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          details: { action: 'disable_attempt_failed' },
          success: false,
          errorMessage: 'Invalid confirmation code',
        });

        res.status(400).json({
          error: 'Invalid confirmation code',
          message: 'Please provide a valid TOTP code',
        });
        return;
      }

      const success = await OTPService.disableMFA(req.user.id);

      if (success) {
        await createAuditLog(AuditEventType.MFA_DISABLED, {
          severity: AuditSeverity.HIGH,
          userId: req.user.id,
          userEmail: req.user.email,
          sessionId: req.sessionId,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          success: true,
        });

        res.json({
          message: 'MFA disabled successfully',
        });
      } else {
        res.status(500).json({
          error: 'MFA disable failed',
          message: 'Failed to disable MFA',
        });
      }
    } catch (error) {
      console.error('MFA disable error:', error);
      res.status(500).json({
        error: 'MFA disable failed',
        message: 'Internal server error',
      });
    }
  }
);

/**
 * Get MFA status
 */
router.get('/status',
  SessionMiddleware.authenticate,
  async (req, res) => {
    try {
      const isEnabled = await OTPService.isMFAEnabled(req.user.id);

      res.json({
        message: 'MFA status retrieved',
        data: {
          enabled: isEnabled,
        },
      });
    } catch (error) {
      console.error('MFA status error:', error);
      res.status(500).json({
        error: 'Status check failed',
        message: 'Failed to check MFA status',
      });
    }
  }
);

/**
 * Generate new backup codes
 */
router.post('/backup-codes',
  SessionMiddleware.authenticate,
  async (req, res) => {
    try {
      // Verify MFA is enabled
      const isEnabled = await OTPService.isMFAEnabled(req.user.id);
      if (!isEnabled) {
        res.status(400).json({
          error: 'MFA not enabled',
          message: 'MFA must be enabled to generate backup codes',
        });
        return;
      }

      const backupCodes = await OTPService.generateBackupCodes(req.user.id);

      await createAuditLog(AuditEventType.BACKUP_CODES_GENERATED, {
        severity: AuditSeverity.MEDIUM,
        userId: req.user.id,
        userEmail: req.user.email,
        sessionId: req.sessionId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        details: { codesGenerated: backupCodes.length },
        success: true,
      });

      res.json({
        message: 'Backup codes generated successfully',
        data: {
          backupCodes,
        },
      });
    } catch (error) {
      console.error('Backup codes generation error:', error);
      res.status(500).json({
        error: 'Backup codes generation failed',
        message: 'Internal server error',
      });
    }
  }
);

/**
 * Verify backup code
 */
router.post('/verify-backup-code',
  SessionMiddleware.authenticate,
  SessionMiddleware.rateLimit({ windowMs: 300000, maxRequests: 5 }), // 5 attempts per 5 minutes
  async (req, res) => {
    try {
      const { code } = req.body;

      if (!code) {
        res.status(400).json({
          error: 'Backup code required',
          message: 'Please provide a backup code',
        });
        return;
      }

      const isValid = await OTPService.verifyBackupCode(req.user.id, code);

      if (isValid) {
        await createAuditLog(AuditEventType.BACKUP_CODE_USED, {
          severity: AuditSeverity.HIGH,
          userId: req.user.id,
          userEmail: req.user.email,
          sessionId: req.sessionId,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          success: true,
        });

        res.json({
          message: 'Backup code verified successfully',
          verified: true,
        });
      } else {
        await createAuditLog(AuditEventType.MFA_FAILED, {
          severity: AuditSeverity.HIGH,
          userId: req.user.id,
          userEmail: req.user.email,
          sessionId: req.sessionId,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          details: { type: 'backup_code' },
          success: false,
          errorMessage: 'Invalid backup code',
        });

        res.status(400).json({
          error: 'Invalid backup code',
          message: 'The backup code is invalid or has already been used',
          verified: false,
        });
      }
    } catch (error) {
      console.error('Backup code verification error:', error);
      res.status(500).json({
        error: 'Backup code verification failed',
        message: 'Internal server error',
      });
    }
  }
);

export default router;
