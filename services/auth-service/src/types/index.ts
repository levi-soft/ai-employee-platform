

import type { User, Role } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: Role;
  avatarUrl?: string;
  language: string;
  timezone: string;
  isActive: boolean;
}

export interface JWTPayload {
  userId: string;
  email: string;
  role: Role;
  sessionId: string;
}

export interface RefreshTokenPayload {
  userId: string;
  sessionId: string;
  tokenVersion: number;
}

export interface SessionData {
  userId: string;
  email: string;
  role: Role;
  createdAt: Date;
  lastAccessAt: Date;
  userAgent?: string;
  ipAddress?: string;
}

export interface LoginAttempt {
  email: string;
  ipAddress: string;
  userAgent: string;
  attempts: number;
  lastAttempt: Date;
  lockedUntil?: Date;
}

export interface AuthResponse {
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ValidatedTokenData {
  userId: string;
  email: string;
  role: Role;
  sessionId: string;
}

