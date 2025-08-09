
import { Request, Response } from 'express';
import { StructuredLogger, LogContext } from './logger';

export interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version?: string;
  uptime: number;
  checks: HealthCheck[];
  metadata?: Record<string, any>;
}

export interface HealthCheck {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  message?: string;
  duration?: number;
  critical?: boolean;
  lastCheck?: string;
  details?: Record<string, any>;
}

export class HealthChecker {
  private checks: Map<string, () => Promise<HealthCheck>> = new Map();
  private logger: StructuredLogger;
  private serviceName: string;
  private version: string;
  private startTime: number;

  constructor(serviceName: string, version: string = '1.0.0') {
    this.serviceName = serviceName;
    this.version = version;
    this.startTime = Date.now();
    this.logger = new StructuredLogger(`${serviceName}-health`);
  }

  // Register a health check
  registerCheck(name: string, checkFn: () => Promise<HealthCheck>, critical: boolean = false): void {
    this.checks.set(name, async () => {
      const start = Date.now();
      try {
        const result = await checkFn();
        const duration = Date.now() - start;
        return {
          ...result,
          duration,
          critical,
          lastCheck: new Date().toISOString(),
        };
      } catch (error) {
        const duration = Date.now() - start;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        
        this.logger.error(`Health check failed: ${name}`, error instanceof Error ? error : undefined, {
          healthCheck: name,
          duration,
        });

        return {
          name,
          status: 'unhealthy' as const,
          message: `Check failed: ${errorMsg}`,
          duration,
          critical,
          lastCheck: new Date().toISOString(),
        };
      }
    });
  }

  // Run all health checks
  async runChecks(): Promise<HealthCheckResult> {
    const timestamp = new Date().toISOString();
    const uptime = Date.now() - this.startTime;
    const checks: HealthCheck[] = [];

    // Run all registered checks
    for (const [name, checkFn] of this.checks) {
      const check = await checkFn();
      checks.push(check);
    }

    // Determine overall status
    const criticalFailed = checks.some(c => c.critical && c.status === 'unhealthy');
    const anyUnhealthy = checks.some(c => c.status === 'unhealthy');
    const anyDegraded = checks.some(c => c.status === 'degraded');

    let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
    if (criticalFailed) {
      overallStatus = 'unhealthy';
    } else if (anyUnhealthy) {
      overallStatus = 'degraded';
    } else if (anyDegraded) {
      overallStatus = 'degraded';
    }

    const result: HealthCheckResult = {
      service: this.serviceName,
      status: overallStatus,
      timestamp,
      version: this.version,
      uptime,
      checks,
      metadata: {
        hostname: process.env.HOSTNAME,
        nodeVersion: process.version,
        environment: process.env.NODE_ENV,
        pid: process.pid,
      },
    };

    // Log health check results
    const context: LogContext = {
      service: this.serviceName,
      healthStatus: overallStatus,
      checkCount: checks.length,
      uptime,
    };

    if (overallStatus === 'healthy') {
      this.logger.info('Health check passed', context);
    } else {
      this.logger.warn('Health check issues detected', context);
    }

    return result;
  }

  // Express middleware for health check endpoint
  getHealthCheckMiddleware() {
    return async (req: Request, res: Response) => {
      try {
        const result = await this.runChecks();
        const statusCode = result.status === 'healthy' ? 200 : 
                          result.status === 'degraded' ? 200 : 503;

        res.status(statusCode).json(result);
      } catch (error) {
        this.logger.error('Health check endpoint error', error instanceof Error ? error : undefined);
        res.status(500).json({
          service: this.serviceName,
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: 'Health check failed to execute',
        });
      }
    };
  }
}

// Common health check utilities
export const commonHealthChecks = {
  // Database connection check
  database: (checkFn: () => Promise<boolean>, dbName: string = 'database') => 
    async (): Promise<HealthCheck> => {
      const isConnected = await checkFn();
      return {
        name: dbName,
        status: isConnected ? 'healthy' : 'unhealthy',
        message: isConnected ? 'Database connected' : 'Database connection failed',
      };
    },

  // Redis connection check
  redis: (checkFn: () => Promise<boolean>) => 
    async (): Promise<HealthCheck> => {
      const isConnected = await checkFn();
      return {
        name: 'redis',
        status: isConnected ? 'healthy' : 'unhealthy',
        message: isConnected ? 'Redis connected' : 'Redis connection failed',
      };
    },

  // Memory usage check
  memory: (threshold: number = 0.9) => 
    async (): Promise<HealthCheck> => {
      const usage = process.memoryUsage();
      const totalMem = usage.heapTotal;
      const usedMem = usage.heapUsed;
      const usageRatio = usedMem / totalMem;

      return {
        name: 'memory',
        status: usageRatio < threshold ? 'healthy' : 'degraded',
        message: `Memory usage: ${Math.round(usageRatio * 100)}%`,
        details: {
          heapUsed: Math.round(usedMem / 1024 / 1024) + ' MB',
          heapTotal: Math.round(totalMem / 1024 / 1024) + ' MB',
          external: Math.round(usage.external / 1024 / 1024) + ' MB',
        },
      };
    },

  // Disk space check
  diskSpace: () => 
    async (): Promise<HealthCheck> => {
      // Basic check - in production, you'd use a proper disk space library
      return {
        name: 'disk',
        status: 'healthy',
        message: 'Disk space check not implemented',
      };
    },

  // External service check
  externalService: (name: string, checkFn: () => Promise<boolean>) => 
    async (): Promise<HealthCheck> => {
      const isAvailable = await checkFn();
      return {
        name: `external_${name}`,
        status: isAvailable ? 'healthy' : 'degraded',
        message: isAvailable ? `${name} service available` : `${name} service unavailable`,
      };
    },
};
