
import { PrismaClient, Notification, NotificationStatus, NotificationType } from '@prisma/client';
import { createServiceLogger } from '@ai-platform/shared-utils';
import { z } from 'zod';

const logger = createServiceLogger('notification-history');

// Validation schemas
const CreateNotificationSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['AI_AGENT_UPDATE', 'SYSTEM_ALERT', 'BILLING_NOTICE', 'SECURITY_EVENT', 'TASK_COMPLETION', 'PLUGIN_UPDATE']),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
  userId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  status: z.enum(['PENDING', 'DELIVERED', 'READ', 'FAILED']).default('PENDING'),
  channels: z.array(z.enum(['EMAIL', 'SMS', 'WEBSOCKET', 'PUSH'])).default(['WEBSOCKET']),
  data: z.record(z.any()).optional(),
  expiresAt: z.date().optional(),
  deliveredAt: z.date().optional(),
  readAt: z.date().optional()
});

export interface NotificationData {
  id?: string;
  type: NotificationType;
  title: string;
  message: string;
  userId?: string;
  organizationId?: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: NotificationStatus;
  channels: ('EMAIL' | 'SMS' | 'WEBSOCKET' | 'PUSH')[];
  data?: Record<string, any>;
  expiresAt?: Date;
  deliveredAt?: Date;
  readAt?: Date;
}

export interface NotificationFilter {
  userId?: string;
  organizationId?: string;
  type?: NotificationType;
  status?: NotificationStatus;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  dateFrom?: Date;
  dateTo?: Date;
  unreadOnly?: boolean;
}

export interface NotificationStats {
  total: number;
  unread: number;
  byStatus: Record<NotificationStatus, number>;
  byType: Record<NotificationType, number>;
  byPriority: Record<string, number>;
  recentActivity: {
    last24h: number;
    last7days: number;
    last30days: number;
  };
}

export class NotificationHistoryService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create a new notification record
   */
  async createNotification(data: NotificationData): Promise<Notification> {
    const validData = CreateNotificationSchema.parse(data);

    logger.info('Creating notification record', {
      type: validData.type,
      userId: validData.userId,
      organizationId: validData.organizationId,
      priority: validData.priority
    });

    try {
      const notification = await this.prisma.notification.create({
        data: {
          id: validData.id,
          type: validData.type,
          title: validData.title,
          message: validData.message,
          userId: validData.userId,
          organizationId: validData.organizationId,
          priority: validData.priority,
          status: validData.status,
          channels: validData.channels,
          data: validData.data,
          expiresAt: validData.expiresAt,
          deliveredAt: validData.deliveredAt,
          readAt: validData.readAt
        }
      });

      logger.info('Notification record created', {
        id: notification.id,
        type: notification.type,
        status: notification.status
      });

      return notification;
    } catch (error) {
      logger.error('Failed to create notification record', {
        type: validData.type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get notification by ID
   */
  async getNotification(id: string): Promise<Notification | null> {
    try {
      const notification = await this.prisma.notification.findUnique({
        where: { id }
      });

      logger.debug('Retrieved notification', { id, found: !!notification });

      return notification;
    } catch (error) {
      logger.error('Failed to get notification', {
        id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Get user notifications with filtering and pagination
   */
  async getUserNotifications(
    userId: string,
    options: {
      status?: NotificationStatus;
      type?: NotificationType;
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
      limit?: number;
      offset?: number;
      orderBy?: 'createdAt' | 'priority' | 'updatedAt';
      orderDirection?: 'asc' | 'desc';
      unreadOnly?: boolean;
      includeExpired?: boolean;
    } = {}
  ): Promise<Notification[]> {
    const {
      status,
      type,
      priority,
      limit = 50,
      offset = 0,
      orderBy = 'createdAt',
      orderDirection = 'desc',
      unreadOnly = false,
      includeExpired = false
    } = options;

    try {
      const where: any = { userId };

      if (status) where.status = status;
      if (type) where.type = type;
      if (priority) where.priority = priority;
      if (unreadOnly) where.readAt = null;
      
      if (!includeExpired) {
        where.OR = [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ];
      }

      const notifications = await this.prisma.notification.findMany({
        where,
        orderBy: { [orderBy]: orderDirection },
        take: limit,
        skip: offset
      });

      logger.debug('Retrieved user notifications', {
        userId,
        count: notifications.length,
        filters: { status, type, priority, unreadOnly }
      });

      return notifications;
    } catch (error) {
      logger.error('Failed to get user notifications', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Get organization notifications
   */
  async getOrganizationNotifications(
    organizationId: string,
    options: {
      limit?: number;
      offset?: number;
      status?: NotificationStatus;
      type?: NotificationType;
    } = {}
  ): Promise<Notification[]> {
    const { limit = 50, offset = 0, status, type } = options;

    try {
      const where: any = { organizationId };
      if (status) where.status = status;
      if (type) where.type = type;

      const notifications = await this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset
      });

      logger.debug('Retrieved organization notifications', {
        organizationId,
        count: notifications.length
      });

      return notifications;
    } catch (error) {
      logger.error('Failed to get organization notifications', {
        organizationId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string, userId: string): Promise<boolean> {
    try {
      const updated = await this.prisma.notification.updateMany({
        where: {
          id: notificationId,
          userId: userId,
          readAt: null
        },
        data: {
          status: 'READ',
          readAt: new Date()
        }
      });

      const success = updated.count > 0;

      if (success) {
        logger.info('Notification marked as read', { notificationId, userId });
      } else {
        logger.warn('Notification not found or already read', { notificationId, userId });
      }

      return success;
    } catch (error) {
      logger.error('Failed to mark notification as read', {
        notificationId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Mark multiple notifications as read
   */
  async markMultipleAsRead(notificationIds: string[], userId: string): Promise<number> {
    try {
      const updated = await this.prisma.notification.updateMany({
        where: {
          id: { in: notificationIds },
          userId: userId,
          readAt: null
        },
        data: {
          status: 'READ',
          readAt: new Date()
        }
      });

      logger.info('Multiple notifications marked as read', {
        userId,
        requestedCount: notificationIds.length,
        updatedCount: updated.count
      });

      return updated.count;
    } catch (error) {
      logger.error('Failed to mark multiple notifications as read', {
        userId,
        count: notificationIds.length,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Mark all user notifications as read
   */
  async markAllAsRead(userId: string): Promise<number> {
    try {
      const updated = await this.prisma.notification.updateMany({
        where: {
          userId: userId,
          readAt: null
        },
        data: {
          status: 'READ',
          readAt: new Date()
        }
      });

      logger.info('All notifications marked as read', {
        userId,
        updatedCount: updated.count
      });

      return updated.count;
    } catch (error) {
      logger.error('Failed to mark all notifications as read', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Mark notifications as delivered
   */
  async markAsDelivered(notificationIds: string[]): Promise<number> {
    try {
      const updated = await this.prisma.notification.updateMany({
        where: {
          id: { in: notificationIds },
          status: 'PENDING'
        },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date()
        }
      });

      logger.info('Notifications marked as delivered', {
        requestedCount: notificationIds.length,
        updatedCount: updated.count
      });

      return updated.count;
    } catch (error) {
      logger.error('Failed to mark notifications as delivered', {
        count: notificationIds.length,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Update notification status
   */
  async updateStatus(notificationId: string, status: NotificationStatus): Promise<boolean> {
    try {
      const updateData: any = { status };
      
      if (status === 'DELIVERED') {
        updateData.deliveredAt = new Date();
      } else if (status === 'READ') {
        updateData.readAt = new Date();
      }

      const updated = await this.prisma.notification.update({
        where: { id: notificationId },
        data: updateData
      });

      logger.info('Notification status updated', {
        id: notificationId,
        status,
        previousStatus: updated.status
      });

      return true;
    } catch (error) {
      logger.error('Failed to update notification status', {
        notificationId,
        status,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Delete notification
   */
  async deleteNotification(notificationId: string, userId?: string): Promise<boolean> {
    try {
      const where: any = { id: notificationId };
      if (userId) where.userId = userId;

      await this.prisma.notification.delete({ where });

      logger.info('Notification deleted', { id: notificationId, userId });
      return true;
    } catch (error) {
      logger.error('Failed to delete notification', {
        notificationId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Delete old notifications (cleanup)
   */
  async deleteOldNotifications(olderThanDays: number = 90): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const deleted = await this.prisma.notification.deleteMany({
        where: {
          createdAt: { lt: cutoffDate },
          status: { in: ['READ', 'FAILED'] }
        }
      });

      logger.info('Old notifications cleaned up', {
        cutoffDate: cutoffDate.toISOString(),
        deletedCount: deleted.count,
        olderThanDays
      });

      return deleted.count;
    } catch (error) {
      logger.error('Failed to delete old notifications', {
        olderThanDays,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Get notification statistics for a user
   */
  async getUserStats(userId: string): Promise<NotificationStats> {
    try {
      const [
        total,
        unread,
        statusStats,
        typeStats,
        priorityStats,
        recent24h,
        recent7days,
        recent30days
      ] = await Promise.all([
        // Total notifications
        this.prisma.notification.count({ where: { userId } }),
        
        // Unread notifications
        this.prisma.notification.count({ 
          where: { userId, readAt: null } 
        }),
        
        // Status breakdown
        this.prisma.notification.groupBy({
          by: ['status'],
          where: { userId },
          _count: { status: true }
        }),
        
        // Type breakdown
        this.prisma.notification.groupBy({
          by: ['type'],
          where: { userId },
          _count: { type: true }
        }),
        
        // Priority breakdown
        this.prisma.notification.groupBy({
          by: ['priority'],
          where: { userId },
          _count: { priority: true }
        }),
        
        // Recent activity - last 24 hours
        this.prisma.notification.count({
          where: {
            userId,
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          }
        }),
        
        // Recent activity - last 7 days
        this.prisma.notification.count({
          where: {
            userId,
            createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
          }
        }),
        
        // Recent activity - last 30 days
        this.prisma.notification.count({
          where: {
            userId,
            createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
          }
        })
      ]);

      // Process grouped results
      const byStatus: Record<NotificationStatus, number> = {
        PENDING: 0,
        DELIVERED: 0,
        READ: 0,
        FAILED: 0
      };
      statusStats.forEach(stat => {
        byStatus[stat.status] = stat._count.status;
      });

      const byType: Record<NotificationType, number> = {
        AI_AGENT_UPDATE: 0,
        SYSTEM_ALERT: 0,
        BILLING_NOTICE: 0,
        SECURITY_EVENT: 0,
        TASK_COMPLETION: 0,
        PLUGIN_UPDATE: 0
      };
      typeStats.forEach(stat => {
        byType[stat.type] = stat._count.type;
      });

      const byPriority: Record<string, number> = {
        LOW: 0,
        MEDIUM: 0,
        HIGH: 0,
        URGENT: 0
      };
      priorityStats.forEach(stat => {
        byPriority[stat.priority] = stat._count.priority;
      });

      const stats: NotificationStats = {
        total,
        unread,
        byStatus,
        byType,
        byPriority,
        recentActivity: {
          last24h: recent24h,
          last7days: recent7days,
          last30days: recent30days
        }
      };

      logger.debug('Generated user notification stats', { userId, stats });

      return stats;
    } catch (error) {
      logger.error('Failed to get user notification stats', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Return empty stats on error
      return {
        total: 0,
        unread: 0,
        byStatus: { PENDING: 0, DELIVERED: 0, READ: 0, FAILED: 0 },
        byType: { 
          AI_AGENT_UPDATE: 0, SYSTEM_ALERT: 0, BILLING_NOTICE: 0, 
          SECURITY_EVENT: 0, TASK_COMPLETION: 0, PLUGIN_UPDATE: 0 
        },
        byPriority: { LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 },
        recentActivity: { last24h: 0, last7days: 0, last30days: 0 }
      };
    }
  }

  /**
   * Search notifications
   */
  async searchNotifications(
    userId: string,
    query: string,
    options: {
      limit?: number;
      offset?: number;
      type?: NotificationType;
      status?: NotificationStatus;
    } = {}
  ): Promise<Notification[]> {
    const { limit = 50, offset = 0, type, status } = options;

    try {
      const where: any = {
        userId,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { message: { contains: query, mode: 'insensitive' } }
        ]
      };

      if (type) where.type = type;
      if (status) where.status = status;

      const notifications = await this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset
      });

      logger.debug('Searched notifications', {
        userId,
        query,
        resultCount: notifications.length
      });

      return notifications;
    } catch (error) {
      logger.error('Failed to search notifications', {
        userId,
        query,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(userId: string): Promise<number> {
    try {
      const count = await this.prisma.notification.count({
        where: {
          userId,
          readAt: null,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } }
          ]
        }
      });

      logger.debug('Retrieved unread count', { userId, count });

      return count;
    } catch (error) {
      logger.error('Failed to get unread count', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Archive old read notifications
   */
  async archiveOldNotifications(olderThanDays: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      // This would typically move to an archive table, but for now we'll just mark them
      const archived = await this.prisma.notification.updateMany({
        where: {
          status: 'READ',
          readAt: { lt: cutoffDate }
        },
        data: {
          // Add archived flag if you have one in schema
          updatedAt: new Date()
        }
      });

      logger.info('Notifications archived', {
        cutoffDate: cutoffDate.toISOString(),
        archivedCount: archived.count
      });

      return archived.count;
    } catch (error) {
      logger.error('Failed to archive notifications', {
        olderThanDays,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }
}
