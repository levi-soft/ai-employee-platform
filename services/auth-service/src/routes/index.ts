

import { Router } from 'express';
import authRoutes from './auth.routes';
import oauthRoutes from './oauth.routes';
import mfaRoutes from './mfa.routes';
import passwordResetRoutes from './password-reset.routes';

const router = Router();

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'auth-service',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// API routes
router.use('/auth', authRoutes);
router.use('/auth/oauth', oauthRoutes);
router.use('/auth/mfa', mfaRoutes);
router.use('/auth/password', passwordResetRoutes);

export default router;

