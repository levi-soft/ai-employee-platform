
// Authentication and authorization types
import { BaseEntity } from '../common';

export interface User extends BaseEntity {
  email: string;
  firstName: string;
  lastName: string;
  avatar?: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt?: Date;
  emailVerifiedAt?: Date;
  twoFactorEnabled: boolean;
}

export type UserRole = 'super_admin' | 'admin' | 'employee' | 'viewer';

export type UserStatus = 'active' | 'inactive' | 'pending' | 'suspended';

export interface LoginRequest {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface LoginResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: UserRole;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ResetPasswordRequest {
  email: string;
}

export interface ResetPasswordConfirmRequest {
  token: string;
  newPassword: string;
}

export interface TwoFactorSetupRequest {
  method: 'email' | 'sms';
  phoneNumber?: string;
}

export interface TwoFactorVerifyRequest {
  code: string;
  backupCode?: string;
}

export interface UserProfile {
  firstName: string;
  lastName: string;
  avatar?: string;
  timezone?: string;
  language?: string;
  notifications?: NotificationPreferences;
}

export interface NotificationPreferences {
  email: boolean;
  push: boolean;
  sms: boolean;
  marketing: boolean;
}

export interface Permission {
  id: string;
  name: string;
  resource: string;
  action: string;
  description?: string;
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  permissions: Permission[];
}

export interface SessionInfo {
  user: User;
  permissions: string[];
  roles: string[];
  sessionId: string;
  expiresAt: Date;
}
