
import { PrismaClient, Plugin, PluginStatus } from '@prisma/client';
import { createServiceLogger } from '@ai-platform/shared-utils';
import { z } from 'zod';
import { ExecutionSandbox } from '../sandbox/execution-sandbox';
import { VersionManagerService } from './version-manager.service';

const logger = createServiceLogger('plugin-lifecycle');

// Validation schemas
const PluginInstallSchema = z.object({
  name: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  author: z.string().min(1).max(100),
  description: z.string().max(500),
  code: z.string().min(1),
  dependencies: z.array(z.string()).optional().default([]),
  permissions: z.array(z.string()).optional().default([]),
  category: z.string().optional().default('utility'),
  tags: z.array(z.string()).optional().default([])
});

const PluginUpdateSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().max(500).optional(),
  code: z.string().min(1).optional(),
  dependencies: z.array(z.string()).optional(),
  permissions: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional()
});

export interface PluginInstallData {
  name: string;
  version: string;
  author: string;
  description: string;
  code: string;
  dependencies?: string[];
  permissions?: string[];
  category?: string;
  tags?: string[];
}

export interface PluginUpdateData {
  version: string;
  description?: string;
  code?: string;
  dependencies?: string[];
  permissions?: string[];
  tags?: string[];
}

export interface PluginExecutionContext {
  userId: string;
  organizationId?: string;
  permissions: string[];
  maxExecutionTime?: number;
  maxMemory?: number;
}

export class PluginLifecycleService {
  private prisma: PrismaClient;
  private sandbox: ExecutionSandbox;
  private versionManager: VersionManagerService;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.sandbox = new ExecutionSandbox();
    this.versionManager = new VersionManagerService(prisma);
  }

  /**
   * Install a new plugin
   */
  async installPlugin(data: PluginInstallData, installedBy: string): Promise<Plugin> {
    const validData = PluginInstallSchema.parse(data);
    
    logger.info('Installing plugin', { 
      name: validData.name, 
      version: validData.version, 
      installedBy 
    });

    try {
      // Check if plugin with same name already exists
      const existing = await this.prisma.plugin.findFirst({
        where: { 
          name: validData.name,
          status: { in: ['ACTIVE', 'INACTIVE'] }
        }
      });

      if (existing) {
        throw new Error(`Plugin ${validData.name} already exists. Use update instead.`);
      }

      // Validate plugin code in sandbox
      const validationResult = await this.sandbox.validatePlugin(validData.code);
      if (!validationResult.isValid) {
        throw new Error(`Plugin validation failed: ${validationResult.errors.join(', ')}`);
      }

      // Create plugin record
      const plugin = await this.prisma.plugin.create({
        data: {
          name: validData.name,
          version: validData.version,
          author: validData.author,
          description: validData.description,
          code: validData.code,
          dependencies: validData.dependencies,
          permissions: validData.permissions,
          category: validData.category,
          tags: validData.tags,
          status: 'ACTIVE',
          installedBy,
          installedAt: new Date(),
          lastUpdated: new Date()
        }
      });

      // Create version record
      await this.versionManager.createVersion(plugin.id, validData.version, validData.code, installedBy);

      logger.info('Plugin installed successfully', { 
        pluginId: plugin.id, 
        name: plugin.name, 
        version: plugin.version 
      });

      return plugin;
    } catch (error) {
      logger.error('Plugin installation failed', { 
        name: validData.name, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Update an existing plugin
   */
  async updatePlugin(pluginId: string, data: PluginUpdateData, updatedBy: string): Promise<Plugin> {
    const validData = PluginUpdateSchema.parse(data);
    
    logger.info('Updating plugin', { pluginId, version: validData.version, updatedBy });

    try {
      const plugin = await this.prisma.plugin.findUnique({
        where: { id: pluginId }
      });

      if (!plugin) {
        throw new Error('Plugin not found');
      }

      if (plugin.status === 'DELETED') {
        throw new Error('Cannot update deleted plugin');
      }

      // Validate new code if provided
      if (validData.code) {
        const validationResult = await this.sandbox.validatePlugin(validData.code);
        if (!validationResult.isValid) {
          throw new Error(`Plugin validation failed: ${validationResult.errors.join(', ')}`);
        }
      }

      // Update plugin
      const updatedPlugin = await this.prisma.plugin.update({
        where: { id: pluginId },
        data: {
          version: validData.version,
          description: validData.description,
          code: validData.code,
          dependencies: validData.dependencies,
          permissions: validData.permissions,
          tags: validData.tags,
          lastUpdated: new Date()
        }
      });

      // Create new version record
      await this.versionManager.createVersion(
        pluginId, 
        validData.version, 
        validData.code || plugin.code, 
        updatedBy
      );

      logger.info('Plugin updated successfully', { 
        pluginId, 
        name: updatedPlugin.name, 
        version: updatedPlugin.version 
      });

      return updatedPlugin;
    } catch (error) {
      logger.error('Plugin update failed', { 
        pluginId, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Uninstall (soft delete) a plugin
   */
  async uninstallPlugin(pluginId: string, uninstalledBy: string): Promise<Plugin> {
    logger.info('Uninstalling plugin', { pluginId, uninstalledBy });

    try {
      const plugin = await this.prisma.plugin.findUnique({
        where: { id: pluginId }
      });

      if (!plugin) {
        throw new Error('Plugin not found');
      }

      if (plugin.status === 'DELETED') {
        throw new Error('Plugin already uninstalled');
      }

      // Check if plugin is currently in use
      const activeInstances = await this.prisma.userPlugin.count({
        where: { 
          pluginId,
          status: 'ACTIVE'
        }
      });

      if (activeInstances > 0) {
        // Deactivate all user installations first
        await this.prisma.userPlugin.updateMany({
          where: { pluginId },
          data: { status: 'INACTIVE' }
        });
      }

      // Soft delete the plugin
      const updatedPlugin = await this.prisma.plugin.update({
        where: { id: pluginId },
        data: {
          status: 'DELETED',
          lastUpdated: new Date()
        }
      });

      logger.info('Plugin uninstalled successfully', { 
        pluginId, 
        name: updatedPlugin.name, 
        affectedInstances: activeInstances 
      });

      return updatedPlugin;
    } catch (error) {
      logger.error('Plugin uninstallation failed', { 
        pluginId, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Execute a plugin with given context
   */
  async executePlugin(
    pluginId: string, 
    input: any, 
    context: PluginExecutionContext
  ): Promise<any> {
    logger.info('Executing plugin', { pluginId, userId: context.userId });

    try {
      const plugin = await this.prisma.plugin.findUnique({
        where: { id: pluginId }
      });

      if (!plugin || plugin.status !== 'ACTIVE') {
        throw new Error('Plugin not found or inactive');
      }

      // Check user permissions
      const hasPermissions = this.checkPermissions(context.permissions, plugin.permissions || []);
      if (!hasPermissions) {
        throw new Error('Insufficient permissions to execute plugin');
      }

      // Execute plugin in sandbox
      const result = await this.sandbox.executePlugin(
        plugin.code,
        input,
        {
          maxExecutionTime: context.maxExecutionTime || 30000, // 30 seconds default
          maxMemory: context.maxMemory || 128 * 1024 * 1024, // 128MB default
          permissions: context.permissions
        }
      );

      // Log execution
      await this.logPluginExecution(pluginId, context.userId, true, result);

      logger.info('Plugin executed successfully', { 
        pluginId, 
        userId: context.userId,
        executionTime: result.executionTime
      });

      return result.output;
    } catch (error) {
      await this.logPluginExecution(
        pluginId, 
        context.userId, 
        false, 
        { error: error instanceof Error ? error.message : 'Unknown error' }
      );

      logger.error('Plugin execution failed', { 
        pluginId, 
        userId: context.userId,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Get plugin information
   */
  async getPlugin(pluginId: string): Promise<Plugin | null> {
    return this.prisma.plugin.findUnique({
      where: { id: pluginId },
      include: {
        userPlugins: {
          where: { status: 'ACTIVE' },
          include: { user: { select: { id: true, name: true } } }
        }
      }
    });
  }

  /**
   * List plugins with filtering and pagination
   */
  async listPlugins(options: {
    status?: PluginStatus;
    category?: string;
    author?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    const { status, category, author, search, limit = 50, offset = 0 } = options;

    const where: any = {};

    if (status) where.status = status;
    if (category) where.category = category;
    if (author) where.author = author;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { tags: { hasSome: [search] } }
      ];
    }

    const [plugins, total] = await Promise.all([
      this.prisma.plugin.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          _count: {
            select: { userPlugins: { where: { status: 'ACTIVE' } } }
          }
        }
      }),
      this.prisma.plugin.count({ where })
    ]);

    return {
      plugins,
      total,
      hasMore: offset + limit < total
    };
  }

  /**
   * Check if user has required permissions
   */
  private checkPermissions(userPermissions: string[], requiredPermissions: string[]): boolean {
    return requiredPermissions.every(permission => 
      userPermissions.includes(permission) || userPermissions.includes('admin')
    );
  }

  /**
   * Log plugin execution for analytics
   */
  private async logPluginExecution(
    pluginId: string, 
    userId: string, 
    success: boolean, 
    result: any
  ): Promise<void> {
    try {
      // This would typically be sent to an analytics service
      // For now, just log to console in development
      if (process.env.NODE_ENV === 'development') {
        logger.debug('Plugin execution logged', {
          pluginId,
          userId,
          success,
          timestamp: new Date().toISOString(),
          result: success ? { executionTime: result.executionTime } : { error: result.error }
        });
      }
    } catch (error) {
      logger.warn('Failed to log plugin execution', { error });
    }
  }
}
