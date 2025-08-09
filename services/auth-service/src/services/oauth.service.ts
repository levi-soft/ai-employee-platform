
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { UserModel } from '../models/user.model';
import { SessionService } from './session.service';
import { JWTService } from './jwt.service';
import { v4 as uuidv4 } from 'uuid';
import { connectRedis } from '../config/redis';

export interface OAuthProfile {
  provider: 'google' | 'github';
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatar?: string;
}

export interface OAuthState {
  stateToken: string;
  redirectUrl?: string;
  createdAt: Date;
}

export class OAuthService {
  private static initialized = false;

  /**
   * Initialize OAuth strategies
   */
  static initialize(): void {
    if (this.initialized) {
      return;
    }

    // Google OAuth Strategy
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      passport.use(
        new GoogleStrategy(
          {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: `${process.env.BASE_URL || 'http://localhost:3001'}/api/auth/oauth/google/callback`,
          },
          async (accessToken, refreshToken, profile, done) => {
            try {
              const oauthProfile: OAuthProfile = {
                provider: 'google',
                id: profile.id,
                email: profile.emails?.[0]?.value || '',
                firstName: profile.name?.givenName || '',
                lastName: profile.name?.familyName || '',
                avatar: profile.photos?.[0]?.value,
              };

              done(null, oauthProfile);
            } catch (error) {
              done(error, null);
            }
          }
        )
      );
    }

    // GitHub OAuth Strategy
    if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
      passport.use(
        new GitHubStrategy(
          {
            clientID: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            callbackURL: `${process.env.BASE_URL || 'http://localhost:3001'}/api/auth/oauth/github/callback`,
          },
          async (accessToken: string, refreshToken: string, profile: any, done: any) => {
            try {
              const oauthProfile: OAuthProfile = {
                provider: 'github',
                id: profile.id,
                email: profile.emails?.[0]?.value || profile._json?.email || '',
                firstName: profile.displayName?.split(' ')[0] || profile.username,
                lastName: profile.displayName?.split(' ')[1] || '',
                avatar: profile.photos?.[0]?.value,
              };

              done(null, oauthProfile);
            } catch (error) {
              done(error, null);
            }
          }
        )
      );
    }

    this.initialized = true;
  }

  /**
   * Generate OAuth state token for CSRF protection
   */
  static async generateState(redirectUrl?: string): Promise<string> {
    try {
      const stateToken = uuidv4();
      const redis = await connectRedis();

      const stateData: OAuthState = {
        stateToken,
        redirectUrl,
        createdAt: new Date(),
      };

      await redis.setEx(
        `oauth_state:${stateToken}`,
        600, // 10 minutes
        JSON.stringify(stateData)
      );

      return stateToken;
    } catch (error) {
      console.error('Error generating OAuth state:', error);
      throw error;
    }
  }

  /**
   * Verify OAuth state token
   */
  static async verifyState(stateToken: string): Promise<OAuthState | null> {
    try {
      const redis = await connectRedis();
      const stateData = await redis.get(`oauth_state:${stateToken}`);

      if (!stateData) {
        return null;
      }

      const state: OAuthState = JSON.parse(stateData);
      
      // Remove used state token
      await redis.del(`oauth_state:${stateToken}`);

      return state;
    } catch (error) {
      console.error('Error verifying OAuth state:', error);
      return null;
    }
  }

  /**
   * Handle OAuth callback and user authentication
   */
  static async handleOAuthCallback(profile: OAuthProfile, req: any): Promise<{
    user: any;
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    isNewUser: boolean;
  }> {
    try {
      let user = await UserModel.findByEmail(profile.email);
      let isNewUser = false;

      if (!user) {
        // Create new user from OAuth profile
        user = await UserModel.create({
          email: profile.email,
          firstName: profile.firstName,
          lastName: profile.lastName,
          role: 'EMPLOYEE', // Default role for OAuth users
          isEmailVerified: true, // OAuth emails are pre-verified
          avatar: profile.avatar,
          oauthProvider: profile.provider,
          oauthId: profile.id,
        });
        isNewUser = true;
      } else {
        // Update existing user with OAuth info if not already set
        if (!user.oauthProvider) {
          await UserModel.update(user.id, {
            oauthProvider: profile.provider,
            oauthId: profile.id,
            isEmailVerified: true,
            avatar: profile.avatar || user.avatar,
          });
          user = { ...user, oauthProvider: profile.provider, oauthId: profile.id };
        }
      }

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

      return {
        user: UserModel.toAuthenticatedUser(user),
        accessToken,
        refreshToken,
        expiresIn: JWTService.getTokenExpirationTime(),
        isNewUser,
      };
    } catch (error) {
      console.error('Error handling OAuth callback:', error);
      throw error;
    }
  }

  /**
   * Link OAuth account to existing user
   */
  static async linkAccount(
    userId: string,
    provider: 'google' | 'github',
    oauthId: string
  ): Promise<boolean> {
    try {
      const user = await UserModel.findById(userId);
      if (!user) {
        return false;
      }

      await UserModel.update(userId, {
        oauthProvider: provider,
        oauthId,
        isEmailVerified: true,
      });

      return true;
    } catch (error) {
      console.error('Error linking OAuth account:', error);
      return false;
    }
  }

  /**
   * Unlink OAuth account from user
   */
  static async unlinkAccount(userId: string): Promise<boolean> {
    try {
      const user = await UserModel.findById(userId);
      if (!user) {
        return false;
      }

      // Check if user has password - they need either OAuth or password
      if (!user.password) {
        throw new Error('Cannot unlink OAuth account without setting a password first');
      }

      await UserModel.update(userId, {
        oauthProvider: null,
        oauthId: null,
      });

      return true;
    } catch (error) {
      console.error('Error unlinking OAuth account:', error);
      throw error;
    }
  }

  /**
   * Get OAuth authorization URL
   */
  static getAuthorizationURL(provider: 'google' | 'github', state: string): string {
    const baseUrls = {
      google: 'https://accounts.google.com/o/oauth2/v2/auth',
      github: 'https://github.com/login/oauth/authorize',
    };

    const params = new URLSearchParams();

    if (provider === 'google') {
      params.append('client_id', process.env.GOOGLE_CLIENT_ID!);
      params.append('redirect_uri', `${process.env.BASE_URL || 'http://localhost:3001'}/api/auth/oauth/google/callback`);
      params.append('scope', 'openid profile email');
      params.append('response_type', 'code');
      params.append('state', state);
    } else if (provider === 'github') {
      params.append('client_id', process.env.GITHUB_CLIENT_ID!);
      params.append('redirect_uri', `${process.env.BASE_URL || 'http://localhost:3001'}/api/auth/oauth/github/callback`);
      params.append('scope', 'user:email');
      params.append('state', state);
    }

    return `${baseUrls[provider]}?${params.toString()}`;
  }

  /**
   * Check if OAuth provider is configured
   */
  static isProviderConfigured(provider: 'google' | 'github'): boolean {
    if (provider === 'google') {
      return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    } else if (provider === 'github') {
      return !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    }
    return false;
  }

  /**
   * Get configured OAuth providers
   */
  static getConfiguredProviders(): string[] {
    const providers: string[] = [];
    
    if (this.isProviderConfigured('google')) {
      providers.push('google');
    }
    
    if (this.isProviderConfigured('github')) {
      providers.push('github');
    }
    
    return providers;
  }
}

// Initialize OAuth strategies
OAuthService.initialize();
