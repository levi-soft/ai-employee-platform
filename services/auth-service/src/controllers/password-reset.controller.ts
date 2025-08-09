
import { Request, Response } from 'express';
import { UserModel } from '../models/user.model';
import { OTPService } from '../services/otp.service';
import { connectRedis } from '../config/redis';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

const PASSWORD_RESET_TTL = parseInt(process.env.PASSWORD_RESET_TTL || '3600'); // 1 hour
const VERIFICATION_TTL = parseInt(process.env.VERIFICATION_TTL || '86400'); // 24 hours

const requestResetSchema = z.object({
  email: z.string().email('Invalid email format'),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Verification token is required'),
});

export interface PasswordResetData {
  userId: string;
  email: string;
  token: string;
  createdAt: Date;
  attempts: number;
}

export interface EmailVerificationData {
  userId: string;
  email: string;
  token: string;
  createdAt: Date;
}

export class PasswordResetController {
  /**
   * Request password reset
   */
  static async requestPasswordReset(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = requestResetSchema.parse(req.body);

      // Check if user exists
      const user = await UserModel.findByEmail(validatedData.email);
      if (!user) {
        // Don't reveal if user exists or not for security
        res.json({
          message: 'If an account with that email exists, you will receive a password reset link.',
        });
        return;
      }

      // Generate reset token
      const resetToken = uuidv4();
      const redis = await connectRedis();

      const resetData: PasswordResetData = {
        userId: user.id,
        email: user.email,
        token: resetToken,
        createdAt: new Date(),
        attempts: 0,
      };

      await redis.setEx(
        `password_reset:${resetToken}`,
        PASSWORD_RESET_TTL,
        JSON.stringify(resetData)
      );

      // Send password reset email
      try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransporter({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: false,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
          },
        });

        if (process.env.SMTP_USER) {
          const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
          
          await transporter.sendMail({
            from: process.env.FROM_EMAIL || process.env.SMTP_USER,
            to: user.email,
            subject: 'AI Platform - Password Reset',
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">Password Reset Request</h2>
                <p>Hello ${user.firstName},</p>
                <p>You requested to reset your password for your AI Platform account. Click the button below to reset your password:</p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a>
                </div>
                <p>Or copy and paste this URL into your browser:</p>
                <p style="word-break: break-all; color: #666;">${resetUrl}</p>
                <p>This link will expire in 1 hour.</p>
                <p style="color: #666; font-size: 12px;">If you didn't request this password reset, please ignore this email or contact support if you're concerned about your account security.</p>
              </div>
            `,
          });
        }
      } catch (emailError) {
        console.error('Error sending password reset email:', emailError);
        // Continue without failing - the token is still valid
      }

      res.json({
        message: 'If an account with that email exists, you will receive a password reset link.',
      });
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

      console.error('Password reset request error:', error);
      res.status(500).json({
        error: 'Password reset failed',
        message: 'Internal server error',
      });
    }
  }

  /**
   * Reset password with token
   */
  static async resetPassword(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = resetPasswordSchema.parse(req.body);
      const redis = await connectRedis();

      // Get reset data
      const resetDataStr = await redis.get(`password_reset:${validatedData.token}`);
      if (!resetDataStr) {
        res.status(400).json({
          error: 'Password reset failed',
          message: 'Invalid or expired reset token',
        });
        return;
      }

      const resetData: PasswordResetData = JSON.parse(resetDataStr);

      // Check attempts limit
      if (resetData.attempts >= 3) {
        await redis.del(`password_reset:${validatedData.token}`);
        res.status(429).json({
          error: 'Password reset failed',
          message: 'Too many attempts. Please request a new reset link.',
        });
        return;
      }

      // Get user
      const user = await UserModel.findById(resetData.userId);
      if (!user) {
        res.status(400).json({
          error: 'Password reset failed',
          message: 'User not found',
        });
        return;
      }

      // Hash new password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(validatedData.password, saltRounds);

      // Update password
      await UserModel.update(user.id, {
        password: hashedPassword,
        passwordChangedAt: new Date(),
      });

      // Delete reset token
      await redis.del(`password_reset:${validatedData.token}`);

      // Invalidate all user sessions (force re-login)
      await SessionService.deleteUserSessions(user.id);

      res.json({
        message: 'Password reset successfully. Please log in with your new password.',
      });
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

      console.error('Password reset error:', error);
      res.status(500).json({
        error: 'Password reset failed',
        message: 'Internal server error',
      });
    }
  }

  /**
   * Send email verification
   */
  static async sendEmailVerification(req: Request, res: Response): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({
          error: 'Authentication required',
          message: 'Please log in to verify your email',
        });
        return;
      }

      // Check if already verified
      if (user.isEmailVerified) {
        res.json({
          message: 'Email is already verified',
        });
        return;
      }

      // Generate verification token
      const verificationToken = uuidv4();
      const redis = await connectRedis();

      const verificationData: EmailVerificationData = {
        userId: user.id,
        email: user.email,
        token: verificationToken,
        createdAt: new Date(),
      };

      await redis.setEx(
        `email_verification:${verificationToken}`,
        VERIFICATION_TTL,
        JSON.stringify(verificationData)
      );

      // Send verification email
      try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransporter({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: false,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
          },
        });

        if (process.env.SMTP_USER) {
          const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${verificationToken}`;
          
          await transporter.sendMail({
            from: process.env.FROM_EMAIL || process.env.SMTP_USER,
            to: user.email,
            subject: 'AI Platform - Email Verification',
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">Email Verification</h2>
                <p>Hello ${user.firstName},</p>
                <p>Please click the button below to verify your email address:</p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${verificationUrl}" style="background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Email</a>
                </div>
                <p>Or copy and paste this URL into your browser:</p>
                <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
                <p>This link will expire in 24 hours.</p>
                <p style="color: #666; font-size: 12px;">If you didn't create an account with us, please ignore this email.</p>
              </div>
            `,
          });
        }
      } catch (emailError) {
        console.error('Error sending verification email:', emailError);
      }

      res.json({
        message: 'Verification email sent. Please check your inbox.',
      });
    } catch (error) {
      console.error('Send verification email error:', error);
      res.status(500).json({
        error: 'Email verification failed',
        message: 'Internal server error',
      });
    }
  }

  /**
   * Verify email with token
   */
  static async verifyEmail(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = verifyEmailSchema.parse(req.body);
      const redis = await connectRedis();

      // Get verification data
      const verificationDataStr = await redis.get(`email_verification:${validatedData.token}`);
      if (!verificationDataStr) {
        res.status(400).json({
          error: 'Email verification failed',
          message: 'Invalid or expired verification token',
        });
        return;
      }

      const verificationData: EmailVerificationData = JSON.parse(verificationDataStr);

      // Get user
      const user = await UserModel.findById(verificationData.userId);
      if (!user) {
        res.status(400).json({
          error: 'Email verification failed',
          message: 'User not found',
        });
        return;
      }

      // Mark email as verified
      await UserModel.update(user.id, {
        isEmailVerified: true,
        emailVerifiedAt: new Date(),
      });

      // Delete verification token
      await redis.del(`email_verification:${validatedData.token}`);

      res.json({
        message: 'Email verified successfully',
      });
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

      console.error('Email verification error:', error);
      res.status(500).json({
        error: 'Email verification failed',
        message: 'Internal server error',
      });
    }
  }

  /**
   * Verify reset token validity (for frontend validation)
   */
  static async verifyResetToken(req: Request, res: Response): Promise<void> {
    try {
      const { token } = req.params;
      const redis = await connectRedis();

      const resetDataStr = await redis.get(`password_reset:${token}`);
      if (!resetDataStr) {
        res.status(400).json({
          error: 'Token verification failed',
          message: 'Invalid or expired reset token',
        });
        return;
      }

      const resetData: PasswordResetData = JSON.parse(resetDataStr);
      
      res.json({
        message: 'Token is valid',
        email: resetData.email.replace(/(.{2}).*@/, '$1***@'), // Partially hide email
      });
    } catch (error) {
      console.error('Token verification error:', error);
      res.status(500).json({
        error: 'Token verification failed',
        message: 'Internal server error',
      });
    }
  }
}
