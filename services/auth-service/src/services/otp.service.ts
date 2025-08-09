
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import { connectRedis } from '../config/redis';
import nodemailer from 'nodemailer';
import twilio from 'twilio';

const OTP_TTL = parseInt(process.env.OTP_TTL || '300'); // 5 minutes
const OTP_PREFIX = 'otp:';
const MFA_SECRET_PREFIX = 'mfa_secret:';

// Email configuration
const emailTransporter = nodemailer.createTransporter({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

// Twilio configuration
const twilioClient = process.env.TWILIO_ACCOUNT_SID 
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

export interface OTPData {
  userId: string;
  email: string;
  type: 'email' | 'sms' | 'totp';
  code: string;
  createdAt: Date;
  attempts: number;
}

export interface MFASetupData {
  userId: string;
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

export class OTPService {
  /**
   * Generate and send email OTP
   */
  static async generateEmailOTP(userId: string, email: string): Promise<boolean> {
    try {
      const code = Math.random().toString().substring(2, 8);
      const redis = await connectRedis();

      const otpData: OTPData = {
        userId,
        email,
        type: 'email',
        code,
        createdAt: new Date(),
        attempts: 0,
      };

      await redis.setEx(
        `${OTP_PREFIX}email:${userId}`,
        OTP_TTL,
        JSON.stringify(otpData)
      );

      // Send email
      if (process.env.SMTP_USER) {
        await emailTransporter.sendMail({
          from: process.env.FROM_EMAIL || process.env.SMTP_USER,
          to: email,
          subject: 'AI Platform - Verification Code',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #333;">Verification Code</h2>
              <p>Your verification code is:</p>
              <div style="background: #f4f4f4; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 2px; margin: 20px 0;">
                ${code}
              </div>
              <p>This code will expire in 5 minutes.</p>
              <p style="color: #666; font-size: 12px;">If you didn't request this code, please ignore this email.</p>
            </div>
          `,
        });
      }

      return true;
    } catch (error) {
      console.error('Error generating email OTP:', error);
      return false;
    }
  }

  /**
   * Generate and send SMS OTP
   */
  static async generateSMSOTP(userId: string, phoneNumber: string): Promise<boolean> {
    try {
      const code = Math.random().toString().substring(2, 8);
      const redis = await connectRedis();

      const otpData: OTPData = {
        userId,
        email: '',
        type: 'sms',
        code,
        createdAt: new Date(),
        attempts: 0,
      };

      await redis.setEx(
        `${OTP_PREFIX}sms:${userId}`,
        OTP_TTL,
        JSON.stringify(otpData)
      );

      // Send SMS
      if (twilioClient && process.env.TWILIO_PHONE_NUMBER) {
        await twilioClient.messages.create({
          body: `AI Platform verification code: ${code}. Valid for 5 minutes.`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: phoneNumber,
        });
      }

      return true;
    } catch (error) {
      console.error('Error generating SMS OTP:', error);
      return false;
    }
  }

  /**
   * Setup TOTP (Time-based OTP) for MFA
   */
  static async setupTOTP(userId: string, email: string): Promise<MFASetupData> {
    try {
      const secret = speakeasy.generateSecret({
        name: `AI Platform (${email})`,
        issuer: 'AI Platform',
        length: 32,
      });

      const redis = await connectRedis();

      // Generate backup codes
      const backupCodes = Array.from({ length: 10 }, () => 
        Math.random().toString(36).substring(2, 10).toUpperCase()
      );

      // Store secret temporarily (user must verify before it's permanent)
      await redis.setEx(
        `${MFA_SECRET_PREFIX}temp:${userId}`,
        3600, // 1 hour to complete setup
        JSON.stringify({
          secret: secret.base32,
          backupCodes,
          verified: false,
        })
      );

      // Generate QR code
      const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url!);

      return {
        userId,
        secret: secret.base32!,
        qrCodeUrl,
        backupCodes,
      };
    } catch (error) {
      console.error('Error setting up TOTP:', error);
      throw error;
    }
  }

  /**
   * Verify TOTP setup
   */
  static async verifyTOTPSetup(userId: string, token: string): Promise<boolean> {
    try {
      const redis = await connectRedis();
      const tempSecretData = await redis.get(`${MFA_SECRET_PREFIX}temp:${userId}`);

      if (!tempSecretData) {
        return false;
      }

      const { secret } = JSON.parse(tempSecretData);

      const verified = speakeasy.totp.verify({
        secret,
        encoding: 'base32',
        token,
        window: 2, // Allow 2 steps tolerance
      });

      if (verified) {
        // Move to permanent storage
        await redis.setEx(
          `${MFA_SECRET_PREFIX}${userId}`,
          0, // No expiration
          JSON.stringify({
            secret,
            verified: true,
            createdAt: new Date(),
          })
        );

        // Remove temporary secret
        await redis.del(`${MFA_SECRET_PREFIX}temp:${userId}`);
      }

      return verified;
    } catch (error) {
      console.error('Error verifying TOTP setup:', error);
      return false;
    }
  }

  /**
   * Verify OTP
   */
  static async verifyOTP(userId: string, code: string, type: 'email' | 'sms' | 'totp'): Promise<boolean> {
    try {
      const redis = await connectRedis();

      if (type === 'totp') {
        // Verify TOTP
        const secretData = await redis.get(`${MFA_SECRET_PREFIX}${userId}`);
        if (!secretData) {
          return false;
        }

        const { secret } = JSON.parse(secretData);
        return speakeasy.totp.verify({
          secret,
          encoding: 'base32',
          token: code,
          window: 2,
        });
      }

      // Verify email/SMS OTP
      const otpKey = `${OTP_PREFIX}${type}:${userId}`;
      const otpData = await redis.get(otpKey);

      if (!otpData) {
        return false;
      }

      const otp: OTPData = JSON.parse(otpData);

      // Check attempts limit
      if (otp.attempts >= 3) {
        await redis.del(otpKey);
        return false;
      }

      // Verify code
      if (otp.code === code) {
        await redis.del(otpKey);
        return true;
      }

      // Increment attempts
      otp.attempts++;
      await redis.setEx(otpKey, OTP_TTL, JSON.stringify(otp));
      
      return false;
    } catch (error) {
      console.error('Error verifying OTP:', error);
      return false;
    }
  }

  /**
   * Check if user has MFA enabled
   */
  static async isMFAEnabled(userId: string): Promise<boolean> {
    try {
      const redis = await connectRedis();
      const exists = await redis.exists(`${MFA_SECRET_PREFIX}${userId}`);
      return exists === 1;
    } catch (error) {
      console.error('Error checking MFA status:', error);
      return false;
    }
  }

  /**
   * Disable MFA for user
   */
  static async disableMFA(userId: string): Promise<boolean> {
    try {
      const redis = await connectRedis();
      const result = await redis.del(`${MFA_SECRET_PREFIX}${userId}`);
      return result > 0;
    } catch (error) {
      console.error('Error disabling MFA:', error);
      return false;
    }
  }

  /**
   * Generate backup codes
   */
  static async generateBackupCodes(userId: string): Promise<string[]> {
    try {
      const backupCodes = Array.from({ length: 10 }, () => 
        Math.random().toString(36).substring(2, 10).toUpperCase()
      );

      const redis = await connectRedis();
      await redis.setEx(
        `backup_codes:${userId}`,
        0, // No expiration
        JSON.stringify(backupCodes)
      );

      return backupCodes;
    } catch (error) {
      console.error('Error generating backup codes:', error);
      return [];
    }
  }

  /**
   * Verify backup code
   */
  static async verifyBackupCode(userId: string, code: string): Promise<boolean> {
    try {
      const redis = await connectRedis();
      const backupCodesData = await redis.get(`backup_codes:${userId}`);

      if (!backupCodesData) {
        return false;
      }

      const backupCodes: string[] = JSON.parse(backupCodesData);
      const codeIndex = backupCodes.indexOf(code.toUpperCase());

      if (codeIndex === -1) {
        return false;
      }

      // Remove used backup code
      backupCodes.splice(codeIndex, 1);
      await redis.setEx(
        `backup_codes:${userId}`,
        0,
        JSON.stringify(backupCodes)
      );

      return true;
    } catch (error) {
      console.error('Error verifying backup code:', error);
      return false;
    }
  }
}
