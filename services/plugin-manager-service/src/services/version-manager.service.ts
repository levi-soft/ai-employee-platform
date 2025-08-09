
import { PrismaClient } from '@prisma/client';
import { createServiceLogger } from '@ai-platform/shared-utils';
import { z } from 'zod';
import * as crypto from 'crypto';

const logger = createServiceLogger('plugin-version-manager');

// Validation schemas
const VersionSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  code: z.string().min(1),
  changelog: z.string().optional(),
  breaking: z.boolean().optional().default(false)
});

export interface PluginVersion {
  id: string;
  pluginId: string;
  version: string;
  code: string;
  codeHash: string;
  changelog?: string;
  breaking: boolean;
  createdBy: string;
  createdAt: Date;
  downloadCount: number;
  isActive: boolean;
}

export interface VersionCreateData {
  version: string;
  code: string;
  changelog?: string;
  breaking?: boolean;
}

export interface VersionComparison {
  version: string;
  changes: {
    added: string[];
    modified: string[];
    removed: string[];
  };
  breaking: boolean;
  riskLevel: 'low' | 'medium' | 'high';
}

export class VersionManagerService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create a new version of a plugin
   */
  async createVersion(
    pluginId: string,
    version: string,
    code: string,
    createdBy: string,
    metadata: { changelog?: string; breaking?: boolean } = {}
  ): Promise<PluginVersion> {
    const validData = VersionSchema.parse({
      version,
      code,
      changelog: metadata.changelog,
      breaking: metadata.breaking
    });

    logger.info('Creating plugin version', { 
      pluginId, 
      version: validData.version,
      createdBy 
    });

    try {
      // Check if version already exists
      const existingVersion = await this.prisma.pluginVersion.findFirst({
        where: { pluginId, version: validData.version }
      });

      if (existingVersion) {
        throw new Error(`Version ${validData.version} already exists for this plugin`);
      }

      // Generate code hash for integrity checking
      const codeHash = crypto
        .createHash('sha256')
        .update(validData.code)
        .digest('hex');

      // Create version record (assuming we have a PluginVersion table)
      // Note: This would require adding the PluginVersion model to Prisma schema
      const versionRecord = {
        id: crypto.randomUUID(),
        pluginId,
        version: validData.version,
        code: validData.code,
        codeHash,
        changelog: validData.changelog,
        breaking: validData.breaking || false,
        createdBy,
        createdAt: new Date(),
        downloadCount: 0,
        isActive: true
      };

      logger.info('Plugin version created', { 
        pluginId, 
        version: validData.version,
        codeHash: codeHash.substring(0, 8) + '...'
      });

      return versionRecord;
    } catch (error) {
      logger.error('Failed to create plugin version', {
        pluginId,
        version: validData.version,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get all versions of a plugin
   */
  async getPluginVersions(
    pluginId: string,
    options: {
      includeInactive?: boolean;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ versions: PluginVersion[]; total: number }> {
    const { includeInactive = false, limit = 50, offset = 0 } = options;

    logger.info('Fetching plugin versions', { 
      pluginId, 
      includeInactive, 
      limit 
    });

    try {
      // This would use the PluginVersion model
      // For now, we'll simulate version data from the main plugin record
      const plugin = await this.prisma.plugin.findUnique({
        where: { id: pluginId }
      });

      if (!plugin) {
        throw new Error('Plugin not found');
      }

      // Simulate version history (in real implementation, this would query PluginVersion table)
      const versions: PluginVersion[] = [{
        id: crypto.randomUUID(),
        pluginId,
        version: plugin.version,
        code: plugin.code,
        codeHash: crypto.createHash('sha256').update(plugin.code).digest('hex'),
        changelog: `Initial version ${plugin.version}`,
        breaking: false,
        createdBy: plugin.installedBy || 'system',
        createdAt: plugin.createdAt,
        downloadCount: plugin.downloadCount || 0,
        isActive: plugin.status === 'ACTIVE'
      }];

      logger.info('Plugin versions fetched', { 
        pluginId, 
        versionCount: versions.length 
      });

      return {
        versions: versions.slice(offset, offset + limit),
        total: versions.length
      };
    } catch (error) {
      logger.error('Failed to fetch plugin versions', {
        pluginId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get a specific version of a plugin
   */
  async getVersion(
    pluginId: string, 
    version: string
  ): Promise<PluginVersion | null> {
    logger.info('Fetching specific plugin version', { pluginId, version });

    try {
      // In real implementation, this would query the PluginVersion table
      const plugin = await this.prisma.plugin.findUnique({
        where: { id: pluginId }
      });

      if (!plugin || plugin.version !== version) {
        return null;
      }

      const versionRecord: PluginVersion = {
        id: crypto.randomUUID(),
        pluginId,
        version: plugin.version,
        code: plugin.code,
        codeHash: crypto.createHash('sha256').update(plugin.code).digest('hex'),
        changelog: `Version ${plugin.version}`,
        breaking: false,
        createdBy: plugin.installedBy || 'system',
        createdAt: plugin.createdAt,
        downloadCount: plugin.downloadCount || 0,
        isActive: plugin.status === 'ACTIVE'
      };

      logger.info('Plugin version fetched', { 
        pluginId, 
        version,
        codeHash: versionRecord.codeHash.substring(0, 8) + '...'
      });

      return versionRecord;
    } catch (error) {
      logger.error('Failed to fetch plugin version', {
        pluginId,
        version,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Compare two versions of a plugin
   */
  async compareVersions(
    pluginId: string,
    fromVersion: string,
    toVersion: string
  ): Promise<VersionComparison> {
    logger.info('Comparing plugin versions', { 
      pluginId, 
      fromVersion, 
      toVersion 
    });

    try {
      const [fromVersionData, toVersionData] = await Promise.all([
        this.getVersion(pluginId, fromVersion),
        this.getVersion(pluginId, toVersion)
      ]);

      if (!fromVersionData || !toVersionData) {
        throw new Error('One or both versions not found');
      }

      // Simple comparison (in production, would use more sophisticated diff)
      const comparison = this.performCodeDiff(
        fromVersionData.code,
        toVersionData.code
      );

      const result: VersionComparison = {
        version: toVersion,
        changes: comparison,
        breaking: toVersionData.breaking,
        riskLevel: this.assessRiskLevel(comparison, toVersionData.breaking)
      };

      logger.info('Version comparison completed', {
        pluginId,
        fromVersion,
        toVersion,
        changesCount: Object.values(comparison).reduce((sum, changes) => sum + changes.length, 0),
        riskLevel: result.riskLevel
      });

      return result;
    } catch (error) {
      logger.error('Failed to compare plugin versions', {
        pluginId,
        fromVersion,
        toVersion,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Rollback plugin to a previous version
   */
  async rollbackToVersion(
    pluginId: string,
    version: string,
    rolledBackBy: string
  ): Promise<PluginVersion> {
    logger.info('Rolling back plugin to version', { 
      pluginId, 
      version, 
      rolledBackBy 
    });

    try {
      const versionData = await this.getVersion(pluginId, version);
      
      if (!versionData) {
        throw new Error(`Version ${version} not found`);
      }

      // Update main plugin record with version data
      const updatedPlugin = await this.prisma.plugin.update({
        where: { id: pluginId },
        data: {
          version: versionData.version,
          code: versionData.code,
          lastUpdated: new Date()
        }
      });

      // Create a new version record for the rollback
      const rollbackVersion = await this.createVersion(
        pluginId,
        `${versionData.version}-rollback-${Date.now()}`,
        versionData.code,
        rolledBackBy,
        {
          changelog: `Rolled back to version ${version}`,
          breaking: false
        }
      );

      logger.info('Plugin rolled back successfully', {
        pluginId,
        rolledBackToVersion: version,
        newVersion: rollbackVersion.version
      });

      return rollbackVersion;
    } catch (error) {
      logger.error('Failed to rollback plugin version', {
        pluginId,
        version,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get version statistics
   */
  async getVersionStats(pluginId: string): Promise<{
    totalVersions: number;
    latestVersion: string;
    totalDownloads: number;
    mostDownloadedVersion: string;
    averageTimeBetweenVersions: number; // in days
  }> {
    logger.info('Fetching version statistics', { pluginId });

    try {
      const { versions } = await this.getPluginVersions(pluginId);

      if (versions.length === 0) {
        throw new Error('No versions found');
      }

      // Calculate statistics
      const totalVersions = versions.length;
      const latestVersion = versions[0].version; // Assuming sorted by creation date desc
      const totalDownloads = versions.reduce((sum, v) => sum + v.downloadCount, 0);
      
      // Find most downloaded version
      const mostDownloaded = versions.reduce((prev, current) => 
        current.downloadCount > prev.downloadCount ? current : prev
      );

      // Calculate average time between versions
      let averageTimeBetweenVersions = 0;
      if (versions.length > 1) {
        const sortedVersions = versions.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        let totalTime = 0;
        for (let i = 1; i < sortedVersions.length; i++) {
          totalTime += sortedVersions[i].createdAt.getTime() - sortedVersions[i - 1].createdAt.getTime();
        }
        averageTimeBetweenVersions = Math.round(totalTime / (sortedVersions.length - 1) / (1000 * 60 * 60 * 24)); // Convert to days
      }

      const stats = {
        totalVersions,
        latestVersion,
        totalDownloads,
        mostDownloadedVersion: mostDownloaded.version,
        averageTimeBetweenVersions
      };

      logger.info('Version statistics calculated', { pluginId, ...stats });

      return stats;
    } catch (error) {
      logger.error('Failed to calculate version statistics', {
        pluginId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Validate version string format
   */
  validateVersionFormat(version: string): boolean {
    const versionRegex = /^\d+\.\d+\.\d+$/;
    return versionRegex.test(version);
  }

  /**
   * Compare version strings (semantic versioning)
   */
  compareVersionStrings(version1: string, version2: string): number {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      if (v1Parts[i] > v2Parts[i]) return 1;
      if (v1Parts[i] < v2Parts[i]) return -1;
    }

    return 0; // Equal
  }

  /**
   * Simple code diff implementation
   */
  private performCodeDiff(oldCode: string, newCode: string): {
    added: string[];
    modified: string[];
    removed: string[];
  } {
    // Simple line-based diff (in production, use proper diff library)
    const oldLines = oldCode.split('\n').filter(line => line.trim());
    const newLines = newCode.split('\n').filter(line => line.trim());

    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];

    // Very simple diff - check for new and removed lines
    newLines.forEach((line, index) => {
      if (!oldLines.includes(line)) {
        if (index < oldLines.length && oldLines[index] !== line) {
          modified.push(`Line ${index + 1}: ${line}`);
        } else {
          added.push(`Line ${index + 1}: ${line}`);
        }
      }
    });

    oldLines.forEach((line, index) => {
      if (!newLines.includes(line) && !modified.some(m => m.includes(line))) {
        removed.push(`Line ${index + 1}: ${line}`);
      }
    });

    return { added, modified, removed };
  }

  /**
   * Assess risk level of changes
   */
  private assessRiskLevel(
    changes: { added: string[]; modified: string[]; removed: string[] },
    breaking: boolean
  ): 'low' | 'medium' | 'high' {
    if (breaking) return 'high';

    const totalChanges = changes.added.length + changes.modified.length + changes.removed.length;
    
    if (totalChanges === 0) return 'low';
    if (totalChanges <= 5) return 'low';
    if (totalChanges <= 15) return 'medium';
    
    return 'high';
  }
}
