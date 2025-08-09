

import { Request, Response } from 'express';
import { loginSchema, registerSchema } from '@ai-platform/shared-utils';
import { UserModel } from '../models/user.model';
import { JWTService } from '../services/jwt.service';
import { SessionService } from '../services/session.service';
import { connectRedis } from '../config/redis';
import { createAuditLog, AuditEventType, AuditSeverity } from '../models/audit-log.model';
import type { AuthResponse, LoginAttempt } from '../types';
import { ZodError } from 'zod';

const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5');
const LOCKOUT_TIME = parseInt(process.env.LOCKOUT_TIME || '900000'); // 15 minutes

export class AuthController {
  /**
   * User registration
   */
  static async register(req: Request, res: Response): Promise<void> {
    try {
      // Validate request body
      const validatedData = registerSchema.parse(req.body);

      // Check if user already exists
      const existingUser = await UserModel.findByEmail(validatedData.email);
      if (existingUser) {
        res.status(409).json({
          error: 'Registration failed',
          message: 'User with this email already exists',
          code: 'USER_EXISTS',
        });
        return;
      }

      // Create new user
      const user = await UserModel.create({
        email: validatedData.email,
        password: validatedData.password,
        firstName: validatedData.firstName,
        lastName: validatedData.lastName,
        role: validatedData.role,
      });

      // Create session
      const sessionId = await SessionService.createSession(
        user.id,
        user.email,
        user.role,
        {
          userAgent: req.get('User-Agent'),
          ipAddress: req.ip,
        }
      );

      // Generate tokens
      const accessToken = JWTService.generateAccessToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        sessionId,
      });

      const refreshToken = JWTService.generateRefreshToken({
        userId: user.id,
        sessionId,
        tokenVersion: 1,
      });

      const authResponse: AuthResponse = {
        user: UserModel.toAuthenticatedUser(user),
        accessToken,
        refreshToken,
        expiresIn: JWTService.getTokenExpirationTime(),
      };

      // Log successful registration
      await createAuditLog(AuditEventType.USER_REGISTERED, {
        severity: AuditSeverity.MEDIUM,
        userId: user.id,
        userEmail: user.email,
        sessionId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        details: { role: user.role },
        success: true,
      });

      res.status(201).json({
        message: 'Registration successful',
        data: authResponse,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          message: 'Invalid input data',
          code: 'VALIDATION_ERROR',
          details: error.errors.map((err: any) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
        return;
      }

      console.error('Registration error:', error);
      res.status(500).json({
        error: 'Registration failed',
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * User login
   */
  static async login(req: Request, res: Response): Promise<void> {
    try {
      // Validate request body
      const validatedData = loginSchema.parse(req.body);
      const clientId = req.ip || 'unknown';

      // Check rate limiting for login attempts
      const isBlocked = await AuthController.checkLoginAttempts(
        validatedData.email,
        clientId
      );

      if (isBlocked) {
        res.status(429).json({
          error: 'Login failed',
          message: 'Too many failed attempts. Please try again later.',
          code: 'ACCOUNT_LOCKED',
        });
        return;
      }

      // Find user by email
      const user = await UserModel.findByEmail(validatedData.email);
      if (!user) {
        await AuthController.recordFailedAttempt(validatedData.email, clientId);
        
        // Log failed login attempt
        await createAuditLog(AuditEventType.LOGIN_FAILED, {
          severity: AuditSeverity.MEDIUM,
          userEmail: validatedData.email,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          success: false,
          errorMessage: 'User not found',
        });

        res.status(401).json({
          error: 'Login failed',
          message: 'Invalid email or password',
          code: 'INVALID_CREDENTIALS',
        });
        return;
      }

      // Verify password
      const isValidPassword = await UserModel.verifyPassword(
        user,
        validatedData.password
      );

      if (!isValidPassword) {
        await AuthController.recordFailedAttempt(validatedData.email, clientId);
        
        // Log failed login attempt
        await createAuditLog(AuditEventType.LOGIN_FAILED, {
          severity: AuditSeverity.MEDIUM,
          userId: user.id,
          userEmail: user.email,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          success: false,
          errorMessage: 'Invalid password',
        });

        res.status(401).json({
          error: 'Login failed',
          message: 'Invalid email or password',
          code: 'INVALID_CREDENTIALS',
        });
        return;
      }

      // Clear failed attempts on successful login
      await AuthController.clearFailedAttempts(validatedData.email, clientId);

      // Create session
      const sessionId = await SessionService.createSession(
        user.id,
        user.email,
        user.role,
        {
          userAgent: req.get('User-Agent'),
          ipAddress: req.ip,
        }
      );

      // Generate tokens
      const accessToken = JWTService.generateAccessToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        sessionId,
      });

      const refreshToken = JWTService.generateRefreshToken({
        userId: user.id,
        sessionId,
        tokenVersion: 1,
      });

      const authResponse: AuthResponse = {
        user: UserModel.toAuthenticatedUser(user),
        accessToken,
        refreshToken,
        expiresIn: JWTService.getTokenExpirationTime(),
      };

      // Log successful login
      await createAuditLog(AuditEventType.LOGIN_SUCCESS, {
        severity: AuditSeverity.MEDIUM,
        userId: user.id,
        userEmail: user.email,
        sessionId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        success: true,
      });

      res.json({
        message: 'Login successful',
        data: authResponse,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          message: 'Invalid input data',
          code: 'VALIDATION_ERROR',
          details: error.errors.map((err: any) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
        return;
      }

      console.error('Login error:', error);
      res.status(500).json({
        error: 'Login failed',
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Refresh token
   */
  static async refreshToken(req: Request, res: Response): Promise<void> {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        res.status(400).json({
          error: 'Refresh failed',
          message: 'Refresh token is required',
          code: 'REFRESH_TOKEN_REQUIRED',
        });
        return;
      }

      // Verify refresh token
      const refreshPayload = JWTService.verifyRefreshToken(refreshToken);

      // Validate session exists
      const sessionData = await SessionService.getSession(refreshPayload.sessionId);
      if (!sessionData) {
        res.status(401).json({
          error: 'Refresh failed',
          message: 'Session expired',
          code: 'SESSION_EXPIRED',
        });
        return;
      }

      // Get fresh user data
      const user = await UserModel.findById(refreshPayload.userId);
      if (!user || !user.isActive) {
        res.status(401).json({
          error: 'Refresh failed',
          message: 'User not found or deactivated',
          code: 'USER_NOT_FOUND',
        });
        return;
      }

      // Generate new access token
      const newAccessToken = JWTService.generateAccessToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        sessionId: refreshPayload.sessionId,
      });

      // Generate new refresh token
      const newRefreshToken = JWTService.generateRefreshToken({
        userId: user.id,
        sessionId: refreshPayload.sessionId,
        tokenVersion: refreshPayload.tokenVersion + 1,
      });

      const authResponse: AuthResponse = {
        user: UserModel.toAuthenticatedUser(user),
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: JWTService.getTokenExpirationTime(),
      };

      res.json({
        message: 'Token refreshed successfully',
        data: authResponse,
      });
    } catch (error) {
      console.error('Refresh token error:', error);
      
      let message = 'Token refresh failed';
      let code = 'REFRESH_FAILED';

      if (error instanceof Error) {
        if (error.message.includes('expired')) {
          message = 'Refresh token expired';
          code = 'REFRESH_TOKEN_EXPIRED';
        } else if (error.message.includes('Invalid')) {
          message = 'Invalid refresh token';
          code = 'INVALID_REFRESH_TOKEN';
        }
      }

      res.status(401).json({
        error: 'Refresh failed',
        message,
        code,
      });
    }
  }

  /**
   * Logout user
   */
  static async logout(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = req.sessionId;

      if (sessionId) {
        await SessionService.deleteSession(sessionId);
        
        // Log logout
        await createAuditLog(AuditEventType.LOGOUT, {
          severity: AuditSeverity.LOW,
          userId: req.user?.id,
          userEmail: req.user?.email,
          sessionId,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          success: true,
        });
      }

      res.json({
        message: 'Logout successful',
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        error: 'Logout failed',
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Logout from all devices
   */
  static async logoutAll(req: Request, res: Response): Promise<void> {
    try {
      const user = req.user;

      if (user) {
        await SessionService.deleteUserSessions(user.id);
        
        // Log logout from all devices
        await createAuditLog(AuditEventType.LOGOUT_ALL, {
          severity: AuditSeverity.MEDIUM,
          userId: user.id,
          userEmail: user.email,
          sessionId: req.sessionId,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          success: true,
        });
      }

      res.json({
        message: 'Logged out from all devices',
      });
    } catch (error) {
      console.error('Logout all error:', error);
      res.status(500).json({
        error: 'Logout failed',
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Get current user profile
   */
  static async getProfile(req: Request, res: Response): Promise<void> {
    try {
      const user = req.user;

      if (!user) {
        res.status(401).json({
          error: 'Access denied',
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
        return;
      }

      res.json({
        message: 'Profile retrieved successfully',
        data: { user },
      });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({
        error: 'Profile retrieval failed',
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Verify token validity
   */
  static async verifyToken(req: Request, res: Response): Promise<void> {
    try {
      const authHeader = req.headers.authorization;
      const token = JWTService.extractBearerToken(authHeader);

      if (!token) {
        res.status(400).json({
          error: 'Verification failed',
          message: 'Token is required',
          code: 'TOKEN_REQUIRED',
        });
        return;
      }

      // Verify token
      const tokenData = JWTService.verifyAccessToken(token);

      // Validate session
      const sessionExists = await SessionService.validateSession(tokenData.sessionId);
      if (!sessionExists) {
        res.status(401).json({
          error: 'Verification failed',
          message: 'Session expired',
          code: 'SESSION_EXPIRED',
        });
        return;
      }

      res.json({
        message: 'Token is valid',
        data: {
          valid: true,
          userId: tokenData.userId,
          email: tokenData.email,
          role: tokenData.role,
          sessionId: tokenData.sessionId,
        },
      });
    } catch (error) {
      console.error('Token verification error:', error);
      
      let message = 'Token verification failed';
      let code = 'INVALID_TOKEN';

      if (error instanceof Error) {
        if (error.message === 'Token expired') {
          message = 'Token expired';
          code = 'TOKEN_EXPIRED';
        }
      }

      res.status(401).json({
        error: 'Verification failed',
        message,
        code,
      });
    }
  }

  // Helper methods for login attempt tracking
  private static async checkLoginAttempts(
    email: string,
    clientId: string
  ): Promise<boolean> {
    try {
      const redis = await connectRedis();
      const key = `login_attempts:${email}:${clientId}`;
      const attemptsData = await redis.get(key);

      if (!attemptsData) {
        return false;
      }

      const attempts: LoginAttempt = JSON.parse(attemptsData);
      
      if (attempts.lockedUntil && attempts.lockedUntil.getTime() > Date.now()) {
        return true; // Account is locked
      }

      return false;
    } catch (error) {
      console.error('Error checking login attempts:', error);
      return false;
    }
  }

  private static async recordFailedAttempt(
    email: string,
    clientId: string
  ): Promise<void> {
    try {
      const redis = await connectRedis();
      const key = `login_attempts:${email}:${clientId}`;
      const attemptsData = await redis.get(key);

      let attempts: LoginAttempt;

      if (attemptsData) {
        attempts = JSON.parse(attemptsData);
        attempts.attempts++;
        attempts.lastAttempt = new Date();
      } else {
        attempts = {
          email,
          ipAddress: clientId,
          userAgent: '',
          attempts: 1,
          lastAttempt: new Date(),
        };
      }

      // Lock account if max attempts reached
      if (attempts.attempts >= MAX_LOGIN_ATTEMPTS) {
        attempts.lockedUntil = new Date(Date.now() + LOCKOUT_TIME);
      }

      await redis.setEx(key, Math.ceil(LOCKOUT_TIME / 1000), JSON.stringify(attempts));
    } catch (error) {
      console.error('Error recording failed attempt:', error);
    }
  }

  private static async clearFailedAttempts(
    email: string,
    clientId: string
  ): Promise<void> {
    try {
      const redis = await connectRedis();
      const key = `login_attempts:${email}:${clientId}`;
      await redis.del(key);
    } catch (error) {
      console.error('Error clearing failed attempts:', error);
    }
  }
}

