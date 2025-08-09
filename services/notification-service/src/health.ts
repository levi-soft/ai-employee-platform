
import { Request, Response } from 'express';
import { prisma } from './config/database';
import { HealthChecker } from '@ai-platform/shared-utils';
import { createServiceLogger } from '@ai-platform/shared-utils';

const logger = createServiceLogger('notification-health');

// Initialize health checker
const healthChecker = new HealthChecker('notification-service', logger);

// Register critical health checks
healthChecker.registerCheck('database', async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'healthy', message: 'Database connection successful' };
  } catch (error) {
    return { 
      status: 'unhealthy', 
      message: 'Database connection failed',
      error: error instanceof Error ? error.message : 'Unknown database error'
    };
  }
});

healthChecker.registerCheck('notification-queue', async () => {
  try {
    // Test notification queue health
    const pendingNotifications = await prisma.notification.count({
      where: { 
        status: 'PENDING'
      }
    });
    
    // Alert if too many pending notifications
    if (pendingNotifications > 1000) {
      return {
        status: 'degraded',
        message: 'High number of pending notifications',
        details: { pendingCount: pendingNotifications }
      };
    }
    
    return { 
      status: 'healthy', 
      message: 'Notification queue is healthy',
      details: { pendingNotifications }
    };
  } catch (error) {
    return { 
      status: 'unhealthy', 
      message: 'Notification queue check failed',
      error: error instanceof Error ? error.message : 'Unknown queue error'
    };
  }
});

healthChecker.registerCheck('websocket-gateway', async () => {
  try {
    // Check WebSocket gateway status
    const memoryUsage = process.memoryUsage();
    const maxMemory = 256 * 1024 * 1024; // 256MB limit
    
    if (memoryUsage.heapUsed > maxMemory) {
      return {
        status: 'degraded',
        message: 'High memory usage detected',
        details: { memoryUsage: memoryUsage.heapUsed, maxMemory }
      };
    }
    
    return { 
      status: 'healthy', 
      message: 'WebSocket gateway is healthy',
      details: { memoryUsage: memoryUsage.heapUsed }
    };
  } catch (error) {
    return { 
      status: 'unhealthy', 
      message: 'WebSocket gateway check failed',
      error: error instanceof Error ? error.message : 'Unknown gateway error'
    };
  }
});

healthChecker.registerCheck('email-service', async () => {
  try {
    // Simple check for email service configuration
    const emailConfig = {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    };
    
    if (!emailConfig.host || !emailConfig.auth.user) {
      return {
        status: 'unhealthy',
        message: 'Email service configuration missing'
      };
    }
    
    return { 
      status: 'healthy', 
      message: 'Email service configuration valid'
    };
  } catch (error) {
    return { 
      status: 'unhealthy', 
      message: 'Email service check failed',
      error: error instanceof Error ? error.message : 'Unknown email error'
    };
  }
});

// Export health check handler
export { healthChecker };
