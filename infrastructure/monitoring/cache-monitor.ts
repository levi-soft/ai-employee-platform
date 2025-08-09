
import { RedisCache } from '../../packages/shared-utils/src/cache/redis-cache';
import { CacheInvalidation } from '../../packages/shared-utils/src/cache/cache-invalidation';
import { CacheWarming } from '../../packages/shared-utils/src/cache/cache-warming';
import Redis from 'ioredis';

export interface CacheMonitorConfig {
  caches: Map<string, RedisCache>;
  invalidation?: CacheInvalidation;
  warming?: CacheWarming;
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
  monitoring: {
    enabled: boolean;
    interval: number; // seconds
    alertThresholds: {
      hitRatio: number; // minimum acceptable hit ratio (%)
      responseTime: number; // maximum acceptable response time (ms)
      memoryUsage: number; // maximum memory usage (bytes)
      errorRate: number; // maximum error rate (%)
    };
    retentionPeriod: number; // days
  };
  notifications: {
    enabled: boolean;
    webhookUrl?: string;
    emailRecipients?: string[];
    slackChannel?: string;
  };
}

export interface CacheHealth {
  cacheName: string;
  status: 'healthy' | 'warning' | 'critical';
  metrics: {
    hitRatio: number;
    missRatio: number;
    averageResponseTime: number;
    memoryUsage: number;
    keyCount: number;
    connections: number;
    uptime: number;
    errorRate: number;
    throughput: number;
  };
  alerts: CacheAlert[];
  lastCheck: Date;
}

export interface CacheAlert {
  type: 'hit_ratio_low' | 'response_time_high' | 'memory_usage_high' | 'error_rate_high' | 'cache_down';
  severity: 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
  timestamp: Date;
  resolved?: boolean;
  resolvedAt?: Date;
}

export interface SystemCacheMetrics {
  totalCaches: number;
  healthyCaches: number;
  warningCaches: number;
  criticalCaches: number;
  overallHitRatio: number;
  totalMemoryUsage: number;
  totalKeyCount: number;
  totalThroughput: number;
  systemUptime: number;
  alerts: CacheAlert[];
  lastUpdate: Date;
}

export class CacheMonitor {
  private config: CacheMonitorConfig;
  private caches: Map<string, RedisCache>;
  private invalidation?: CacheInvalidation;
  private warming?: CacheWarming;
  private redis: Redis;
  private healthData: Map<string, CacheHealth> = new Map();
  private systemMetrics: SystemCacheMetrics;
  private monitoringInterval?: NodeJS.Timeout;
  private alertHistory: Map<string, CacheAlert[]> = new Map();
  private startTime: Date;

  constructor(config: CacheMonitorConfig) {
    this.config = config;
    this.caches = config.caches;
    this.invalidation = config.invalidation;
    this.warming = config.warming;
    this.startTime = new Date();

    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db || 0,
      keyPrefix: 'cache-monitor:',
    });

    this.initializeSystemMetrics();
    
    if (config.monitoring.enabled) {
      this.startMonitoring();
    }
  }

  private initializeSystemMetrics(): void {
    this.systemMetrics = {
      totalCaches: this.caches.size,
      healthyCaches: 0,
      warningCaches: 0,
      criticalCaches: 0,
      overallHitRatio: 0,
      totalMemoryUsage: 0,
      totalKeyCount: 0,
      totalThroughput: 0,
      systemUptime: 0,
      alerts: [],
      lastUpdate: new Date(),
    };
  }

  private startMonitoring(): void {
    console.log(`[CacheMonitor] Starting cache monitoring with ${this.config.monitoring.interval}s interval`);
    
    this.monitoringInterval = setInterval(async () => {
      await this.performHealthCheck();
      await this.updateSystemMetrics();
      await this.cleanupOldData();
    }, this.config.monitoring.interval * 1000);

    // Perform initial health check
    setTimeout(() => this.performHealthCheck(), 1000);
  }

  private async performHealthCheck(): Promise<void> {
    const currentTime = new Date();
    
    for (const [cacheName, cache] of this.caches.entries()) {
      try {
        const health = await this.checkCacheHealth(cacheName, cache);
        this.healthData.set(cacheName, health);
        
        // Store health data in Redis for persistence
        await this.redis.setex(
          `health:${cacheName}`,
          3600,
          JSON.stringify(health)
        );
        
        // Process alerts
        await this.processAlerts(cacheName, health.alerts);
        
      } catch (error) {
        console.error(`[CacheMonitor] Error checking health for ${cacheName}:`, error);
        
        // Create critical alert for monitoring failure
        const criticalAlert: CacheAlert = {
          type: 'cache_down',
          severity: 'critical',
          message: `Cache monitoring failed for ${cacheName}`,
          value: 0,
          threshold: 1,
          timestamp: currentTime,
        };
        
        await this.processAlerts(cacheName, [criticalAlert]);
      }
    }
  }

  private async checkCacheHealth(cacheName: string, cache: RedisCache): Promise<CacheHealth> {
    const startTime = Date.now();
    const metrics = cache.getMetrics();
    const alerts: CacheAlert[] = [];
    const checkTime = new Date();

    // Check hit ratio
    if (metrics.hitRate < this.config.monitoring.alertThresholds.hitRatio) {
      alerts.push({
        type: 'hit_ratio_low',
        severity: metrics.hitRate < this.config.monitoring.alertThresholds.hitRatio * 0.5 ? 'critical' : 'warning',
        message: `Cache hit ratio is ${metrics.hitRate.toFixed(2)}%, below threshold of ${this.config.monitoring.alertThresholds.hitRatio}%`,
        value: metrics.hitRate,
        threshold: this.config.monitoring.alertThresholds.hitRatio,
        timestamp: checkTime,
      });
    }

    // Check response time
    if (metrics.averageResponseTime > this.config.monitoring.alertThresholds.responseTime) {
      alerts.push({
        type: 'response_time_high',
        severity: metrics.averageResponseTime > this.config.monitoring.alertThresholds.responseTime * 2 ? 'critical' : 'warning',
        message: `Average response time is ${metrics.averageResponseTime.toFixed(2)}ms, above threshold of ${this.config.monitoring.alertThresholds.responseTime}ms`,
        value: metrics.averageResponseTime,
        threshold: this.config.monitoring.alertThresholds.responseTime,
        timestamp: checkTime,
      });
    }

    // Check memory usage
    if (metrics.memoryUsage > this.config.monitoring.alertThresholds.memoryUsage) {
      alerts.push({
        type: 'memory_usage_high',
        severity: metrics.memoryUsage > this.config.monitoring.alertThresholds.memoryUsage * 1.2 ? 'critical' : 'warning',
        message: `Memory usage is ${(metrics.memoryUsage / 1024 / 1024).toFixed(2)}MB, above threshold of ${(this.config.monitoring.alertThresholds.memoryUsage / 1024 / 1024).toFixed(2)}MB`,
        value: metrics.memoryUsage,
        threshold: this.config.monitoring.alertThresholds.memoryUsage,
        timestamp: checkTime,
      });
    }

    // Calculate error rate
    const errorRate = metrics.totalOperations > 0 
      ? ((metrics.totalOperations - metrics.hits) / metrics.totalOperations) * 100 
      : 0;
    
    if (errorRate > this.config.monitoring.alertThresholds.errorRate) {
      alerts.push({
        type: 'error_rate_high',
        severity: errorRate > this.config.monitoring.alertThresholds.errorRate * 2 ? 'critical' : 'warning',
        message: `Error rate is ${errorRate.toFixed(2)}%, above threshold of ${this.config.monitoring.alertThresholds.errorRate}%`,
        value: errorRate,
        threshold: this.config.monitoring.alertThresholds.errorRate,
        timestamp: checkTime,
      });
    }

    // Determine overall health status
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (alerts.some(alert => alert.severity === 'critical')) {
      status = 'critical';
    } else if (alerts.some(alert => alert.severity === 'warning')) {
      status = 'warning';
    }

    const throughput = metrics.totalOperations / (metrics.uptime / 1000 || 1);

    return {
      cacheName,
      status,
      metrics: {
        hitRatio: metrics.hitRate,
        missRatio: 100 - metrics.hitRate,
        averageResponseTime: metrics.averageResponseTime,
        memoryUsage: metrics.memoryUsage,
        keyCount: metrics.keyCount,
        connections: metrics.connections,
        uptime: metrics.uptime,
        errorRate,
        throughput,
      },
      alerts,
      lastCheck: checkTime,
    };
  }

  private async processAlerts(cacheName: string, alerts: CacheAlert[]): Promise<void> {
    if (alerts.length === 0) return;

    // Store alerts in history
    if (!this.alertHistory.has(cacheName)) {
      this.alertHistory.set(cacheName, []);
    }
    
    const history = this.alertHistory.get(cacheName)!;
    history.push(...alerts);
    
    // Keep only recent alerts
    const cutoff = new Date(Date.now() - this.config.monitoring.retentionPeriod * 24 * 60 * 60 * 1000);
    this.alertHistory.set(cacheName, history.filter(alert => alert.timestamp > cutoff));

    // Store alerts in Redis
    await this.redis.lpush(`alerts:${cacheName}`, ...alerts.map(alert => JSON.stringify(alert)));
    await this.redis.expire(`alerts:${cacheName}`, this.config.monitoring.retentionPeriod * 24 * 60 * 60);

    // Send notifications for new alerts
    if (this.config.notifications.enabled) {
      await this.sendAlertNotifications(cacheName, alerts);
    }

    console.log(`[CacheMonitor] ${alerts.length} alerts generated for ${cacheName}`);
  }

  private async sendAlertNotifications(cacheName: string, alerts: CacheAlert[]): Promise<void> {
    const criticalAlerts = alerts.filter(alert => alert.severity === 'critical');
    const warningAlerts = alerts.filter(alert => alert.severity === 'warning');

    if (criticalAlerts.length > 0) {
      await this.sendNotification('critical', cacheName, criticalAlerts);
    }
    
    if (warningAlerts.length > 0) {
      await this.sendNotification('warning', cacheName, warningAlerts);
    }
  }

  private async sendNotification(severity: string, cacheName: string, alerts: CacheAlert[]): Promise<void> {
    const message = this.formatAlertMessage(severity, cacheName, alerts);
    
    try {
      // Webhook notification
      if (this.config.notifications.webhookUrl) {
        const response = await fetch(this.config.notifications.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            severity,
            cacheName,
            message,
            alerts,
            timestamp: new Date().toISOString(),
          }),
        });
        
        if (!response.ok) {
          console.error('[CacheMonitor] Webhook notification failed:', response.status);
        }
      }

      // Additional notification channels would be implemented here
      // (email, Slack, etc.)
      
    } catch (error) {
      console.error('[CacheMonitor] Error sending notifications:', error);
    }
  }

  private formatAlertMessage(severity: string, cacheName: string, alerts: CacheAlert[]): string {
    const alertSummary = alerts.map(alert => 
      `• ${alert.type}: ${alert.message}`
    ).join('\n');
    
    return `🚨 Cache Alert - ${severity.toUpperCase()}\n\nCache: ${cacheName}\nTime: ${new Date().toISOString()}\n\nAlerts:\n${alertSummary}`;
  }

  private async updateSystemMetrics(): Promise<void> {
    const healthData = Array.from(this.healthData.values());
    
    this.systemMetrics = {
      totalCaches: this.caches.size,
      healthyCaches: healthData.filter(h => h.status === 'healthy').length,
      warningCaches: healthData.filter(h => h.status === 'warning').length,
      criticalCaches: healthData.filter(h => h.status === 'critical').length,
      overallHitRatio: healthData.reduce((sum, h) => sum + h.metrics.hitRatio, 0) / healthData.length || 0,
      totalMemoryUsage: healthData.reduce((sum, h) => sum + h.metrics.memoryUsage, 0),
      totalKeyCount: healthData.reduce((sum, h) => sum + h.metrics.keyCount, 0),
      totalThroughput: healthData.reduce((sum, h) => sum + h.metrics.throughput, 0),
      systemUptime: Date.now() - this.startTime.getTime(),
      alerts: healthData.flatMap(h => h.alerts),
      lastUpdate: new Date(),
    };

    // Store system metrics in Redis
    await this.redis.setex(
      'system-metrics',
      300, // 5 minutes
      JSON.stringify(this.systemMetrics)
    );
  }

  private async cleanupOldData(): Promise<void> {
    const cutoff = Date.now() - this.config.monitoring.retentionPeriod * 24 * 60 * 60 * 1000;
    
    try {
      // Clean up old health data
      const healthKeys = await this.redis.keys('health:*');
      for (const key of healthKeys) {
        const data = await this.redis.get(key);
        if (data) {
          const health: CacheHealth = JSON.parse(data);
          if (health.lastCheck.getTime() < cutoff) {
            await this.redis.del(key);
          }
        }
      }

      // Clean up old alert data
      const alertKeys = await this.redis.keys('alerts:*');
      for (const key of alertKeys) {
        await this.redis.ltrim(key, 0, 1000); // Keep last 1000 alerts
      }
      
    } catch (error) {
      console.error('[CacheMonitor] Error cleaning up old data:', error);
    }
  }

  // Public API methods
  public getCacheHealth(cacheName?: string): CacheHealth | Map<string, CacheHealth> {
    if (cacheName) {
      return this.healthData.get(cacheName) || null;
    }
    return new Map(this.healthData);
  }

  public getSystemMetrics(): SystemCacheMetrics {
    return { ...this.systemMetrics };
  }

  public async getAlertHistory(cacheName: string, limit: number = 100): Promise<CacheAlert[]> {
    try {
      const alerts = await this.redis.lrange(`alerts:${cacheName}`, 0, limit - 1);
      return alerts.map(alert => JSON.parse(alert));
    } catch (error) {
      console.error(`[CacheMonitor] Error getting alert history for ${cacheName}:`, error);
      return [];
    }
  }

  public async acknowledgeAlert(cacheName: string, alertTimestamp: string): Promise<boolean> {
    try {
      const alerts = this.alertHistory.get(cacheName) || [];
      const alert = alerts.find(a => a.timestamp.toISOString() === alertTimestamp);
      
      if (alert) {
        alert.resolved = true;
        alert.resolvedAt = new Date();
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('[CacheMonitor] Error acknowledging alert:', error);
      return false;
    }
  }

  public async generateReport(timeRange: 'hour' | 'day' | 'week' = 'day'): Promise<{
    summary: SystemCacheMetrics;
    cacheDetails: CacheHealth[];
    recommendations: string[];
    period: string;
  }> {
    const now = new Date();
    const start = new Date();
    
    switch (timeRange) {
      case 'hour':
        start.setHours(now.getHours() - 1);
        break;
      case 'day':
        start.setDate(now.getDate() - 1);
        break;
      case 'week':
        start.setDate(now.getDate() - 7);
        break;
    }

    const recommendations: string[] = [];
    const cacheDetails = Array.from(this.healthData.values());

    // Generate recommendations based on metrics
    cacheDetails.forEach(cache => {
      if (cache.metrics.hitRatio < 70) {
        recommendations.push(`Consider cache warming for ${cache.cacheName} (hit ratio: ${cache.metrics.hitRatio.toFixed(2)}%)`);
      }
      
      if (cache.metrics.averageResponseTime > 100) {
        recommendations.push(`Optimize ${cache.cacheName} performance (avg response: ${cache.metrics.averageResponseTime.toFixed(2)}ms)`);
      }
      
      if (cache.metrics.memoryUsage > this.config.monitoring.alertThresholds.memoryUsage * 0.8) {
        recommendations.push(`Monitor memory usage for ${cache.cacheName} (${(cache.metrics.memoryUsage / 1024 / 1024).toFixed(2)}MB)`);
      }
    });

    // System-wide recommendations
    if (this.systemMetrics.overallHitRatio < 80) {
      recommendations.push('Consider implementing cache warming strategies to improve overall hit ratio');
    }
    
    if (this.systemMetrics.criticalCaches > 0) {
      recommendations.push('Address critical cache issues immediately');
    }

    return {
      summary: this.systemMetrics,
      cacheDetails,
      recommendations,
      period: `${start.toISOString()} to ${now.toISOString()}`,
    };
  }

  public async performManualCheck(): Promise<void> {
    await this.performHealthCheck();
    await this.updateSystemMetrics();
  }

  public async shutdown(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    await this.redis.disconnect();
    console.log('[CacheMonitor] Shutdown completed');
  }
}

// Factory function
export function createCacheMonitor(config: CacheMonitorConfig): CacheMonitor {
  return new CacheMonitor(config);
}

// Default configuration
export const DEFAULT_CACHE_MONITOR_CONFIG: Partial<CacheMonitorConfig> = {
  monitoring: {
    enabled: true,
    interval: 60, // 1 minute
    alertThresholds: {
      hitRatio: 80, // 80%
      responseTime: 100, // 100ms
      memoryUsage: 500 * 1024 * 1024, // 500MB
      errorRate: 5, // 5%
    },
    retentionPeriod: 7, // 7 days
  },
  notifications: {
    enabled: false,
  },
};
