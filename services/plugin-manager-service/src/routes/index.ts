
import { Router } from 'express';
import { PluginController } from '../controllers/plugin.controller';
import { authenticateToken, requireRole } from '../middleware/auth.middleware';
import { pluginValidation, pluginRateLimit } from '../middleware/security.middleware';

const router = Router();

// Plugin lifecycle routes
router.post('/install', 
  authenticateToken, 
  requireRole(['admin', 'developer']),
  pluginValidation,
  PluginController.installPlugin
);

router.put('/:pluginId', 
  authenticateToken, 
  requireRole(['admin', 'developer']),
  pluginValidation,
  PluginController.updatePlugin
);

router.delete('/:pluginId', 
  authenticateToken, 
  requireRole(['admin']),
  PluginController.uninstallPlugin
);

router.post('/:pluginId/execute', 
  authenticateToken,
  pluginRateLimit,
  PluginController.executePlugin
);

router.get('/:pluginId', 
  authenticateToken,
  PluginController.getPlugin
);

router.get('/', 
  authenticateToken,
  PluginController.listPlugins
);

// Marketplace routes
router.get('/marketplace/search', 
  PluginController.searchMarketplace
);

router.get('/marketplace/featured', 
  PluginController.getFeaturedPlugins
);

router.get('/marketplace/stats', 
  PluginController.getMarketplaceStats
);

// Version management routes
router.get('/:pluginId/versions', 
  authenticateToken,
  PluginController.getPluginVersions
);

router.get('/:pluginId/versions/compare', 
  authenticateToken,
  PluginController.compareVersions
);

router.post('/:pluginId/versions/rollback', 
  authenticateToken, 
  requireRole(['admin', 'developer']),
  PluginController.rollbackVersion
);

export default router;
