
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Redis } from 'ioredis';

export interface RateLimitEvent {
  timestamp: Date;
  identifier: string;
  endpoint: string;
  eventType: 'allowed' | 'blocked' | 'burst_used' | 'throttled';
  rule?: string;
  provider?: string;
  metadata?: Record<string, any>;
}

export interface RateLimitMetrics {
  totalRequests: number;
  allowedRequests: number;
  blockedRequests: number;
  blockRate: number;
  avgResponseTime: number;
  topBlockedEndpoints: Array<{ endpoint: string; count: number; rate: number }>;
  topBlockedUsers: Array<{ identifier: string; count: number; rate: number }>;
  providerThrottling: Record<string, {
    requests: number;
    throttled: number;
    avgWaitTime: number;
  }>;
  burstUsage: {
    totalBursts: number;
    avgBurstSize: number;
    burstEfficiency: number;
  };
}

export interface TimeSeriesData {
  timestamp: Date;
  requests: number;
  blocks: number;
  bursts: number;
  avgWaitTime: number;
}

export interface AlertRule {
  name: string;
  metric: string; // 'block_rate' | 'burst_frequency' | 'response_time' | 'error_rate'
  operator: 'greater_than' | 'less_than' | 'equals';
  threshold: number;
  windowMinutes: number;
  enabled: boolean;
  actions: Array<{
    type: 'email' | 'webhook' | 'log' | 'auto_adjust';
    config: Record<string, any>;
  }>;
}

@Injectable()
export class RateLimitAnalyticsService {
  private readonly logger = new Logger(RateLimitAnalyticsService.name);
  private readonly redisClient: Redis;
  private readonly eventBuffer: Map<string, RateLimitEvent[]> = new Map();
  private readonly alertRules: Map<string, AlertRule> = new Map();
  private readonly bufferFlushInterval: number;
  private readonly maxBufferSize: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.redisClient = new Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
      password: this.configService.get('REDIS_PASSWORD'),
      keyPrefix: 'rate_analytics:',
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
    });

    this.bufferFlushInterval = this.configService.get('ANALYTICS_FLUSH_INTERVAL', 30000); // 30s
    this.maxBufferSize = this.configService.get('ANALYTICS_BUFFER_SIZE', 1000);

    this.initializeDefaultAlerts();
    this.setupBufferFlushing();
    this.startMetricsAggregation();
  }

  @OnEvent('rate_limit.exceeded')
  async handleRateLimitExceeded(event: any): Promise<void> {
    await this.recordEvent({
      timestamp: new Date(),
      identifier: event.identifier,
      endpoint: event.endpoint,
      eventType: 'blocked',
      rule: event.rule,
      metadata: {
        currentCount: event.currentCount,
        limit: event.limit,
        resetTime: event.resetTime,
      },
    });
  }

  @OnEvent('provider.heavy_throttling')
  async handleProviderThrottling(event: any): Promise<void> {
    await this.recordEvent({
      timestamp: new Date(),
      identifier: event.providerId,
      endpoint: 'provider_throttle',
      eventType: 'throttled',
      provider: event.providerId,
      metadata: {
        usage: event.usage,
      },
    });
  }

  @OnEvent('burst.mode_entered')
  async handleBurstModeEntered(event: any): Promise<void> {
    await this.recordEvent({
      timestamp: new Date(),
      identifier: event.identifier,
      endpoint: 'burst_mode',
      eventType: 'burst_used',
      metadata: {
        totalBursts: event.totalBursts,
      },
    });
  }

  @OnEvent('system.load_critical')
  async handleSystemLoadCritical(event: any): Promise<void> {
    await this.recordEvent({
      timestamp: new Date(),
      identifier: 'system',
      endpoint: 'system_load',
      eventType: 'blocked',
      metadata: {
        load: event.load,
        severity: 'critical',
      },
    });

    // Trigger alert
    await this.triggerAlert('system_load_critical', {
      load: event.load,
      timestamp: new Date(),
    });
  }

  async recordEvent(event: RateLimitEvent): Promise<void> {
    try {
      const key = `${event.identifier}_${event.eventType}`;
      
      if (!this.eventBuffer.has(key)) {
        this.eventBuffer.set(key, []);
      }

      const buffer = this.eventBuffer.get(key)!;
      buffer.push(event);

      // Flush if buffer is full
      if (buffer.length >= this.maxBufferSize) {
        await this.flushBuffer(key);
      }

      this.logger.debug(`Recorded rate limit event: ${event.eventType} for ${event.identifier}`);
    } catch (error) {
      this.logger.error('Failed to record rate limit event', error);
    }
  }

  async getMetrics(
    startTime?: Date,
    endTime?: Date,
    identifier?: string,
    endpoint?: string
  ): Promise<RateLimitMetrics> {
    try {
      const metrics = await this.calculateMetrics(startTime, endTime, identifier, endpoint);
      
      this.logger.debug(`Generated rate limit metrics for period ${startTime} - ${endTime}`);
      return metrics;
    } catch (error) {
      this.logger.error('Failed to get rate limit metrics', error);
      return this.getDefaultMetrics();
    }
  }

  async getTimeSeriesData(
    startTime: Date,
    endTime: Date,
    granularity: 'minute' | 'hour' | 'day' = 'hour'
  ): Promise<TimeSeriesData[]> {
    try {
      const timeSeriesData: TimeSeriesData[] = [];
      const intervalMs = this.getIntervalMs(granularity);
      
      for (let timestamp = startTime.getTime(); timestamp <= endTime.getTime(); timestamp += intervalMs) {
        const windowStart = new Date(timestamp);
        const windowEnd = new Date(Math.min(timestamp + intervalMs, endTime.getTime()));
        
        const windowMetrics = await this.getWindowMetrics(windowStart, windowEnd);
        timeSeriesData.push({
          timestamp: windowStart,
          requests: windowMetrics.totalRequests,
          blocks: windowMetrics.blockedRequests,
          bursts: windowMetrics.burstUsage.totalBursts,
          avgWaitTime: windowMetrics.avgResponseTime,
        });
      }

      return timeSeriesData;
    } catch (error) {
      this.logger.error('Failed to get time series data', error);
      return [];
    }
  }

  async getTopAffectedResources(
    startTime?: Date,
    endTime?: Date,
    limit: number = 10
  ): Promise<{
    endpoints: Array<{ endpoint: string; blocks: number; requests: number; blockRate: number }>;
    users: Array<{ identifier: string; blocks: number; requests: number; blockRate: number }>;
    providers: Array<{ provider: string; throttles: number; requests: number; throttleRate: number }>;
  }> {
    try {
      // This would aggregate data from the stored events
      // For now, returning placeholder data
      return {
        endpoints: [],
        users: [],
        providers: [],
      };
    } catch (error) {
      this.logger.error('Failed to get top affected resources', error);
      return {
        endpoints: [],
        users: [],
        providers: [],
      };
    }
  }

  async createAlert(alertRule: AlertRule): Promise<boolean> {
    try {
      this.alertRules.set(alertRule.name, alertRule);
      await this.redisClient.setex(
        `alert:${alertRule.name}`,
        30 * 24 * 60 * 60, // 30 days
        JSON.stringify(alertRule)
      );

      this.logger.log(`Created alert rule: ${alertRule.name}`);
      this.eventEmitter.emit('analytics.alert_created', { alertRule });
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to create alert rule ${alertRule.name}`, error);
      return false;
    }
  }

  async getAlertHistory(
    alertName?: string,
    limit: number = 100
  ): Promise<Array<{
    alertName: string;
    timestamp: Date;
    metric: string;
    value: number;
    threshold: number;
    actions: string[];
  }>> {
    try {
      const historyKey = alertName ? `alert_history:${alertName}` : 'alert_history:*';
      const keys = await this.redisClient.keys(historyKey);
      const history: Array<any> = [];

      for (const key of keys.slice(-limit)) {
        const data = await this.redisClient.get(key);
        if (data) {
          const alert = JSON.parse(data);
          alert.timestamp = new Date(alert.timestamp);
          history.push(alert);
        }
      }

      return history.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    } catch (error) {
      this.logger.error('Failed to get alert history', error);
      return [];
    }
  }

  async generateReport(
    startTime: Date,
    endTime: Date,
    format: 'summary' | 'detailed' = 'summary'
  ): Promise<{
    period: { start: Date; end: Date };
    summary: {
      totalRequests: number;
      blockRate: number;
      avgResponseTime: number;
      topIssues: string[];
    };
    recommendations: string[];
    charts?: {
      timeSeriesData: TimeSeriesData[];
      topEndpoints: Array<{ endpoint: string; blocks: number }>;
    };
  }> {
    try {
      const metrics = await this.getMetrics(startTime, endTime);
      const topIssues = this.identifyTopIssues(metrics);
      const recommendations = this.generateRecommendations(metrics);

      const report: any = {
        period: { start: startTime, end: endTime },
        summary: {
          totalRequests: metrics.totalRequests,
          blockRate: metrics.blockRate,
          avgResponseTime: metrics.avgResponseTime,
          topIssues,
        },
        recommendations,
      };

      if (format === 'detailed') {
        const timeSeriesData = await this.getTimeSeriesData(startTime, endTime);
        report.charts = {
          timeSeriesData,
          topEndpoints: metrics.topBlockedEndpoints,
        };
      }

      return report;
    } catch (error) {
      this.logger.error('Failed to generate report', error);
      return {
        period: { start: startTime, end: endTime },
        summary: {
          totalRequests: 0,
          blockRate: 0,
          avgResponseTime: 0,
          topIssues: [],
        },
        recommendations: [],
      };
    }
  }

  private async calculateMetrics(
    startTime?: Date,
    endTime?: Date,
    identifier?: string,
    endpoint?: string
  ): Promise<RateLimitMetrics> {
    // This would perform complex analytics calculations
    // For now, returning placeholder data with realistic structure
    return {
      totalRequests: 0,
      allowedRequests: 0,
      blockedRequests: 0,
      blockRate: 0,
      avgResponseTime: 0,
      topBlockedEndpoints: [],
      topBlockedUsers: [],
      providerThrottling: {},
      burstUsage: {
        totalBursts: 0,
        avgBurstSize: 0,
        burstEfficiency: 1.0,
      },
    };
  }

  private async getWindowMetrics(startTime: Date, endTime: Date): Promise<RateLimitMetrics> {
    // Calculate metrics for a specific time window
    return this.calculateMetrics(startTime, endTime);
  }

  private getIntervalMs(granularity: 'minute' | 'hour' | 'day'): number {
    switch (granularity) {
      case 'minute': return 60 * 1000;
      case 'hour': return 60 * 60 * 1000;
      case 'day': return 24 * 60 * 60 * 1000;
      default: return 60 * 60 * 1000;
    }
  }

  private identifyTopIssues(metrics: RateLimitMetrics): string[] {
    const issues: string[] = [];

    if (metrics.blockRate > 0.1) { // 10% block rate
      issues.push(`High block rate: ${(metrics.blockRate * 100).toFixed(1)}%`);
    }

    if (metrics.avgResponseTime > 5000) { // 5 seconds
      issues.push(`High response time: ${metrics.avgResponseTime.toFixed(0)}ms`);
    }

    if (metrics.topBlockedEndpoints.length > 0) {
      const topEndpoint = metrics.topBlockedEndpoints[0];
      issues.push(`Most blocked endpoint: ${topEndpoint.endpoint} (${topEndpoint.count} blocks)`);
    }

    if (metrics.burstUsage.burstEfficiency < 0.7) {
      issues.push(`Low burst efficiency: ${(metrics.burstUsage.burstEfficiency * 100).toFixed(1)}%`);
    }

    return issues;
  }

  private generateRecommendations(metrics: RateLimitMetrics): string[] {
    const recommendations: string[] = [];

    if (metrics.blockRate > 0.05) { // 5% block rate
      recommendations.push('Consider increasing rate limits or implementing burst handling');
    }

    if (metrics.avgResponseTime > 3000) {
      recommendations.push('Optimize response times to reduce user frustration');
    }

    if (metrics.burstUsage.totalBursts > 0 && metrics.burstUsage.burstEfficiency < 0.8) {
      recommendations.push('Review burst patterns and optimize configurations');
    }

    if (Object.keys(metrics.providerThrottling).length > 0) {
      recommendations.push('Monitor provider throttling and consider load balancing');
    }

    return recommendations;
  }

  private async triggerAlert(alertName: string, data: Record<string, any>): Promise<void> {
    try {
      const alertRule = this.alertRules.get(alertName);
      if (!alertRule || !alertRule.enabled) {
        return;
      }

      // Record alert history
      const historyKey = `alert_history:${alertName}:${Date.now()}`;
      await this.redisClient.setex(
        historyKey,
        7 * 24 * 60 * 60, // 7 days
        JSON.stringify({
          alertName,
          timestamp: new Date(),
          metric: alertRule.metric,
          value: data[alertRule.metric] || 0,
          threshold: alertRule.threshold,
          actions: alertRule.actions.map(a => a.type),
          data,
        })
      );

      // Execute alert actions
      for (const action of alertRule.actions) {
        await this.executeAlertAction(alertName, action, data);
      }

      this.eventEmitter.emit('analytics.alert_triggered', {
        alertName,
        data,
        actions: alertRule.actions,
      });

      this.logger.warn(`Alert triggered: ${alertName}`, data);
    } catch (error) {
      this.logger.error(`Failed to trigger alert ${alertName}`, error);
    }
  }

  private async executeAlertAction(
    alertName: string,
    action: { type: string; config: Record<string, any> },
    data: Record<string, any>
  ): Promise<void> {
    try {
      switch (action.type) {
        case 'log':
          this.logger.warn(`Alert: ${alertName}`, data);
          break;
        
        case 'webhook':
          // Would send HTTP request to webhook URL
          this.logger.log(`Webhook action for alert ${alertName}`);
          break;
        
        case 'email':
          // Would send email notification
          this.logger.log(`Email action for alert ${alertName}`);
          break;
        
        case 'auto_adjust':
          // Would automatically adjust rate limits
          this.logger.log(`Auto-adjust action for alert ${alertName}`);
          break;
        
        default:
          this.logger.warn(`Unknown alert action type: ${action.type}`);
      }
    } catch (error) {
      this.logger.error(`Failed to execute alert action ${action.type}`, error);
    }
  }

  private initializeDefaultAlerts(): void {
    // High block rate alert
    this.alertRules.set('high_block_rate', {
      name: 'high_block_rate',
      metric: 'block_rate',
      operator: 'greater_than',
      threshold: 0.1, // 10%
      windowMinutes: 5,
      enabled: true,
      actions: [
        { type: 'log', config: {} },
        { type: 'webhook', config: { url: 'https://alerts.example.com/rate-limit' } },
      ],
    });

    // System load alert
    this.alertRules.set('system_load_critical', {
      name: 'system_load_critical',
      metric: 'load',
      operator: 'greater_than',
      threshold: 0.9, // 90%
      windowMinutes: 1,
      enabled: true,
      actions: [
        { type: 'log', config: {} },
        { type: 'auto_adjust', config: { reduction_factor: 0.5 } },
      ],
    });

    this.logger.log('Initialized default alert rules');
  }

  private setupBufferFlushing(): void {
    setInterval(async () => {
      try {
        await this.flushAllBuffers();
      } catch (error) {
        this.logger.error('Buffer flush failed', error);
      }
    }, this.bufferFlushInterval);
  }

  private async flushAllBuffers(): Promise<void> {
    for (const key of this.eventBuffer.keys()) {
      await this.flushBuffer(key);
    }
  }

  private async flushBuffer(key: string): Promise<void> {
    try {
      const buffer = this.eventBuffer.get(key);
      if (!buffer || buffer.length === 0) {
        return;
      }

      const batchKey = `events:${key}:${Date.now()}`;
      await this.redisClient.setex(
        batchKey,
        7 * 24 * 60 * 60, // 7 days TTL
        JSON.stringify(buffer)
      );

      // Clear the buffer
      this.eventBuffer.set(key, []);
      
      this.logger.debug(`Flushed ${buffer.length} rate limit events for ${key}`);
    } catch (error) {
      this.logger.error(`Failed to flush buffer for ${key}`, error);
    }
  }

  private startMetricsAggregation(): void {
    // Aggregate metrics every 5 minutes
    setInterval(async () => {
      try {
        const metrics = await this.getMetrics(
          new Date(Date.now() - 5 * 60 * 1000), // Last 5 minutes
          new Date()
        );

        // Store aggregated metrics
        const timestamp = Math.floor(Date.now() / (5 * 60 * 1000)) * (5 * 60 * 1000);
        await this.redisClient.setex(
          `aggregated:${timestamp}`,
          24 * 60 * 60, // 24 hours
          JSON.stringify(metrics)
        );

        // Check alerts
        await this.checkAlerts(metrics);
      } catch (error) {
        this.logger.error('Metrics aggregation failed', error);
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  private async checkAlerts(metrics: RateLimitMetrics): Promise<void> {
    for (const [alertName, alertRule] of this.alertRules.entries()) {
      if (!alertRule.enabled) continue;

      try {
        const metricValue = this.getMetricValue(metrics, alertRule.metric);
        const shouldTrigger = this.evaluateAlert(metricValue, alertRule);

        if (shouldTrigger) {
          await this.triggerAlert(alertName, { [alertRule.metric]: metricValue });
        }
      } catch (error) {
        this.logger.error(`Failed to check alert ${alertName}`, error);
      }
    }
  }

  private getMetricValue(metrics: RateLimitMetrics, metricName: string): number {
    switch (metricName) {
      case 'block_rate': return metrics.blockRate;
      case 'response_time': return metrics.avgResponseTime;
      case 'total_requests': return metrics.totalRequests;
      case 'blocked_requests': return metrics.blockedRequests;
      default: return 0;
    }
  }

  private evaluateAlert(value: number, alertRule: AlertRule): boolean {
    switch (alertRule.operator) {
      case 'greater_than': return value > alertRule.threshold;
      case 'less_than': return value < alertRule.threshold;
      case 'equals': return value === alertRule.threshold;
      default: return false;
    }
  }

  private getDefaultMetrics(): RateLimitMetrics {
    return {
      totalRequests: 0,
      allowedRequests: 0,
      blockedRequests: 0,
      blockRate: 0,
      avgResponseTime: 0,
      topBlockedEndpoints: [],
      topBlockedUsers: [],
      providerThrottling: {},
      burstUsage: {
        totalBursts: 0,
        avgBurstSize: 0,
        burstEfficiency: 1.0,
      },
    };
  }
}
