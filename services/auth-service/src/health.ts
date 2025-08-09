
import { HealthChecker, commonHealthChecks, createServiceLogger } from '@ai-platform/shared-utils';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';

const logger = createServiceLogger('auth-service-health');

// Initialize health checker
export const healthChecker = new HealthChecker('auth-service', process.env.npm_package_version || '1.0.0');

// Database connection check
const prisma = new PrismaClient();
healthChecker.registerCheck(
  'database',
  commonHealthChecks.database(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      logger.error('Database health check failed', error instanceof Error ? error : undefined);
      return false;
    }
  }, 'postgresql'),
  true // Critical check
);

// Redis connection check
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
healthChecker.registerCheck(
  'redis',
  commonHealthChecks.redis(async () => {
    try {
      const result = await redis.ping();
      return result === 'PONG';
    } catch (error) {
      logger.error('Redis health check failed', error instanceof Error ? error : undefined);
      return false;
    }
  }),
  true // Critical check
);

// Memory usage check
healthChecker.registerCheck(
  'memory',
  commonHealthChecks.memory(0.85), // Alert if memory usage > 85%
  false
);

// JWT service check
healthChecker.registerCheck(
  'jwt_service',
  async () => {
    try {
      const jwt = require('jsonwebtoken');
      const secret = process.env.JWT_SECRET;
      
      if (!secret) {
        return {
          name: 'jwt_service',
          status: 'unhealthy' as const,
          message: 'JWT secret not configured',
        };
      }

      // Test token creation and verification
      const testPayload = { test: true };
      const token = jwt.sign(testPayload, secret, { expiresIn: '1m' });
      const decoded = jwt.verify(token, secret);
      
      const isValid = decoded && typeof decoded === 'object' && (decoded as any).test === true;
      
      return {
        name: 'jwt_service',
        status: isValid ? 'healthy' : 'unhealthy' as const,
        message: isValid ? 'JWT service operational' : 'JWT service malfunction',
      };
    } catch (error) {
      return {
        name: 'jwt_service',
        status: 'unhealthy' as const,
        message: `JWT service error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
  true // Critical check
);

// Session store check
healthChecker.registerCheck(
  'session_store',
  async () => {
    try {
      // Test session operations
      const testKey = 'health_check_session';
      const testValue = { test: true, timestamp: Date.now() };
      
      await redis.setex(testKey, 60, JSON.stringify(testValue));
      const retrieved = await redis.get(testKey);
      await redis.del(testKey);
      
      const isValid = retrieved && JSON.parse(retrieved).test === true;
      
      return {
        name: 'session_store',
        status: isValid ? 'healthy' : 'unhealthy' as const,
        message: isValid ? 'Session store operational' : 'Session store malfunction',
      };
    } catch (error) {
      return {
        name: 'session_store',
        status: 'unhealthy' as const,
        message: `Session store error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
  true // Critical check
);

// External dependency checks (if any)
if (process.env.EXTERNAL_AUTH_SERVICE_URL) {
  healthChecker.registerCheck(
    'external_auth',
    commonHealthChecks.externalService('external_auth', async () => {
      try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(`${process.env.EXTERNAL_AUTH_SERVICE_URL}/health`, {
          method: 'GET',
          timeout: 5000,
        });
        return response.ok;
      } catch {
        return false;
      }
    }),
    false // Non-critical
  );
}

// Graceful shutdown handler
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal, shutting down gracefully');
  
  try {
    await prisma.$disconnect();
    await redis.disconnect();
    logger.info('Database and Redis connections closed');
  } catch (error) {
    logger.error('Error during graceful shutdown', error instanceof Error ? error : undefined);
  }
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT signal, shutting down gracefully');
  
  try {
    await prisma.$disconnect();
    await redis.disconnect();
    logger.info('Database and Redis connections closed');
  } catch (error) {
    logger.error('Error during graceful shutdown', error instanceof Error ? error : undefined);
  }
  
  process.exit(0);
});
