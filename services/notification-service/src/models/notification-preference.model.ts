
import { PrismaClient, NotificationPreference, NotificationType, NotificationChannel } from '@prisma/client';
import { createServiceLogger } from '@ai-platform/shared-utils';
import { z } from 'zod';

const logger = createServiceLogger('notification-preference-model');

// Validation schemas
const CreatePreferenceSchema = z.object({
  userId: z.string().uuid(),
  type: z.enum(['AI_AGENT_UPDATE', 'SYSTEM_ALERT', 'BILLING_NOTICE', 'SECURITY_EVENT', 'TASK_COMPLETION', 'PLUGIN_UPDATE']),
  channels: z.array(z.enum(['EMAIL', 'SMS', 'WEBSOCKET', 'PUSH'])),
  enabled: z.boolean().default(true),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  quietHours: z.object({
    enabled: z.boolean(),
    startTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/), // HH:MM format
    endTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
    timezone: z.string().default('UTC')
  }).optional(),
  frequency: z.enum(['IMMEDIATE', 'HOURLY', 'DAILY', 'WEEKLY']).default('IMMEDIATE'),
  metadata: z.record(z.any()).optional()
});

const UpdatePreferenceSchema = CreatePreferenceSchema.partial().omit({ userId: true });

export interface NotificationPreferenceData {
  userId: string;
  type: NotificationType;
  channels: NotificationChannel[];
  enabled: boolean;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  quietHours?: {
    enabled: boolean;
    startTime: string;
    endTime: string;
    timezone: string;
  };
  frequency: 'IMMEDIATE' | 'HOURLY' | 'DAILY' | 'WEEKLY';
  metadata?: Record<string, any>;
}

export interface PreferenceFilter {
  userId?: string;
  type?: NotificationType;
  enabled?: boolean;
  channel?: NotificationChannel;
}

export class NotificationPreferenceModel {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create notification preference
   */
  async create(data: NotificationPreferenceData): Promise<NotificationPreference> {
    const validData = CreatePreferenceSchema.parse(data);

    logger.info('Creating notification preference', {
      userId: validData.userId,
      type: validData.type,
      channels: validData.channels
    });

    try {
      // Check if preference already exists for this user and type
      const existing = await this.prisma.notificationPreference.findFirst({
        where: {
          userId: validData.userId,
          type: validData.type
        }
      });

      if (existing) {
        throw new Error(`Notification preference for type ${validData.type} already exists for this user`);
      }

      const preference = await this.prisma.notificationPreference.create({
        data: {
          userId: validData.userId,
          type: validData.type,
          channels: validData.channels,
          enabled: validData.enabled,
          priority: validData.priority,
          quietHours: validData.quietHours,
          frequency: validData.frequency,
          metadata: validData.metadata
        }
      });

      logger.info('Notification preference created', {
        id: preference.id,
        userId: preference.userId,
        type: preference.type
      });

      return preference;
    } catch (error) {
      logger.error('Failed to create notification preference', {
        userId: validData.userId,
        type: validData.type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Update notification preference
   */
  async update(id: string, data: Partial<NotificationPreferenceData>): Promise<NotificationPreference> {
    const validData = UpdatePreferenceSchema.parse(data);

    logger.info('Updating notification preference', { id, updates: Object.keys(validData) });

    try {
      const preference = await this.prisma.notificationPreference.update({
        where: { id },
        data: validData
      });

      logger.info('Notification preference updated', {
        id: preference.id,
        userId: preference.userId,
        type: preference.type
      });

      return preference;
    } catch (error) {
      logger.error('Failed to update notification preference', {
        id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get notification preference by ID
   */
  async findById(id: string): Promise<NotificationPreference | null> {
    try {
      const preference = await this.prisma.notificationPreference.findUnique({
        where: { id }
      });

      logger.debug('Found notification preference', { id, found: !!preference });

      return preference;
    } catch (error) {
      logger.error('Failed to find notification preference', {
        id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Get user's notification preferences
   */
  async findByUserId(userId: string): Promise<NotificationPreference[]> {
    try {
      const preferences = await this.prisma.notificationPreference.findMany({
        where: { userId },
        orderBy: { type: 'asc' }
      });

      logger.debug('Found user notification preferences', {
        userId,
        count: preferences.length
      });

      return preferences;
    } catch (error) {
      logger.error('Failed to find user notification preferences', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Get specific preference for user and type
   */
  async findByUserAndType(userId: string, type: NotificationType): Promise<NotificationPreference | null> {
    try {
      const preference = await this.prisma.notificationPreference.findFirst({
        where: { userId, type }
      });

      logger.debug('Found user notification preference by type', {
        userId,
        type,
        found: !!preference
      });

      return preference;
    } catch (error) {
      logger.error('Failed to find notification preference by type', {
        userId,
        type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * List preferences with filtering
   */
  async list(filter: PreferenceFilter = {}, options: {
    limit?: number;
    offset?: number;
    orderBy?: 'createdAt' | 'updatedAt' | 'type';
    orderDirection?: 'asc' | 'desc';
  } = {}): Promise<{ preferences: NotificationPreference[]; total: number }> {
    const { limit = 50, offset = 0, orderBy = 'createdAt', orderDirection = 'desc' } = options;

    try {
      const where: any = {};

      if (filter.userId) where.userId = filter.userId;
      if (filter.type) where.type = filter.type;
      if (filter.enabled !== undefined) where.enabled = filter.enabled;
      if (filter.channel) where.channels = { has: filter.channel };

      const [preferences, total] = await Promise.all([
        this.prisma.notificationPreference.findMany({
          where,
          orderBy: { [orderBy]: orderDirection },
          take: limit,
          skip: offset
        }),
        this.prisma.notificationPreference.count({ where })
      ]);

      logger.debug('Listed notification preferences', {
        filter,
        count: preferences.length,
        total
      });

      return { preferences, total };
    } catch (error) {
      logger.error('Failed to list notification preferences', {
        filter,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return { preferences: [], total: 0 };
    }
  }

  /**
   * Delete notification preference
   */
  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.notificationPreference.delete({
        where: { id }
      });

      logger.info('Notification preference deleted', { id });
      return true;
    } catch (error) {
      logger.error('Failed to delete notification preference', {
        id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Create default preferences for new user
   */
  async createDefaultPreferences(userId: string): Promise<NotificationPreference[]> {
    const defaultPreferences: Omit<NotificationPreferenceData, 'userId'>[] = [
      {
        type: 'AI_AGENT_UPDATE',
        channels: ['EMAIL', 'WEBSOCKET'],
        enabled: true,
        priority: 'MEDIUM',
        frequency: 'IMMEDIATE'
      },
      {
        type: 'SYSTEM_ALERT',
        channels: ['EMAIL', 'WEBSOCKET', 'SMS'],
        enabled: true,
        priority: 'HIGH',
        frequency: 'IMMEDIATE'
      },
      {
        type: 'BILLING_NOTICE',
        channels: ['EMAIL'],
        enabled: true,
        priority: 'MEDIUM',
        frequency: 'IMMEDIATE'
      },
      {
        type: 'SECURITY_EVENT',
        channels: ['EMAIL', 'SMS'],
        enabled: true,
        priority: 'URGENT',
        frequency: 'IMMEDIATE'
      },
      {
        type: 'TASK_COMPLETION',
        channels: ['WEBSOCKET'],
        enabled: true,
        priority: 'LOW',
        frequency: 'IMMEDIATE'
      },
      {
        type: 'PLUGIN_UPDATE',
        channels: ['EMAIL', 'WEBSOCKET'],
        enabled: true,
        priority: 'LOW',
        frequency: 'DAILY'
      }
    ];

    logger.info('Creating default notification preferences', {
      userId,
      count: defaultPreferences.length
    });

    try {
      const preferences: NotificationPreference[] = [];

      for (const preferenceData of defaultPreferences) {
        try {
          const preference = await this.create({
            ...preferenceData,
            userId
          });
          preferences.push(preference);
        } catch (error) {
          // Continue if preference already exists
          logger.warn('Skipped creating default preference (may already exist)', {
            userId,
            type: preferenceData.type
          });
        }
      }

      logger.info('Default notification preferences created', {
        userId,
        created: preferences.length
      });

      return preferences;
    } catch (error) {
      logger.error('Failed to create default notification preferences', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Check if user should receive notification based on preferences
   */
  async shouldReceiveNotification(
    userId: string,
    type: NotificationType,
    channel: NotificationChannel,
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' = 'MEDIUM'
  ): Promise<{ shouldReceive: boolean; reason?: string }> {
    try {
      const preference = await this.findByUserAndType(userId, type);

      if (!preference) {
        // No preference found - use default behavior (receive high/urgent notifications)
        return {
          shouldReceive: ['HIGH', 'URGENT'].includes(priority),
          reason: 'No preference found, using default behavior'
        };
      }

      if (!preference.enabled) {
        return {
          shouldReceive: false,
          reason: 'Notifications disabled for this type'
        };
      }

      if (!preference.channels.includes(channel)) {
        return {
          shouldReceive: false,
          reason: `Channel ${channel} not enabled for this notification type`
        };
      }

      // Check priority filter
      if (preference.priority) {
        const priorityLevels = { LOW: 1, MEDIUM: 2, HIGH: 3, URGENT: 4 };
        const minLevel = priorityLevels[preference.priority];
        const currentLevel = priorityLevels[priority];

        if (currentLevel < minLevel) {
          return {
            shouldReceive: false,
            reason: `Priority ${priority} below minimum ${preference.priority}`
          };
        }
      }

      // Check quiet hours
      if (preference.quietHours?.enabled) {
        const now = new Date();
        const isInQuietHours = this.isInQuietHours(now, preference.quietHours);

        if (isInQuietHours && priority !== 'URGENT') {
          return {
            shouldReceive: false,
            reason: 'Currently in quiet hours (non-urgent notifications disabled)'
          };
        }
      }

      return {
        shouldReceive: true
      };
    } catch (error) {
      logger.error('Error checking notification preference', {
        userId,
        type,
        channel,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Default to allowing high/urgent notifications on error
      return {
        shouldReceive: ['HIGH', 'URGENT'].includes(priority),
        reason: 'Error checking preferences, using fallback'
      };
    }
  }

  /**
   * Check if current time is within quiet hours
   */
  private isInQuietHours(now: Date, quietHours: {
    startTime: string;
    endTime: string;
    timezone: string;
  }): boolean {
    try {
      // Simple implementation - could be enhanced with proper timezone handling
      const nowHours = now.getHours();
      const nowMinutes = now.getMinutes();
      const nowTime = nowHours * 60 + nowMinutes;

      const [startHours, startMinutes] = quietHours.startTime.split(':').map(Number);
      const [endHours, endMinutes] = quietHours.endTime.split(':').map(Number);
      
      const startTime = startHours * 60 + startMinutes;
      const endTime = endHours * 60 + endMinutes;

      // Handle quiet hours that span midnight
      if (startTime > endTime) {
        return nowTime >= startTime || nowTime <= endTime;
      } else {
        return nowTime >= startTime && nowTime <= endTime;
      }
    } catch (error) {
      logger.error('Error checking quiet hours', { error });
      return false;
    }
  }

  /**
   * Bulk update preferences for user
   */
  async bulkUpdateUserPreferences(
    userId: string,
    updates: Array<{
      type: NotificationType;
      updates: Partial<NotificationPreferenceData>;
    }>
  ): Promise<NotificationPreference[]> {
    logger.info('Bulk updating user preferences', {
      userId,
      updateCount: updates.length
    });

    try {
      const results: NotificationPreference[] = [];

      for (const { type, updates: updateData } of updates) {
        const existing = await this.findByUserAndType(userId, type);
        
        if (existing) {
          const updated = await this.update(existing.id, updateData);
          results.push(updated);
        } else {
          // Create new preference if it doesn't exist
          const created = await this.create({
            userId,
            type,
            channels: ['EMAIL', 'WEBSOCKET'],
            enabled: true,
            frequency: 'IMMEDIATE',
            ...updateData
          } as NotificationPreferenceData);
          results.push(created);
        }
      }

      logger.info('Bulk update completed', {
        userId,
        updated: results.length
      });

      return results;
    } catch (error) {
      logger.error('Bulk update failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get preference statistics
   */
  async getStats(): Promise<{
    totalPreferences: number;
    enabledPreferences: number;
    preferencesByType: Record<string, number>;
    preferencesByChannel: Record<string, number>;
  }> {
    try {
      const [
        totalPreferences,
        enabledPreferences,
        typeStats,
        channelStats
      ] = await Promise.all([
        this.prisma.notificationPreference.count(),
        this.prisma.notificationPreference.count({ where: { enabled: true } }),
        this.prisma.notificationPreference.groupBy({
          by: ['type'],
          _count: { type: true }
        }),
        // Channel stats would need a different approach since channels is an array
        Promise.resolve([])
      ]);

      const preferencesByType: Record<string, number> = {};
      typeStats.forEach(stat => {
        preferencesByType[stat.type] = stat._count.type;
      });

      // TODO: Implement channel statistics aggregation
      const preferencesByChannel: Record<string, number> = {
        EMAIL: 0,
        SMS: 0,
        WEBSOCKET: 0,
        PUSH: 0
      };

      return {
        totalPreferences,
        enabledPreferences,
        preferencesByType,
        preferencesByChannel
      };
    } catch (error) {
      logger.error('Failed to get preference statistics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        totalPreferences: 0,
        enabledPreferences: 0,
        preferencesByType: {},
        preferencesByChannel: {}
      };
    }
  }
}
