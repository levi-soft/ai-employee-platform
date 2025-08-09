
// Authentication API client
import { BaseAPIClient } from './base-client';
import { 
  LoginRequest, 
  LoginResponse, 
  RegisterRequest, 
  ChangePasswordRequest,
  ResetPasswordRequest,
  ResetPasswordConfirmRequest,
  TwoFactorSetupRequest,
  TwoFactorVerifyRequest,
  User,
  UserProfile
} from '@ai-platform/shared-types';
import { API_ROUTES } from '@ai-platform/shared-types';

export class AuthClient extends BaseAPIClient {
  // Authentication methods
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const response = await this.post<LoginResponse>(
      API_ROUTES.AUTH.LOGIN, 
      credentials,
      { skipAuth: true }
    );
    
    if (response.data) {
      this.setTokens({
        accessToken: response.data.accessToken,
        refreshToken: response.data.refreshToken,
        expiresIn: response.data.expiresIn,
      });
    }
    
    return response.data!;
  }

  async register(userData: RegisterRequest): Promise<User> {
    const response = await this.post<User>(
      API_ROUTES.AUTH.REGISTER, 
      userData,
      { skipAuth: true }
    );
    return response.data!;
  }

  async logout(): Promise<void> {
    try {
      await this.post(API_ROUTES.AUTH.LOGOUT);
    } finally {
      this.clearTokens();
    }
  }

  async refreshToken(): Promise<LoginResponse> {
    const tokens = this.getTokens();
    if (!tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await this.post<LoginResponse>(
      API_ROUTES.AUTH.REFRESH,
      { refreshToken: tokens.refreshToken },
      { skipAuth: true }
    );

    if (response.data) {
      this.setTokens({
        accessToken: response.data.accessToken,
        refreshToken: response.data.refreshToken,
        expiresIn: response.data.expiresIn,
      });
    }

    return response.data!;
  }

  // Profile management
  async getProfile(): Promise<User> {
    const response = await this.get<User>(API_ROUTES.AUTH.PROFILE);
    return response.data!;
  }

  async updateProfile(profile: UserProfile): Promise<User> {
    const response = await this.patch<User>(API_ROUTES.AUTH.PROFILE, profile);
    return response.data!;
  }

  async changePassword(passwordData: ChangePasswordRequest): Promise<void> {
    await this.post(API_ROUTES.AUTH.CHANGE_PASSWORD, passwordData);
  }

  // Password reset
  async requestPasswordReset(resetData: ResetPasswordRequest): Promise<void> {
    await this.post(
      API_ROUTES.AUTH.RESET_PASSWORD, 
      resetData,
      { skipAuth: true }
    );
  }

  async confirmPasswordReset(resetData: ResetPasswordConfirmRequest): Promise<void> {
    await this.post(
      `${API_ROUTES.AUTH.RESET_PASSWORD}/confirm`,
      resetData,
      { skipAuth: true }
    );
  }

  // Email verification
  async resendVerificationEmail(): Promise<void> {
    await this.post(`${API_ROUTES.AUTH.VERIFY_EMAIL}/resend`);
  }

  async verifyEmail(token: string): Promise<void> {
    await this.post(
      API_ROUTES.AUTH.VERIFY_EMAIL,
      { token },
      { skipAuth: true }
    );
  }

  // Two-Factor Authentication
  async setupTwoFactor(setupData: TwoFactorSetupRequest): Promise<{
    qrCode?: string;
    backupCodes: string[];
  }> {
    const response = await this.post<{
      qrCode?: string;
      backupCodes: string[];
    }>(API_ROUTES.AUTH.TWO_FACTOR_SETUP, setupData);
    return response.data!;
  }

  async verifyTwoFactor(verifyData: TwoFactorVerifyRequest): Promise<void> {
    await this.post(API_ROUTES.AUTH.TWO_FACTOR_VERIFY, verifyData);
  }

  async disableTwoFactor(): Promise<void> {
    await this.delete(`${API_ROUTES.AUTH.TWO_FACTOR_SETUP}/disable`);
  }

  // Session management
  async getCurrentSession(): Promise<{
    user: User;
    expiresAt: Date;
    sessionId: string;
  }> {
    const response = await this.get<{
      user: User;
      expiresAt: string;
      sessionId: string;
    }>('/auth/session');
    
    return {
      ...response.data!,
      expiresAt: new Date(response.data!.expiresAt),
    };
  }

  async invalidateAllSessions(): Promise<void> {
    await this.post('/auth/sessions/invalidate-all');
    this.clearTokens();
  }

  // Utility methods
  isAuthenticated(): boolean {
    const tokens = this.getTokens();
    return !!tokens?.accessToken;
  }

  isTokenExpired(): boolean {
    const tokens = this.getTokens();
    if (!tokens?.expiresIn) return true;
    
    // Assuming expiresIn is in seconds from token issue time
    // This is a simplified check - in reality you'd need to track issue time
    return false; // Implement proper expiration check
  }
}
