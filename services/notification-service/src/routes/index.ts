
import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller';
import { authenticateToken, requireRole, optionalAuth } from '../middleware/auth.middleware';
import { notificationValidation, notificationRateLimit } from '../middleware/security.middleware';

const router = Router();

// Send notification (admin/system only)
router.post('/send', 
  authenticateToken,
  requireRole(['admin', 'system']),
  notificationValidation,
  NotificationController.sendNotification
);

// Get user notifications
router.get('/user',
  authenticateToken,
  NotificationController.getUserNotifications
);

// Mark notification as read
router.patch('/:notificationId/read',
  authenticateToken,
  NotificationController.markAsRead
);

// Mark all notifications as read
router.patch('/user/read-all',
  authenticateToken,
  NotificationController.markAllAsRead
);

// Delete notification
router.delete('/:notificationId',
  authenticateToken,
  NotificationController.deleteNotification
);

// Search notifications
router.get('/search',
  authenticateToken,
  NotificationController.searchNotifications
);

// Get unread count
router.get('/user/unread-count',
  authenticateToken,
  NotificationController.getUnreadCount
);

// Get notification statistics
router.get('/user/stats',
  authenticateToken,
  NotificationController.getStats
);

// Preference management
router.get('/preferences',
  authenticateToken,
  NotificationController.getPreferences
);

router.put('/preferences/:type',
  authenticateToken,
  notificationValidation,
  NotificationController.updatePreference
);

// Service testing (admin only)
router.get('/test/:service',
  authenticateToken,
  requireRole(['admin']),
  NotificationController.testServices
);

// Public health check
router.get('/health',
  (req, res) => {
    res.json({
      success: true,
      message: 'Notification service is healthy',
      timestamp: new Date().toISOString()
    });
  }
);

export default router;
