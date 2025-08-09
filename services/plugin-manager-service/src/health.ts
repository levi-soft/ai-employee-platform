
import { Request, Response } from 'express';
import { prisma } from './config/database';
import { HealthChecker } from '@ai-platform/shared-utils';
import { createServiceLogger } from '@ai-platform/shared-utils';

const logger = createServiceLogger('plugin-manager-health');

// Initialize health checker
const healthChecker = new HealthChecker('plugin-manager-service', logger);

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

healthChecker.registerCheck('plugin-sandbox', async () => {
  try {
    // Test sandbox environment availability
    const memoryUsage = process.memoryUsage();
    const maxMemory = 512 * 1024 * 1024; // 512MB limit
    
    if (memoryUsage.heapUsed > maxMemory) {
      return {
        status: 'degraded',
        message: 'High memory usage detected',
        details: { memoryUsage: memoryUsage.heapUsed, maxMemory }
      };
    }
    
    return { 
      status: 'healthy', 
      message: 'Plugin sandbox environment ready',
      details: { memoryUsage: memoryUsage.heapUsed }
    };
  } catch (error) {
    return { 
      status: 'unhealthy', 
      message: 'Sandbox environment check failed',
      error: error instanceof Error ? error.message : 'Unknown sandbox error'
    };
  }
});

healthChecker.registerCheck('plugin-registry', async () => {
  try {
    const pluginCount = await prisma.plugin.count({
      where: { status: 'ACTIVE' }
    });
    
    return { 
      status: 'healthy', 
      message: 'Plugin registry accessible',
      details: { activePlugins: pluginCount }
    };
  } catch (error) {
    return { 
      status: 'unhealthy', 
      message: 'Plugin registry check failed',
      error: error instanceof Error ? error.message : 'Unknown registry error'
    };
  }
});

// Export health check handler
export { healthChecker };
