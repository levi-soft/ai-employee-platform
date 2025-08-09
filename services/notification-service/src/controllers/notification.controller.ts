
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createServiceLogger } from '@ai-platform/shared-utils';
import { NotificationGateway } from '../websocket/notification-gateway';
import { EmailService } from '../services/email.service';
import { SMSService } from '../services/sms.service';
import { NotificationHistoryService } from '../services/notification-history.service';
import { NotificationPreferenceModel } from '../models/notification-preference.model';
import { z } from 'zod';

const logger = createServiceLogger('notification-controller');
const prisma = new PrismaClient();

// Initialize services
const emailService = new EmailService();
const smsService = new SMSService();
const historyService = new NotificationHistoryService(prisma);
const preferenceModel = new NotificationPreferenceModel(prisma);

// Store gateway instance (will be set by main app)
let notificationGateway: NotificationGateway;

// Request validation schemas
const SendNotificationSchema = z.object({
  type: z.enum(['AI_AGENT_UPDATE', 'SYSTEM_ALERT', 'BILLING_NOTICE', 'SECURITY_EVENT', 'TASK_COMPLETION', 'PLUGIN_UPDATE']),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
  userId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  channels: z.array(z.enum(['EMAIL', 'SMS', 'WEBSOCKET', 'PUSH'])).optional(),
  data: z.record(z.any()).optional(),
  expiresAt: z.string().datetime().optional()
});

const UpdatePreferenceSchema = z.object({
  type: z.enum(['AI_AGENT_UPDATE', 'SYSTEM_ALERT', 'BILLING_NOTICE', 'SECURITY_EVENT', 'TASK_COMPLETION', 'PLUGIN_UPDATE']),
  channels: z.array(z.enum(['EMAIL', 'SMS', 'WEBSOCKET', 'PUSH'])),
  enabled: z.boolean(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  frequency: z.enum(['IMMEDIATE', 'HOURLY', 'DAILY', 'WEEKLY']).default('IMMEDIATE'),
  quietHours: z.object({
    enabled: z.boolean(),
    startTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
    endTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
    timezone: z.string().default('UTC')
  }).optional()
});

export class NotificationController {
  /**
   * Set notification gateway instance
   */
  static setGateway(gateway: NotificationGateway): void {
    notificationGateway = gateway;
  }

  /**
   * Send notification
   */
  static async sendNotification(req: Request, res: Response): Promise<void> {
    try {
      const validData = SendNotificationSchema.parse(req.body);
      const senderId = req.user?.id || 'system';

      logger.info('Sending notification', {
        type: validData.type,
        userId: validData.userId,
        organizationId: validData.organizationId,
        priority: validData.priority,
        senderId
      });

      const notificationId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const notificationData = {
        id: notificationId,
        type: validData.type,
        title: validData.title,
        message: validData.message,
        userId: validData.userId,
        organizationId: validData.organizationId,
        priority: validData.priority,
        data: validData.data,
        expiresAt: validData.expiresAt ? new Date(validData.expiresAt) : undefined
      };

      const results: any = {
        notificationId,
        channels: {},
        success: false
      };

      // Determine channels to use
      let channels = validData.channels;
      if (!channels && validData.userId) {
        // Get user's preferred channels for this notification type
        const preference = await preferenceModel.findByUserAndType(validData.userId, validData.type);
        channels = preference?.channels || ['WEBSOCKET'];
      } else if (!channels) {
        channels = ['WEBSOCKET'];
      }

      // Send via WebSocket
      if (channels.includes('WEBSOCKET') && notificationGateway) {
        try {
          let wsResult = false;
          
          if (validData.userId) {
            wsResult = await notificationGateway.sendToUser(validData.userId, notificationData);
          } else if (validData.organizationId) {
            const count = await notificationGateway.sendToOrganization(validData.organizationId, notificationData);
            wsResult = count > 0;
          } else {
            const count = await notificationGateway.broadcast(notificationData);
            wsResult = count > 0;
          }
          
          results.channels.websocket = { success: wsResult };
          if (wsResult) results.success = true;
        } catch (error) {
          results.channels.websocket = { 
            success: false, 
            error: error instanceof Error ? error.message : 'WebSocket error'
          };
        }
      }

      // Send via Email
      if (channels.includes('EMAIL') && validData.userId) {
        try {
          // Get user email from database
          const user = await prisma.user.findUnique({
            where: { id: validData.userId },
            select: { email: true, name: true }
          });

          if (user) {
            const emailResult = await emailService.sendEmail({
              to: { email: user.email, name: user.name },
              subject: validData.title,
              html: `
                <h2>${validData.title}</h2>
                <p>${validData.message}</p>
                ${validData.data ? `<pre>${JSON.stringify(validData.data, null, 2)}</pre>` : ''}
                <p><small>Sent by AI Employee Platform</small></p>
              `
            });
            
            results.channels.email = emailResult;
            if (emailResult.success) results.success = true;
          } else {
            results.channels.email = { success: false, error: 'User not found' };
          }
        } catch (error) {
          results.channels.email = { 
            success: false, 
            error: error instanceof Error ? error.message : 'Email error'
          };
        }
      }

      // Send via SMS
      if (channels.includes('SMS') && validData.userId) {
        try {
          // Get user phone from database
          const user = await prisma.user.findUnique({
            where: { id: validData.userId },
            select: { phone: true, name: true }
          });

          if (user?.phone) {
            const smsResult = await smsService.sendSMS({
              to: user.phone,
              message: `${validData.title}: ${validData.message}`
            });
            
            results.channels.sms = smsResult;
            if (smsResult.success) results.success = true;
          } else {
            results.channels.sms = { success: false, error: 'User phone not found' };
          }
        } catch (error) {
          results.channels.sms = { 
            success: false, 
            error: error instanceof Error ? error.message : 'SMS error'
          };
        }
      }

      // Store notification in history
      try {
        await historyService.createNotification({
          ...notificationData,
          status: results.success ? 'DELIVERED' : 'FAILED',
          channels,
          deliveredAt: results.success ? new Date() : undefined
        });
      } catch (error) {
        logger.error('Failed to store notification in history', {
          notificationId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      res.json({
        success: results.success,
        message: results.success ? 'Notification sent successfully' : 'Notification sending failed',
        data: results
      });
    } catch (error) {
      logger.error('Failed to send notification', {
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
          message: 'Failed to send notification'
        });
      }
    }
  }

  /**
   * Get user notifications
   */
  static async getUserNotifications(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const {
        status,
        type,
        priority,
        limit = '50',
        offset = '0',
        unreadOnly = 'false'
      } = req.query;

      const notifications = await historyService.getUserNotifications(userId, {
        status: status as any,
        type: type as any,
        priority: priority as any,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        unreadOnly: unreadOnly === 'true'
      });

      res.json({
        success: true,
        data: notifications
      });
    } catch (error) {
      logger.error('Failed to get user notifications', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to retrieve notifications'
      });
    }
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(req: Request, res: Response): Promise<void> {
    try {
      const { notificationId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const success = await historyService.markAsRead(notificationId, userId);

      if (success) {
        res.json({
          success: true,
          message: 'Notification marked as read'
        });
      } else {
        res.status(404).json({
          success: false,
          message: 'Notification not found or already read'
        });
      }
    } catch (error) {
      logger.error('Failed to mark notification as read', {
        notificationId: req.params.notificationId,
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to mark notification as read'
      });
    }
  }

  /**
   * Mark all notifications as read
   */
  static async markAllAsRead(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const count = await historyService.markAllAsRead(userId);

      res.json({
        success: true,
        message: `${count} notifications marked as read`,
        data: { count }
      });
    } catch (error) {
      logger.error('Failed to mark all notifications as read', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to mark notifications as read'
      });
    }
  }

  /**
   * Get notification statistics
   */
  static async getStats(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const stats = await historyService.getUserStats(userId);

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error('Failed to get notification statistics', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to get notification statistics'
      });
    }
  }

  /**
   * Get user preferences
   */
  static async getPreferences(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const preferences = await preferenceModel.findByUserId(userId);

      res.json({
        success: true,
        data: preferences
      });
    } catch (error) {
      logger.error('Failed to get user preferences', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to get preferences'
      });
    }
  }

  /**
   * Update user preference
   */
  static async updatePreference(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { type } = req.params;
      const validData = UpdatePreferenceSchema.parse(req.body);

      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      // Find existing preference
      const existing = await preferenceModel.findByUserAndType(userId, type as any);

      let preference;
      if (existing) {
        preference = await preferenceModel.update(existing.id, validData);
      } else {
        preference = await preferenceModel.create({
          userId,
          ...validData,
          type: type as any
        });
      }

      res.json({
        success: true,
        message: 'Preference updated successfully',
        data: preference
      });
    } catch (error) {
      logger.error('Failed to update preference', {
        userId: req.user?.id,
        type: req.params.type,
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
          message: 'Failed to update preference'
        });
      }
    }
  }

  /**
   * Delete notification
   */
  static async deleteNotification(req: Request, res: Response): Promise<void> {
    try {
      const { notificationId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const success = await historyService.deleteNotification(notificationId, userId);

      if (success) {
        res.json({
          success: true,
          message: 'Notification deleted successfully'
        });
      } else {
        res.status(404).json({
          success: false,
          message: 'Notification not found'
        });
      }
    } catch (error) {
      logger.error('Failed to delete notification', {
        notificationId: req.params.notificationId,
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to delete notification'
      });
    }
  }

  /**
   * Search notifications
   */
  static async searchNotifications(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { q: query, type, status, limit = '50', offset = '0' } = req.query;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      if (!query) {
        res.status(400).json({
          success: false,
          message: 'Search query is required'
        });
        return;
      }

      const notifications = await historyService.searchNotifications(userId, query as string, {
        type: type as any,
        status: status as any,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      });

      res.json({
        success: true,
        data: notifications
      });
    } catch (error) {
      logger.error('Failed to search notifications', {
        userId: req.user?.id,
        query: req.query.q,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to search notifications'
      });
    }
  }

  /**
   * Get unread count
   */
  static async getUnreadCount(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const count = await historyService.getUnreadCount(userId);

      res.json({
        success: true,
        data: { count }
      });
    } catch (error) {
      logger.error('Failed to get unread count', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to get unread count'
      });
    }
  }

  /**
   * Test notification services
   */
  static async testServices(req: Request, res: Response): Promise<void> {
    try {
      const { service } = req.params;

      let result;
      switch (service) {
        case 'email':
          result = await emailService.testConnection();
          break;
        case 'sms':
          result = await smsService.testService();
          break;
        case 'websocket':
          result = {
            success: !!notificationGateway,
            message: notificationGateway ? 
              `WebSocket gateway active with ${notificationGateway.getConnectedUsersCount()} connected users` :
              'WebSocket gateway not initialized'
          };
          break;
        default:
          res.status(400).json({
            success: false,
            message: 'Invalid service. Use: email, sms, or websocket'
          });
          return;
      }

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Failed to test notification service', {
        service: req.params.service,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Service test failed'
      });
    }
  }
}
