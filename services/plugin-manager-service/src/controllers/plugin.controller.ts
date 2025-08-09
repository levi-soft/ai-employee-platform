
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createServiceLogger } from '@ai-platform/shared-utils';
import { PluginLifecycleService } from '../services/plugin-lifecycle.service';
import { MarketplaceService } from '../services/marketplace.service';
import { VersionManagerService } from '../services/version-manager.service';
import { z } from 'zod';

const logger = createServiceLogger('plugin-controller');
const prisma = new PrismaClient();

// Initialize services
const lifecycleService = new PluginLifecycleService(prisma);
const marketplaceService = new MarketplaceService(prisma);
const versionService = new VersionManagerService(prisma);

// Request validation schemas
const InstallPluginSchema = z.object({
  name: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  author: z.string().min(1).max(100),
  description: z.string().max(500),
  code: z.string().min(1),
  dependencies: z.array(z.string()).optional(),
  permissions: z.array(z.string()).optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional()
});

const UpdatePluginSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().max(500).optional(),
  code: z.string().min(1).optional(),
  dependencies: z.array(z.string()).optional(),
  permissions: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional()
});

const ExecutePluginSchema = z.object({
  input: z.any(),
  context: z.object({
    userId: z.string(),
    organizationId: z.string().optional(),
    permissions: z.array(z.string()),
    maxExecutionTime: z.number().optional(),
    maxMemory: z.number().optional()
  })
});

export class PluginController {
  /**
   * Install a new plugin
   */
  static async installPlugin(req: Request, res: Response): Promise<void> {
    try {
      const validData = InstallPluginSchema.parse(req.body);
      const installedBy = req.user?.id || 'system';

      logger.info('Installing plugin', { 
        name: validData.name, 
        version: validData.version,
        installedBy 
      });

      const plugin = await lifecycleService.installPlugin(validData, installedBy);

      res.status(201).json({
        success: true,
        message: 'Plugin installed successfully',
        data: {
          id: plugin.id,
          name: plugin.name,
          version: plugin.version,
          status: plugin.status,
          installedAt: plugin.installedAt
        }
      });
    } catch (error) {
      logger.error('Plugin installation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.errors
        });
      } else {
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Plugin installation failed'
        });
      }
    }
  }

  /**
   * Update an existing plugin
   */
  static async updatePlugin(req: Request, res: Response): Promise<void> {
    try {
      const { pluginId } = req.params;
      const validData = UpdatePluginSchema.parse(req.body);
      const updatedBy = req.user?.id || 'system';

      logger.info('Updating plugin', { pluginId, version: validData.version, updatedBy });

      const plugin = await lifecycleService.updatePlugin(pluginId, validData, updatedBy);

      res.json({
        success: true,
        message: 'Plugin updated successfully',
        data: {
          id: plugin.id,
          name: plugin.name,
          version: plugin.version,
          status: plugin.status,
          lastUpdated: plugin.lastUpdated
        }
      });
    } catch (error) {
      logger.error('Plugin update failed', {
        pluginId: req.params.pluginId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.errors
        });
      } else {
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Plugin update failed'
        });
      }
    }
  }

  /**
   * Uninstall a plugin
   */
  static async uninstallPlugin(req: Request, res: Response): Promise<void> {
    try {
      const { pluginId } = req.params;
      const uninstalledBy = req.user?.id || 'system';

      logger.info('Uninstalling plugin', { pluginId, uninstalledBy });

      const plugin = await lifecycleService.uninstallPlugin(pluginId, uninstalledBy);

      res.json({
        success: true,
        message: 'Plugin uninstalled successfully',
        data: {
          id: plugin.id,
          name: plugin.name,
          status: plugin.status,
          lastUpdated: plugin.lastUpdated
        }
      });
    } catch (error) {
      logger.error('Plugin uninstallation failed', {
        pluginId: req.params.pluginId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Plugin uninstallation failed'
      });
    }
  }

  /**
   * Execute a plugin
   */
  static async executePlugin(req: Request, res: Response): Promise<void> {
    try {
      const { pluginId } = req.params;
      const validData = ExecutePluginSchema.parse(req.body);

      logger.info('Executing plugin', { 
        pluginId, 
        userId: validData.context.userId 
      });

      const result = await lifecycleService.executePlugin(
        pluginId, 
        validData.input, 
        validData.context
      );

      res.json({
        success: true,
        message: 'Plugin executed successfully',
        data: result
      });
    } catch (error) {
      logger.error('Plugin execution failed', {
        pluginId: req.params.pluginId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.errors
        });
      } else {
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Plugin execution failed'
        });
      }
    }
  }

  /**
   * Get plugin details
   */
  static async getPlugin(req: Request, res: Response): Promise<void> {
    try {
      const { pluginId } = req.params;

      logger.info('Fetching plugin details', { pluginId });

      const plugin = await lifecycleService.getPlugin(pluginId);

      if (!plugin) {
        res.status(404).json({
          success: false,
          message: 'Plugin not found'
        });
        return;
      }

      res.json({
        success: true,
        data: plugin
      });
    } catch (error) {
      logger.error('Failed to fetch plugin', {
        pluginId: req.params.pluginId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to fetch plugin details'
      });
    }
  }

  /**
   * List plugins with filtering
   */
  static async listPlugins(req: Request, res: Response): Promise<void> {
    try {
      const {
        status,
        category,
        author,
        search,
        limit = '50',
        offset = '0'
      } = req.query;

      const options = {
        status: status as any,
        category: category as string,
        author: author as string,
        search: search as string,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      };

      logger.info('Listing plugins', options);

      const result = await lifecycleService.listPlugins(options);

      res.json({
        success: true,
        data: result.plugins,
        pagination: {
          total: result.total,
          hasMore: result.hasMore,
          limit: options.limit,
          offset: options.offset
        }
      });
    } catch (error) {
      logger.error('Failed to list plugins', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to list plugins'
      });
    }
  }

  /**
   * Search marketplace plugins
   */
  static async searchMarketplace(req: Request, res: Response): Promise<void> {
    try {
      const {
        query,
        category,
        author,
        tags,
        featured,
        limit = '20',
        offset = '0',
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query;

      const searchOptions = {
        query: query as string,
        category: category as string,
        author: author as string,
        tags: tags ? (tags as string).split(',') : undefined,
        featured: featured === 'true',
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        sortBy: sortBy as any,
        sortOrder: sortOrder as any
      };

      logger.info('Searching marketplace', searchOptions);

      const result = await marketplaceService.searchPlugins(searchOptions);

      res.json({
        success: true,
        data: result.plugins,
        pagination: result.pagination,
        total: result.total
      });
    } catch (error) {
      logger.error('Marketplace search failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Marketplace search failed'
      });
    }
  }

  /**
   * Get featured plugins
   */
  static async getFeaturedPlugins(req: Request, res: Response): Promise<void> {
    try {
      const { limit = '10' } = req.query;

      logger.info('Fetching featured plugins', { limit: parseInt(limit as string) });

      const plugins = await marketplaceService.getFeaturedPlugins(parseInt(limit as string));

      res.json({
        success: true,
        data: plugins
      });
    } catch (error) {
      logger.error('Failed to fetch featured plugins', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to fetch featured plugins'
      });
    }
  }

  /**
   * Get marketplace statistics
   */
  static async getMarketplaceStats(req: Request, res: Response): Promise<void> {
    try {
      logger.info('Fetching marketplace statistics');

      const stats = await marketplaceService.getMarketplaceStats();

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error('Failed to fetch marketplace statistics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to fetch marketplace statistics'
      });
    }
  }

  /**
   * Get plugin versions
   */
  static async getPluginVersions(req: Request, res: Response): Promise<void> {
    try {
      const { pluginId } = req.params;
      const { includeInactive = 'false', limit = '50', offset = '0' } = req.query;

      const options = {
        includeInactive: includeInactive === 'true',
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      };

      logger.info('Fetching plugin versions', { pluginId, ...options });

      const result = await versionService.getPluginVersions(pluginId, options);

      res.json({
        success: true,
        data: result.versions,
        total: result.total
      });
    } catch (error) {
      logger.error('Failed to fetch plugin versions', {
        pluginId: req.params.pluginId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to fetch plugin versions'
      });
    }
  }

  /**
   * Compare plugin versions
   */
  static async compareVersions(req: Request, res: Response): Promise<void> {
    try {
      const { pluginId } = req.params;
      const { fromVersion, toVersion } = req.query;

      if (!fromVersion || !toVersion) {
        res.status(400).json({
          success: false,
          message: 'Both fromVersion and toVersion are required'
        });
        return;
      }

      logger.info('Comparing plugin versions', { 
        pluginId, 
        fromVersion, 
        toVersion 
      });

      const comparison = await versionService.compareVersions(
        pluginId, 
        fromVersion as string, 
        toVersion as string
      );

      res.json({
        success: true,
        data: comparison
      });
    } catch (error) {
      logger.error('Version comparison failed', {
        pluginId: req.params.pluginId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Version comparison failed'
      });
    }
  }

  /**
   * Rollback plugin to previous version
   */
  static async rollbackVersion(req: Request, res: Response): Promise<void> {
    try {
      const { pluginId } = req.params;
      const { version } = req.body;
      const rolledBackBy = req.user?.id || 'system';

      if (!version) {
        res.status(400).json({
          success: false,
          message: 'Version is required for rollback'
        });
        return;
      }

      logger.info('Rolling back plugin version', { 
        pluginId, 
        version, 
        rolledBackBy 
      });

      const result = await versionService.rollbackToVersion(
        pluginId, 
        version, 
        rolledBackBy
      );

      res.json({
        success: true,
        message: 'Plugin rolled back successfully',
        data: result
      });
    } catch (error) {
      logger.error('Plugin rollback failed', {
        pluginId: req.params.pluginId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Plugin rollback failed'
      });
    }
  }
}
