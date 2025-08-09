
import { Router } from 'express';
import passport from 'passport';
import { OAuthService } from '../services/oauth.service';
import { createAuditLog, AuditEventType, AuditSeverity } from '../models/audit-log.model';
import SessionMiddleware from '../middleware/session.middleware';

const router = Router();

/**
 * Get available OAuth providers
 */
router.get('/providers', (req, res) => {
  const providers = OAuthService.getConfiguredProviders();
  res.json({
    message: 'Available OAuth providers',
    data: { providers },
  });
});

/**
 * Initiate Google OAuth
 */
router.get('/google', async (req, res) => {
  try {
    if (!OAuthService.isProviderConfigured('google')) {
      res.status(404).json({
        error: 'OAuth not configured',
        message: 'Google OAuth is not configured',
      });
      return;
    }

    const redirectUrl = req.query.redirect as string;
    const state = await OAuthService.generateState(redirectUrl);
    const authUrl = OAuthService.getAuthorizationURL('google', state);

    res.redirect(authUrl);
  } catch (error) {
    console.error('Google OAuth initiation error:', error);
    res.status(500).json({
      error: 'OAuth failed',
      message: 'Failed to initiate Google OAuth',
    });
  }
});

/**
 * Google OAuth callback
 */
router.get('/google/callback', 
  passport.authenticate('google', { session: false }),
  async (req, res) => {
    try {
      const profile = req.user as any;
      const state = req.query.state as string;

      // Verify state token
      const stateData = await OAuthService.verifyState(state);
      if (!stateData) {
        await createAuditLog(AuditEventType.OAUTH_LOGIN_FAILED, {
          severity: AuditSeverity.HIGH,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          details: { provider: 'google', reason: 'Invalid state token' },
          success: false,
          errorMessage: 'Invalid or expired state token',
        });

        res.status(400).json({
          error: 'OAuth failed',
          message: 'Invalid or expired state token',
        });
        return;
      }

      // Handle OAuth callback
      const authResult = await OAuthService.handleOAuthCallback(profile, req);

      await createAuditLog(AuditEventType.OAUTH_LOGIN_SUCCESS, {
        severity: AuditSeverity.MEDIUM,
        userId: authResult.user.id,
        userEmail: authResult.user.email,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        details: {
          provider: 'google',
          isNewUser: authResult.isNewUser,
        },
        success: true,
      });

      // Redirect to frontend with tokens
      const redirectUrl = stateData.redirectUrl || process.env.FRONTEND_URL || 'http://localhost:3000';
      const params = new URLSearchParams({
        access_token: authResult.accessToken,
        refresh_token: authResult.refreshToken,
        user: JSON.stringify(authResult.user),
        is_new_user: authResult.isNewUser.toString(),
      });

      res.redirect(`${redirectUrl}/auth/callback?${params.toString()}`);
    } catch (error) {
      console.error('Google OAuth callback error:', error);
      
      await createAuditLog(AuditEventType.OAUTH_LOGIN_FAILED, {
        severity: AuditSeverity.HIGH,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        details: { provider: 'google' },
        success: false,
        errorMessage: error instanceof Error ? error.message : 'OAuth callback failed',
      });

      const errorUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${errorUrl}/auth/error?message=OAuth authentication failed`);
    }
  }
);

/**
 * Initiate GitHub OAuth
 */
router.get('/github', async (req, res) => {
  try {
    if (!OAuthService.isProviderConfigured('github')) {
      res.status(404).json({
        error: 'OAuth not configured',
        message: 'GitHub OAuth is not configured',
      });
      return;
    }

    const redirectUrl = req.query.redirect as string;
    const state = await OAuthService.generateState(redirectUrl);
    const authUrl = OAuthService.getAuthorizationURL('github', state);

    res.redirect(authUrl);
  } catch (error) {
    console.error('GitHub OAuth initiation error:', error);
    res.status(500).json({
      error: 'OAuth failed',
      message: 'Failed to initiate GitHub OAuth',
    });
  }
});

/**
 * GitHub OAuth callback
 */
router.get('/github/callback',
  passport.authenticate('github', { session: false }),
  async (req, res) => {
    try {
      const profile = req.user as any;
      const state = req.query.state as string;

      // Verify state token
      const stateData = await OAuthService.verifyState(state);
      if (!stateData) {
        await createAuditLog(AuditEventType.OAUTH_LOGIN_FAILED, {
          severity: AuditSeverity.HIGH,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          details: { provider: 'github', reason: 'Invalid state token' },
          success: false,
          errorMessage: 'Invalid or expired state token',
        });

        res.status(400).json({
          error: 'OAuth failed',
          message: 'Invalid or expired state token',
        });
        return;
      }

      // Handle OAuth callback
      const authResult = await OAuthService.handleOAuthCallback(profile, req);

      await createAuditLog(AuditEventType.OAUTH_LOGIN_SUCCESS, {
        severity: AuditSeverity.MEDIUM,
        userId: authResult.user.id,
        userEmail: authResult.user.email,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        details: {
          provider: 'github',
          isNewUser: authResult.isNewUser,
        },
        success: true,
      });

      // Redirect to frontend with tokens
      const redirectUrl = stateData.redirectUrl || process.env.FRONTEND_URL || 'http://localhost:3000';
      const params = new URLSearchParams({
        access_token: authResult.accessToken,
        refresh_token: authResult.refreshToken,
        user: JSON.stringify(authResult.user),
        is_new_user: authResult.isNewUser.toString(),
      });

      res.redirect(`${redirectUrl}/auth/callback?${params.toString()}`);
    } catch (error) {
      console.error('GitHub OAuth callback error:', error);
      
      await createAuditLog(AuditEventType.OAUTH_LOGIN_FAILED, {
        severity: AuditSeverity.HIGH,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        details: { provider: 'github' },
        success: false,
        errorMessage: error instanceof Error ? error.message : 'OAuth callback failed',
      });

      const errorUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${errorUrl}/auth/error?message=OAuth authentication failed`);
    }
  }
);

/**
 * Link OAuth account to existing user (requires authentication)
 */
router.post('/link/:provider',
  SessionMiddleware.authenticate,
  async (req, res) => {
    try {
      const provider = req.params.provider as 'google' | 'github';
      const { oauth_id } = req.body;

      if (!['google', 'github'].includes(provider)) {
        res.status(400).json({
          error: 'Invalid provider',
          message: 'Provider must be google or github',
        });
        return;
      }

      if (!oauth_id) {
        res.status(400).json({
          error: 'Missing oauth_id',
          message: 'OAuth ID is required',
        });
        return;
      }

      const success = await OAuthService.linkAccount(req.user.id, provider, oauth_id);

      if (success) {
        await createAuditLog(AuditEventType.OAUTH_ACCOUNT_LINKED, {
          severity: AuditSeverity.MEDIUM,
          userId: req.user.id,
          userEmail: req.user.email,
          sessionId: req.sessionId,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          details: { provider, oauthId: oauth_id },
          success: true,
        });

        res.json({
          message: `${provider} account linked successfully`,
        });
      } else {
        res.status(400).json({
          error: 'Link failed',
          message: 'Failed to link OAuth account',
        });
      }
    } catch (error) {
      console.error('OAuth account linking error:', error);
      
      await createAuditLog(AuditEventType.OAUTH_ACCOUNT_LINKED, {
        severity: AuditSeverity.HIGH,
        userId: req.user?.id,
        userEmail: req.user?.email,
        sessionId: req.sessionId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        details: { provider: req.params.provider },
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Account linking failed',
      });

      res.status(500).json({
        error: 'Link failed',
        message: 'Failed to link OAuth account',
      });
    }
  }
);

/**
 * Unlink OAuth account (requires authentication)
 */
router.delete('/unlink',
  SessionMiddleware.authenticate,
  async (req, res) => {
    try {
      await OAuthService.unlinkAccount(req.user.id);

      await createAuditLog(AuditEventType.OAUTH_ACCOUNT_UNLINKED, {
        severity: AuditSeverity.MEDIUM,
        userId: req.user.id,
        userEmail: req.user.email,
        sessionId: req.sessionId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        success: true,
      });

      res.json({
        message: 'OAuth account unlinked successfully',
      });
    } catch (error) {
      console.error('OAuth account unlinking error:', error);
      
      await createAuditLog(AuditEventType.OAUTH_ACCOUNT_UNLINKED, {
        severity: AuditSeverity.HIGH,
        userId: req.user?.id,
        userEmail: req.user?.email,
        sessionId: req.sessionId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Account unlinking failed',
      });

      if (error instanceof Error && error.message.includes('password')) {
        res.status(400).json({
          error: 'Unlink failed',
          message: error.message,
        });
      } else {
        res.status(500).json({
          error: 'Unlink failed',
          message: 'Failed to unlink OAuth account',
        });
      }
    }
  }
);

export default router;
